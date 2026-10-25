import { asegurarProveedorConfigurado, obtenerProveedorIa, redactarSecretosIa } from './ia/index.js';
import * as fichaRepo from '../repositories/fichaTecnica.repository.js';
import * as ordenesRepo from '../repositories/ordenes.repository.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import * as mensajesRepo from '../repositories/solicitudMensajes.repository.js';
import * as analisisIaRepo from '../repositories/analisisIa.repository.js';
import * as alertasRepo from '../repositories/alertas.repository.js';
import type { FichaTecnica } from '../repositories/fichaTecnica.repository.js';
import type { Solicitud } from '../repositories/solicitudes.repository.js';
import type { Cotizacion } from '../repositories/cotizaciones.repository.js';
import type { SolicitudMensaje } from '../repositories/solicitudMensajes.repository.js';
import type { AnalisisIa } from '../repositories/analisisIa.repository.js';

export class OrdenNoEncontradaError extends Error {}
export class FichaYaExisteError extends Error {}
export class GeneracionFallidaError extends Error {}

// Mismo timeout/estrategia ya usada en analisisIa.service.ts y en el chat.
const IA_TIMEOUT_MS = 100000;
const LIMITE_MENSAJES_CONTEXTO = 20;

export async function obtenerFicha(ordenId: string): Promise<FichaTecnica | null> {
  const orden = await ordenesRepo.findById(ordenId);
  if (!orden) {
    throw new OrdenNoEncontradaError();
  }
  return fichaRepo.findByOrdenId(ordenId);
}

// Decisión 4/16: la orden YA existe cuando esta función se invoca — nunca
// la crea. Si Gemini falla, se lanza GeneracionFallidaError SIN insertar
// ninguna fila en fichas_tecnicas: la ausencia de fila es, por sí misma,
// el "estado" de que aún hace falta generarla (decisión 16: sin columna
// de estado ni reintentos automáticos complejos). Quien invoque esta
// función decide qué hacer con el error — ver ordenes.controller.ts
// (generación automática, ignora el error) y fichaTecnica.controller.ts
// (generación manual, lo reporta al usuario).
export async function generarFicha(ordenId: string): Promise<FichaTecnica> {
  const orden = await ordenesRepo.findById(ordenId);
  if (!orden) {
    throw new OrdenNoEncontradaError();
  }

  const existente = await fichaRepo.findByOrdenId(ordenId);
  if (existente) {
    throw new FichaYaExisteError();
  }

  const cotizacion = await cotizacionesRepo.findById(orden.cotizacion_id);
  if (!cotizacion) {
    // No debería ocurrir (FK ya lo garantiza) — se trata como orden
    // inconsistente antes que fallar de forma menos clara.
    throw new OrdenNoEncontradaError();
  }

  const solicitud = await solicitudesRepo.findById(cotizacion.solicitud_id);
  if (!solicitud) {
    throw new OrdenNoEncontradaError();
  }

  const mensajesRecientes = await mensajesRepo.obtenerRecientes(solicitud.id, LIMITE_MENSAJES_CONTEXTO);
  const analisisPrevios = await analisisIaRepo.listAll(solicitud.id);
  const ultimoAnalisisCompletado = analisisPrevios.find((a) => a.estado === 'COMPLETADO') ?? null;

  const { contenido, tieneInconsistencia } = await consultarIa(
    solicitud,
    cotizacion,
    mensajesRecientes,
    ultimoAnalisisCompletado
  );

  const ficha = await fichaRepo.crear({ ordenId, contenido, tieneInconsistencia });

  // Decisión 11: reutiliza la tabla `alertas` existente, no crea ninguna
  // tabla de notificaciones nueva. `ON CONFLICT DO NOTHING` (ver
  // alertas.repository.ts) evita duplicar la alerta si en el futuro se
  // regenerara la ficha para la misma orden.
  if (tieneInconsistencia) {
    await alertasRepo.crearAlertaFichaTecnica(
      ordenId,
      `La ficha técnica de la orden ${orden.codigo} presenta una inconsistencia que requiere revisión.`
    );
  }

  return ficha;
}

async function consultarIa(
  solicitud: Solicitud,
  cotizacion: Cotizacion,
  mensajesRecientes: SolicitudMensaje[],
  ultimoAnalisis: AnalisisIa | null
): Promise<{ contenido: string; tieneInconsistencia: boolean }> {
  const ia = obtenerProveedorIa();
  asegurarProveedorConfigurado(ia, GeneracionFallidaError);

  try {
    const response = await ia.generar({
      prompt: construirPrompt(solicitud, cotizacion, mensajesRecientes, ultimoAnalisis),
      timeoutMs: IA_TIMEOUT_MS,
    });

    const texto = response.texto?.trim();
    if (!texto) {
      throw new Error('El proveedor de IA no devolvió contenido.');
    }

    return { contenido: texto, tieneInconsistencia: detectarInconsistencia(texto) };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido al generar la ficha técnica.';
    console.error('Error al generar ficha técnica:', sanitizarMensajeError(mensaje));
    throw new GeneracionFallidaError(mensaje);
  }
}

