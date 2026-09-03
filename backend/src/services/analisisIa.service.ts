import { GoogleGenAI, Type } from '@google/genai';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import * as analisisIaRepo from '../repositories/analisisIa.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import type { AnalisisIa } from '../repositories/analisisIa.repository.js';
import type { Solicitud } from '../repositories/solicitudes.repository.js';

export class SolicitudNoEncontradaError extends Error {}
export class SolicitudNoEnRevisionError extends Error {}
export class AnalisisNoEncontradoError extends Error {}
export class AnalisisNoCompletadoError extends Error {}

const PRIORIDADES_VALIDAS = ['ALTA', 'MEDIA', 'BAJA'];

// Timeout explícito para la llamada al proveedor: sin esto, un registro
// podía quedar esperando indefinidamente en PROCESANDO si Gemini tardaba o
// no respondía. `retryOptions: { attempts: 1 }` desactiva explícitamente
// los reintentos automáticos del SDK (por defecto hasta 5) para no generar
// una segunda llamada — y por tanto un segundo consumo de cuota — sin
// autorización explícita de cada intento.
const GEMINI_TIMEOUT_MS = 100000;

// Esquema de salida estructurada exigido al proveedor (capacidad nativa del
// SDK: responseMimeType + responseSchema). No se envía ningún dato personal
// del cliente — solicitudesRepo.findById() nunca hace JOIN con `clientes`.
const ESQUEMA_RESPUESTA = {
  type: Type.OBJECT,
  properties: {
    resumen: { type: Type.STRING },
    prioridad_sugerida: { type: Type.STRING, enum: ['ALTA', 'MEDIA', 'BAJA'] },
    informacion_estructurada: {
      type: Type.OBJECT,
      properties: {
        material_estimado: { type: Type.STRING },
        proceso_estimado: { type: Type.STRING },
        informacion_faltante: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    },
  },
  required: ['resumen', 'informacion_estructurada'],
};

export async function listarAnalisis(solicitudId?: string): Promise<AnalisisIa[]> {
  return analisisIaRepo.listAll(solicitudId);
}

export async function obtenerAnalisis(id: string): Promise<AnalisisIa | null> {
  return analisisIaRepo.findById(id);
}

// Solo genera análisis para solicitudes en EN_REVISION (decisión aprobada).
// El registro SIEMPRE termina en estado terminal (COMPLETADO o ERROR): el
// try/catch envuelve toda la llamada al proveedor, incluida la ausencia de
// GEMINI_API_KEY, para que un fallo del proveedor nunca deje el registro
// colgado en PROCESANDO. No modifica solicitudes/cotizaciones/ordenes.
export async function generarAnalisis(solicitudId: string): Promise<AnalisisIa> {
  const solicitud = await solicitudesRepo.findById(solicitudId);
  if (!solicitud) {
    throw new SolicitudNoEncontradaError();
  }
  if (solicitud.estado !== 'EN_REVISION') {
    throw new SolicitudNoEnRevisionError();
  }

  const analisis = await analisisIaRepo.create(pool, solicitudId);

  try {
    await analisisIaRepo.marcarProcesando(analisis.id);

    if (!env.geminiApiKey) {
      throw new Error('GEMINI_API_KEY no está configurada.');
    }

    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });

    const response = await ai.models.generateContent({
      model: env.geminiModel,
      contents: construirPrompt(solicitud),
      config: {
        responseMimeType: 'application/json',
        responseSchema: ESQUEMA_RESPUESTA,
        httpOptions: {
          timeout: GEMINI_TIMEOUT_MS,
          retryOptions: { attempts: 1 },
        },
      },
    });

    const parsed = parsearRespuesta(response.text);

    const actualizado = await analisisIaRepo.marcarCompletado(analisis.id, {
      resultado: parsed.resumen,
      prioridadSugerida: parsed.prioridad_sugerida,
      informacionEstructurada: parsed.informacion_estructurada,
      modeloIa: env.geminiModel,
      versionIa: response.modelVersion ?? null,
    });

    return actualizado ?? analisis;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido al generar el análisis.';
    const actualizado = await analisisIaRepo.marcarError(analisis.id, sanitizarMensajeError(mensaje));
    return actualizado ?? analisis;
  }
}

export async function marcarRevisado(id: string, revisadoPor: string): Promise<AnalisisIa> {
  const actualizado = await analisisIaRepo.marcarRevisado(id, revisadoPor);
  if (actualizado) {
    return actualizado;
  }

  const actual = await analisisIaRepo.findById(id);
  if (!actual) {
    throw new AnalisisNoEncontradoError();
  }
  throw new AnalisisNoCompletadoError();
}

function construirPrompt(solicitud: Solicitud): string {
  return [
    'Eres un asistente técnico que analiza solicitudes de trabajo para un centro de mecanizado industrial.',
    'Analiza la siguiente solicitud y responde EXCLUSIVAMENTE con el JSON solicitado.',
    'No tomes ninguna decisión comercial ni de precio; únicamente sugiere una prioridad y estructura la información técnica disponible, señalando qué información falta para poder cotizar con precisión.',
    '',
    `Servicio: ${solicitud.servicio}`,
    `Descripción: ${solicitud.descripcion}`,
    `Cantidad: ${solicitud.cantidad}`,
    `Fecha requerida: ${solicitud.fecha_requerida ?? 'No especificada'}`,
    `Especificaciones adicionales: ${solicitud.especificaciones ?? 'Ninguna'}`,
  ].join('\n');
}

interface RespuestaAnalisis {
  resumen: string;
  prioridad_sugerida: string | null;
  informacion_estructurada: Record<string, unknown>;
}

// Validación estricta de la respuesta antes de persistirla (decisión
// aprobada): cualquier desviación del contrato lanza, y el catch de
// generarAnalisis la convierte en estado ERROR — nunca se persiste un
// prioridad_sugerida fuera de {ALTA,MEDIA,BAJA} (violaría el CHECK de
// PostgreSQL), se descarta a NULL en su lugar.
function parsearRespuesta(texto: string | undefined): RespuestaAnalisis {
  if (!texto) {
    throw new Error('El proveedor de IA no devolvió contenido.');
  }

  let data: unknown;
  try {
    data = JSON.parse(texto);
  } catch {
    throw new Error('La respuesta del proveedor de IA no es JSON válido.');
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('La respuesta del proveedor de IA no cumple el contrato esperado.');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.resumen !== 'string' || !obj.resumen.trim()) {
    throw new Error('La respuesta del proveedor de IA no incluye "resumen".');
  }

  if (typeof obj.informacion_estructurada !== 'object' || obj.informacion_estructurada === null) {
    throw new Error('La respuesta del proveedor de IA no incluye "informacion_estructurada".');
  }

  const prioridadCruda = obj.prioridad_sugerida;
  const prioridad_sugerida =
    typeof prioridadCruda === 'string' && PRIORIDADES_VALIDAS.includes(prioridadCruda) ? prioridadCruda : null;

  return {
    resumen: obj.resumen,
    prioridad_sugerida,
    informacion_estructurada: obj.informacion_estructurada as Record<string, unknown>,
  };
}

// Nunca debe persistirse la API key en el mensaje de error (decisión
// aprobada). Defensa explícita: si por cualquier motivo el mensaje de error
// del SDK llegara a incluir el valor de la clave, se redacta antes de
// guardarlo en `resultado`.
function sanitizarMensajeError(mensaje: string): string {
  let limpio = mensaje;
  if (env.geminiApiKey) {
    limpio = limpio.split(env.geminiApiKey).join('[REDACTED]');
  }
  return limpio.slice(0, 500);
}
