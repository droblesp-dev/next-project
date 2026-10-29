import { asegurarProveedorConfigurado, obtenerProveedorIa, redactarSecretosIa } from './ia/index.js';
import * as mensajesRepo from '../repositories/solicitudMensajes.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import * as ordenesRepo from '../repositories/ordenes.repository.js';
import * as participantesRepo from '../repositories/solicitudMensajesParticipantes.repository.js';
import { obtenerEsquemaChat } from '../repositories/chatEsquema.js';
import { consumirInvocacionNexia } from './nexiaRateLimit.service.js';
import { registrarEventoSeguridad } from './securityLog.js';
import { env } from '../config/env.js';
import type { SolicitudMensaje } from '../repositories/solicitudMensajes.repository.js';
import type { Solicitud } from '../repositories/solicitudes.repository.js';

export class SolicitudNoEncontradaError extends Error {}
// `message` lleva el texto que el controller devuelve tal cual en el 400.
export class ContenidoInvalidoError extends Error {}
// Bloque 2A: autorización contextual (403) y solo lectura derivada (409).
export class SinAccesoChatError extends Error {}
export class ChatSoloLecturaError extends Error {}

// Bloque 2A: máximo de caracteres por mensaje. Se mide sobre el contenido ya
// recortado con trim() (lo que se persiste), en unidades UTF-16 de
// String.length. No se trunca ni se modifica el contenido: si excede, 400.
export const MENSAJE_MAX_CARACTERES = 2000;

