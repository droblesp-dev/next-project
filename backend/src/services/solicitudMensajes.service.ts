import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';
import * as mensajesRepo from '../repositories/solicitudMensajes.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import type { SolicitudMensaje } from '../repositories/solicitudMensajes.repository.js';
import type { Solicitud } from '../repositories/solicitudes.repository.js';

export class SolicitudNoEncontradaError extends Error {}
export class ContenidoInvalidoError extends Error {}

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

export async function listarMensajes(solicitudId: string): Promise<SolicitudMensaje[]> {
  const solicitud = await solicitudesRepo.findById(solicitudId);
  if (!solicitud) {
    throw new SolicitudNoEncontradaError();
  }
  return mensajesRepo.listarPorSolicitud(solicitudId);
}

export interface ResultadoMensaje {
  mensaje: SolicitudMensaje;
  respuestaNexia: SolicitudMensaje | null;
}

// `autorTipo` llega siempre desde `req.user.rol` (COMERCIAL u OPERATIVO,
// la ruta ya lo garantiza vía requireRole) — nunca del cuerpo de la
// petición, mismo criterio de seguridad ya usado en `anticipo_confirmado_por`
// y `revisado_por`.
export async function crearMensaje(
  solicitudId: string,
  autorId: string,
  autorTipo: 'COMERCIAL' | 'OPERATIVO',
  contenido: string
): Promise<ResultadoMensaje> {
  const solicitud = await solicitudesRepo.findById(solicitudId);
  if (!solicitud) {
    throw new SolicitudNoEncontradaError();
  }

  const contenidoLimpio = contenido.trim();
  if (!contenidoLimpio) {
    throw new ContenidoInvalidoError();
  }

  const mensaje = await mensajesRepo.crear({
    solicitudId,
    autorId,
    autorTipo,
    contenido: contenidoLimpio,
  });

  if (!REGEX_INVOCACION_NEXIA.test(contenidoLimpio)) {
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