// Heurística simple y deliberadamente no sofisticada (decisión 6: sin
// JSONB ni estructura compleja): el prompt exige el literal
// "INCONSISTENCIAS:" seguido de "Ninguna" cuando no hay ninguna — si el
// texto después de esa etiqueta no coincide con esa forma, se considera
// que sí hay una inconsistencia real que reportar.
function detectarInconsistencia(texto: string): boolean {
  const match = texto.match(/INCONSISTENCIAS:\s*([\s\S]*)$/i);
  if (!match) {
    return false;
  }
  const valor = match[1].trim();
  if (!valor) {
    return false;
  }
  return !/^(ninguna|no se detect|no aplica|n\/a|no hay)/i.test(valor);
}

function construirPrompt(
  solicitud: Solicitud,
  cotizacion: Cotizacion,
  mensajesRecientes: SolicitudMensaje[],
  ultimoAnalisis: AnalisisIa | null
): string {
  const historial =
    mensajesRecientes.length > 0
      ? mensajesRecientes.map((m) => `[${m.autor_tipo}]: ${m.contenido}`).join('\n')
      : '(sin mensajes registrados)';

  const analisisPrevio = ultimoAnalisis
    ? [
        `Resumen: ${ultimoAnalisis.resultado ?? 'No disponible'}`,
        `Prioridad sugerida: ${ultimoAnalisis.prioridad_sugerida ?? 'No especificada'}`,
        ultimoAnalisis.informacion_estructurada
          ? `Información estructurada previa: ${JSON.stringify(ultimoAnalisis.informacion_estructurada)}`
          : null,
      ]
        .filter(Boolean)
        .join('\n')
    : '(no se generó ningún análisis IA previo para esta solicitud)';

  // Nunca se incluye valor/subtotal/iva/total/anticipo/saldo de la
  // cotización — la única información de `cotizacion` que llega al modelo
  // es su `descripcion` (notas técnicas de Comercial), por diseño, para
  // que sea estructuralmente imposible que la ficha filtre información
  // comercial (decisión 8) — no depende únicamente de instruir al modelo.
  return [
    'Genera una FICHA TÉCNICA para el equipo Operativo de un centro de mecanizado industrial, en el siguiente formato EXACTO, en español:',
    '',
    'FICHA TÉCNICA',
    'Trabajo:',
    'Cantidad:',
    'Material:',
    'Dimensiones:',
    'Acabado:',
    'Maquinaria/equipo:',
    'Tiempo estimado:',
    'Observaciones:',
    'INFORMACIÓN FALTANTE:',
    'INCONSISTENCIAS:',
    '',
    'Reglas estrictas, sin excepción:',
    '- NO inventes material, dimensiones, tolerancias, cantidad, maquinaria, tiempos ni parámetros de fabricación que no estén explícitamente en la información proporcionada.',
    '- Si un dato no está disponible, escribe exactamente "No especificado" en ese campo.',
    '- NO incluyas precios, valores monetarios, IVA, anticipo, saldo, ni ninguna condición económica — esta ficha es exclusivamente técnica.',
    '- En "INFORMACIÓN FALTANTE", lista los datos técnicos que faltan para ejecutar el trabajo con seguridad, o escribe "Ninguna" si no falta nada.',
    '- En "INCONSISTENCIAS", describe cualquier contradicción real entre la solicitud, la conversación y la cotización aceptada. Si no encuentras ninguna, escribe EXACTAMENTE "Ninguna" (sin texto adicional).',
    '',
    'Información disponible:',
    `Servicio: ${solicitud.servicio}`,
    `Descripción de la solicitud: ${solicitud.descripcion}`,
    `Cantidad solicitada: ${solicitud.cantidad}`,
    `Fecha requerida: ${solicitud.fecha_requerida ?? 'No especificada'}`,
    `Especificaciones adicionales de la solicitud: ${solicitud.especificaciones ?? 'Ninguna'}`,
    `Notas técnicas de la cotización aceptada: ${cotizacion.descripcion ?? 'Ninguna'}`,
    '',
    'Análisis técnico previo (si existe):',
    analisisPrevio,
    '',
    'Conversación reciente entre Comercial y Operativo:',
    historial,
  ].join('\n');
}

function sanitizarMensajeError(mensaje: string): string {
  return redactarSecretosIa(mensaje).slice(0, 500);
}