// Estados de orden existentes (no se crea ningún estado de chat) que dejan la
// conversación en solo lectura. La solicitud CANCELADA también la deja así.
const ESTADOS_ORDEN_SOLO_LECTURA = ['FINALIZADA', 'CERRADA', 'CANCELADA'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UsuarioChat {
  id: string;
  rol: string;
}

// Mismo timeout/estrategia de reintentos ya usados y probados en
// analisisIa.service.ts — sin reintentos automáticos (evita un segundo
// consumo de cuota sin autorización de cada intento).
const IA_TIMEOUT_MS = 100000;

// Contexto acotado para NexIA: nunca se envía el historial completo de la
// conversación, solo los últimos N mensajes (decisión explícita del
// bloque MVP autorizado).
const LIMITE_MENSAJES_CONTEXTO = 20;

// Invocación explícita: el mensaje debe EMPEZAR literalmente con "nexia"
// (sin distinguir mayúsculas/minúsculas — "NexIA", "Nexia", "NEXIA", etc.
// son equivalentes). Un mensaje que solo la mencione en medio del texto
// NO cuenta como invocación. Esta es la ÚNICA puerta de entrada a Gemini
// en todo este módulo — un mensaje normal jamás la atraviesa.
const REGEX_INVOCACION_NEXIA = /^\s*nexia\b/i;

// Resuelve la solicitud y la orden asociada (si existe) y aplica la
// autorización contextual de LECTURA:
//   - COMERCIAL: siempre.
//   - OPERATIVO: sin orden, sí; con orden, solo si es su responsable
//     (orden de otro OPERATIVO o sin responsable -> 403).
//   - ADMIN y cualquier otro rol: 403. El chat es exclusivo de COMERCIAL y OPERATIVO (#7): ADMIN no lo consulta
//     ni por sus endpoints (conserva el acceso a las fichas técnicas, que es otra ruta).
// La existencia de la orden decide el régimen; no se asume que la solicitud
// haya cambiado a COTIZADA (hay datos históricos con orden y otro estado).
// Política con la que el repositorio vuelve a comprobar el acceso dentro de la transacción que guarda (mensaje o respuesta).
async function politicaDeEnvio(usuario: { id: string; rol: 'COMERCIAL' | 'OPERATIVO' }): Promise<mensajesRepo.PoliticaEnvio> {
  const esquema = await obtenerEsquemaChat();
  const modo = env.chat.participantesModo;
  return {
    usuarioId: usuario.id,
    rol: usuario.rol,
    estadosOrdenSoloLectura: ESTADOS_ORDEN_SOLO_LECTURA,
    participantes: modo === 'OFF' || !esquema.participantes ? 'NO' : modo,
  };
}

export type OperacionChat = 'LEER' | 'ESCRIBIR' | 'MARCAR_LEIDO' | 'PARTICIPANTES';

export interface ContextoChat {
  solicitud: Solicitud;
  orden: ordenesRepo.OrdenContextoChat | null;
  // Solo en solicitudes SIN orden con participantes activos en la base: si el usuario es participante vigente.
  participa: boolean | null;
}

// Régimen de acceso (#7):
//   - Con orden: COMERCIAL accede; OPERATIVO solo si es el responsable vigente (se deriva de la orden, nada se copia).
//   - Sin orden: lo deciden los participantes explícitos (tabla V26) según el modo configurado:
//       OFF      -> sin participantes (comportamiento anterior);
//       SOMBRA   -> el acceso sigue abierto y solo se registra qué accesos se habrían denegado (sin contenido);
//       ESTRICTO -> se exige ser participante (salvo el primer mensaje de un COMERCIAL en un hilo sin COMERCIAL
//                   participante, que lo convierte en participante).
//   Sin la tabla de participantes en la base el chat se comporta como en OFF.
export async function resolverContextoChat(
  solicitudId: string,
  usuario: UsuarioChat,
  operacion: OperacionChat = 'LEER'
): Promise<ContextoChat> {
  if (!UUID_RE.test(solicitudId)) {
    throw new SolicitudNoEncontradaError();
  }
  const solicitud = await solicitudesRepo.findById(solicitudId);
  if (!solicitud) {
    throw new SolicitudNoEncontradaError();
  }
  const orden = await ordenesRepo.findContextoChatPorSolicitud(solicitudId);

  if (!['COMERCIAL', 'OPERATIVO'].includes(usuario.rol)) {
    throw new SinAccesoChatError();
  }

  if (orden) {
    if (usuario.rol === 'OPERATIVO' && (!orden.responsable_id || orden.responsable_id !== usuario.id)) {
      throw new SinAccesoChatError();
    }
    return { solicitud, orden, participa: null };
  }

  const modo = env.chat.participantesModo;
  const esquema = await obtenerEsquemaChat();
  if (modo === 'OFF' || !esquema.participantes) {
    return { solicitud, orden, participa: null };
  }

  const participa = await participantesRepo.esParticipanteActivo(solicitudId, usuario.id);
  if (!participa) {
    if (modo === 'ESTRICTO') {
      const primerMensaje =
        operacion === 'ESCRIBIR' && usuario.rol === 'COMERCIAL' && !(await participantesRepo.hayComercialParticipante(solicitudId));
      if (!primerMensaje) {
        throw new SinAccesoChatError();
      }
    } else {
      // Modo sombra: no se deniega; se deja constancia (usuario, solicitud, operación; nunca contenido).
      registrarEventoSeguridad('CHAT_ACCESO_SOMBRA_DENEGADO', { usuarioId: usuario.id, solicitudId, operacion });
    }
  }
  return { solicitud, orden, participa };
}

// Única definición de "solo lectura derivada de estados existentes" (no hay estado de chat
// persistente): solicitud CANCELADA u orden FINALIZADA/CERRADA/CANCELADA.
function chatCerradoPorEstado(solicitud: Solicitud, orden: ordenesRepo.OrdenContextoChat | null): boolean {
  return solicitud.estado === 'CANCELADA' || (orden !== null && ESTADOS_ORDEN_SOLO_LECTURA.includes(orden.estado));
}

// Bloque 2B.1: `modo` es solo una ayuda de UX para el frontend (EDITABLE / SOLO_LECTURA); no
// sustituye la autorización — POST vuelve a verificar rol, acceso y estado. SIN_ACCESO sigue siendo
// el HTTP 403 (resolverContextoChat lanza antes de llegar aquí).
export type ModoChat = 'EDITABLE' | 'SOLO_LECTURA';

export interface ResultadoListado {
  mensajes: SolicitudMensaje[];
  modo: ModoChat;
}

export async function listarMensajes(solicitudId: string, usuario: UsuarioChat): Promise<ResultadoListado> {
  const { solicitud, orden } = await resolverContextoChat(solicitudId, usuario, 'LEER');
  // Privacidad (#8): solo los mensajes compartidos y las respuestas de NexIA dirigidas a este usuario.
  const mensajes = await mensajesRepo.listarVisiblesPara(solicitudId, usuario.id);
  // COMERCIAL/OPERATIVO escriben salvo que un estado cierre la conversación.
  const soloLectura = chatCerradoPorEstado(solicitud, orden);
  return { mensajes, modo: soloLectura ? 'SOLO_LECTURA' : 'EDITABLE' };
}

export interface ResultadoMensaje {
  mensaje: SolicitudMensaje;
  respuestaNexia: SolicitudMensaje | null;
}

// La identidad y el rol llegan siempre desde `req.user` (JWT) — nunca del
// cuerpo de la petición, mismo criterio de seguridad ya usado en
// `anticipo_confirmado_por` y `revisado_por`.
//
// Orden de comprobaciones (Bloque 2A): [JWT y rol en la ruta] -> solicitud
// existente -> orden relacionada -> autorización contextual -> solo lectura ->
// validación de contenido -> límite de longitud -> detección de NexIA ->
// rate limit de NexIA -> persistir -> respuesta de NexIA. Nada se persiste ni
// se llama a Gemini antes de superar las anteriores.
export async function crearMensaje(
  solicitudId: string,
  usuario: UsuarioChat,
  contenido: unknown
): Promise<ResultadoMensaje> {
  // Solo COMERCIAL y OPERATIVO participan en el chat. La ruta ya lo filtra;
  // se repite aquí como defensa en profundidad.
  if (usuario.rol !== 'COMERCIAL' && usuario.rol !== 'OPERATIVO') {
    throw new SinAccesoChatError();
  }

  const { solicitud, orden } = await resolverContextoChat(solicitudId, usuario, 'ESCRIBIR');

  if (chatCerradoPorEstado(solicitud, orden)) {
    throw new ChatSoloLecturaError();
  }

  if (typeof contenido !== 'string') {
    throw new ContenidoInvalidoError('contenido es requerido.');
  }
  const contenidoLimpio = contenido.trim();
  if (!contenidoLimpio) {
    throw new ContenidoInvalidoError('contenido no puede estar vacío.');
  }
  if (contenidoLimpio.length > MENSAJE_MAX_CARACTERES) {
    throw new ContenidoInvalidoError(`contenido no puede superar ${MENSAJE_MAX_CARACTERES} caracteres.`);
  }

  const invocaNexia = REGEX_INVOCACION_NEXIA.test(contenidoLimpio);
  if (invocaNexia) {
    // Lanza LimiteNexiaError (429) sin persistir nada si se superó el límite.
    consumirInvocacionNexia(usuario.id);
  }

  // Carrera reasignación/envío (#7): el acceso se vuelve a comprobar y se bloquea DENTRO de la transacción que guarda el
  // mensaje (usuario, solicitud, orden más reciente y participante). Si el usuario perdió el acceso antes de ese punto
  // —reasignación de la orden, cambio de rol, desactivación, retiro como participante, solicitud cancelada—, el envío se
  // rechaza y no se guarda nada. El primer COMERCIAL de un hilo sin COMERCIAL participante queda como participante.
  const politica = await politicaDeEnvio(usuario as UsuarioChat & { rol: 'COMERCIAL' | 'OPERATIVO' });
  const resultado = await mensajesRepo.crearAutorizado({ solicitudId, contenido: contenidoLimpio }, politica);
  if (!resultado.ok) {
    if (resultado.motivo === 'SOLO_LECTURA') {
      throw new ChatSoloLecturaError();
    }
    throw new SinAccesoChatError();
  }
  if (resultado.participanteNuevo) {
    registrarEventoSeguridad('CHAT_PARTICIPANTE_INCORPORADO', { usuarioId: usuario.id, solicitudId, origen: 'PRIMER_MENSAJE' });
  }
  const mensaje = resultado.mensaje;

  if (!invocaNexia) {
    return { mensaje, respuestaNexia: null };
  }

  const respuestaNexia = await generarRespuestaNexia(solicitud, solicitudId, contenidoLimpio, usuario as UsuarioChat & { rol: 'COMERCIAL' | 'OPERATIVO' });
  return { mensaje, respuestaNexia };
}

// Privacidad (#8): la respuesta se guarda dirigida al usuario que invocó a NexIA y solo él puede verla. La pregunta
// (mensaje de la persona) sigue siendo compartida.
async function generarRespuestaNexia(
  solicitud: Solicitud,
  solicitudId: string,
  pregunta: string,
  usuario: { id: string; rol: 'COMERCIAL' | 'OPERATIVO' }
): Promise<SolicitudMensaje> {
  const textoRespuesta = await consultarIa(solicitud, solicitudId, pregunta, usuario.id);
  // La llamada a la IA pudo tardar: el acceso del usuario se vuelve a comprobar al guardar. Si lo perdió (reasignación,
  // cambio de rol, desactivación, retiro, cancelación), la respuesta no se guarda ni se entrega.
  const guardada = await mensajesRepo.crearRespuestaNexiaAutorizada(
    { solicitudId, contenido: textoRespuesta },
    await politicaDeEnvio(usuario)
  );
  if (!guardada.ok) {
    if (guardada.motivo === 'SOLO_LECTURA') {
      throw new ChatSoloLecturaError();
    }
    throw new SinAccesoChatError();
  }
  return guardada.mensaje;
}

// Igual que generarAnalisis() en analisisIa.service.ts: el try/catch
// envuelve toda la llamada al proveedor para que un fallo (sin API key,
// timeout, respuesta vacía) nunca se propague como un error 500 al
// usuario — en su lugar, NexIA "responde" con un aviso, manteniendo el
// chat coherente.
async function consultarIa(
  solicitud: Solicitud,
  solicitudId: string,
  pregunta: string,
  usuarioId: string
): Promise<string> {
  try {
    const ia = obtenerProveedorIa();
    asegurarProveedorConfigurado(ia);

    // Contexto = mensajes compartidos + SOLO las respuestas privadas de quien invoca (nunca las de otros usuarios).
    const recientes = await mensajesRepo.obtenerRecientesParaUsuario(solicitudId, usuarioId, LIMITE_MENSAJES_CONTEXTO);

    const response = await ia.generar({
      prompt: construirPrompt(solicitud, recientes, pregunta),
      timeoutMs: IA_TIMEOUT_MS,
    });

    const texto = response.texto?.trim();
    if (!texto) {
      throw new Error('El proveedor de IA no devolvió contenido.');
    }
    return texto;
  } catch (error) {
    const mensajeError = error instanceof Error ? error.message : 'Error desconocido al consultar NexIA.';
    console.error('Error al consultar NexIA:', sanitizarMensajeError(mensajeError));
    return 'NexIA no pudo generar una respuesta en este momento. Intente nuevamente más tarde.';
  }
}

function construirPrompt(solicitud: Solicitud, recientes: SolicitudMensaje[], pregunta: string): string {
  const historial =
    recientes.length > 0
      ? recientes.map((m) => `[${m.autor_tipo}]: ${m.contenido}`).join('\n')
      : '(sin mensajes previos)';

  return [
    'Eres NexIA, asistente interno de apoyo para el equipo Comercial y Operativo de un centro de mecanizado industrial.',
    'Te invocan dentro de una conversación de trabajo sobre una solicitud de cliente, para apoyar la validación técnica previa a cotizar.',
    'No inventes datos técnicos (material, dimensiones, tolerancias, tiempos, máquinas, procesos) que no estén en la información proporcionada — si falta información, dilo explícitamente.',
    'No tomes decisiones comerciales ni técnicas definitivas — únicamente asiste: resume, estructura o señala información faltante según se te pida.',
    'Responde en español, de forma breve y directa, en texto plano (sin markdown).',
    '',
    `Servicio: ${solicitud.servicio}`,
    `Descripción: ${solicitud.descripcion}`,
    `Cantidad: ${solicitud.cantidad}`,
    `Fecha requerida: ${solicitud.fecha_requerida ?? 'No especificada'}`,
    `Especificaciones adicionales: ${solicitud.especificaciones ?? 'Ninguna'}`,
    '',
    'Conversación reciente (de más antiguo a más reciente):',
    historial,
    '',
    `Mensaje que te invoca: "${pregunta}"`,
  ].join('\n');
}

// Nunca debe persistirse la API key en un log (mismo criterio ya aplicado
// en analisisIa.service.ts).
function sanitizarMensajeError(mensaje: string): string {
  return redactarSecretosIa(mensaje).slice(0, 500);
}
