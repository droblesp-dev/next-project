import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import * as mensajesRepo from '../repositories/solicitudMensajes.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import * as ordenesRepo from '../repositories/ordenes.repository.js';
import { consumirInvocacionNexia } from './nexiaRateLimit.service.js';
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
const GEMINI_TIMEOUT_MS = 100000;

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
//   - COMERCIAL y ADMIN: siempre.
//   - OPERATIVO: sin orden, sí; con orden, solo si es su responsable
//     (orden de otro OPERATIVO o sin responsable -> 403).
//   - cualquier otro rol: 403.
// La existencia de la orden decide el régimen; no se asume que la solicitud
// haya cambiado a COTIZADA (hay datos históricos con orden y otro estado).
async function resolverContextoChat(solicitudId: string, usuario: UsuarioChat) {
  if (!UUID_RE.test(solicitudId)) {
    throw new SolicitudNoEncontradaError();
  }
  const solicitud = await solicitudesRepo.findById(solicitudId);
  if (!solicitud) {
    throw new SolicitudNoEncontradaError();
  }
  const orden = await ordenesRepo.findContextoChatPorSolicitud(solicitudId);

  if (!['ADMIN', 'COMERCIAL', 'OPERATIVO'].includes(usuario.rol)) {
    throw new SinAccesoChatError();
  }
  if (usuario.rol === 'OPERATIVO' && orden && (!orden.responsable_id || orden.responsable_id !== usuario.id)) {
    throw new SinAccesoChatError();
  }

  return { solicitud, orden };
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
  const { solicitud, orden } = await resolverContextoChat(solicitudId, usuario);
  const mensajes = await mensajesRepo.listarPorSolicitud(solicitudId);
  // ADMIN solo lee; COMERCIAL/OPERATIVO escriben salvo que un estado cierre la conversación.
  const soloLectura = usuario.rol === 'ADMIN' || chatCerradoPorEstado(solicitud, orden);
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
  // Solo COMERCIAL y OPERATIVO escriben (ADMIN solo lee). La ruta ya lo filtra;
  // se repite aquí como defensa en profundidad.
  if (usuario.rol !== 'COMERCIAL' && usuario.rol !== 'OPERATIVO') {
    throw new SinAccesoChatError();
  }

  const { solicitud, orden } = await resolverContextoChat(solicitudId, usuario);

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

  const mensaje = await mensajesRepo.crear({
    solicitudId,
    autorId: usuario.id,
    autorTipo: usuario.rol,
    contenido: contenidoLimpio,
  });

  if (!invocaNexia) {
    return { mensaje, respuestaNexia: null };
  }

  const respuestaNexia = await generarRespuestaNexia(solicitud, solicitudId, contenidoLimpio);
  return { mensaje, respuestaNexia };
}

async function generarRespuestaNexia(
  solicitud: Solicitud,
  solicitudId: string,
  pregunta: string
): Promise<SolicitudMensaje> {
  const textoRespuesta = await consultarGemini(solicitud, solicitudId, pregunta);
  return mensajesRepo.crear({
    solicitudId,
    autorId: null,
    autorTipo: 'NEXIA',
    contenido: textoRespuesta,
  });
}

// Igual que generarAnalisis() en analisisIa.service.ts: el try/catch
// envuelve toda la llamada al proveedor para que un fallo (sin API key,
// timeout, respuesta vacía) nunca se propague como un error 500 al
// usuario — en su lugar, NexIA "responde" con un aviso, manteniendo el
// chat coherente.
async function consultarGemini(solicitud: Solicitud, solicitudId: string, pregunta: string): Promise<string> {
  try {
    if (!env.geminiApiKey) {
      throw new Error('GEMINI_API_KEY no está configurada.');
    }

    const recientes = await mensajesRepo.obtenerRecientes(solicitudId, LIMITE_MENSAJES_CONTEXTO);
    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });

    const response = await ai.models.generateContent({
      model: env.geminiModel,
      contents: construirPrompt(solicitud, recientes, pregunta),
      config: {
        httpOptions: {
          timeout: GEMINI_TIMEOUT_MS,
          retryOptions: { attempts: 1 },
        },
      },
    });

    const texto = response.text?.trim();
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
  let limpio = mensaje;
  if (env.geminiApiKey) {
    limpio = limpio.split(env.geminiApiKey).join('[REDACTED]');
  }
  return limpio.slice(0, 500);
}
