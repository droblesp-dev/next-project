import { pool } from '../config/db.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import type { Cotizacion } from '../repositories/cotizaciones.repository.js';

export class SolicitudNoEncontradaError extends Error {}
export class SolicitudNoEnRevisionError extends Error {}
export class CotizacionNoEncontradaError extends Error {}
export class TransicionInvalidaError extends Error {}
export class EstadoInvalidoError extends Error {}
export class YaExisteAceptadaError extends Error {}

const ESTADOS_VALIDOS = ['BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CANCELADA'];

// Transiciones justificadas para Fase 7 (documentadas en el CHECKPOINT de
// implementación, no asumidas): BORRADOR es el estado inicial de toda
// cotización recién creada; ENVIADA representa el envío formal al cliente,
// desde donde puede derivar en aceptación, rechazo o vencimiento; CANCELADA
// es alcanzable desde cualquier estado no terminal (cancelación
// administrativa). ACEPTADA/RECHAZADA/VENCIDA/CANCELADA son terminales: no
// hay respaldo en el esquema ni en una decisión aprobada para reabrir o
// renegociar una cotización ya resuelta.
const TRANSICIONES: Record<string, string[]> = {
  BORRADOR: ['ENVIADA', 'CANCELADA'],
  ENVIADA: ['ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CANCELADA'],
  ACEPTADA: [],
  RECHAZADA: [],
  VENCIDA: [],
  CANCELADA: [],
};

export async function listarCotizaciones(): Promise<Cotizacion[]> {
  return cotizacionesRepo.listAll();
}

export async function obtenerCotizacion(id: string): Promise<Cotizacion | null> {
  return cotizacionesRepo.findById(id);
}

export interface CrearCotizacionInput {
  solicitudId: string;
  valor: number;
  descripcion: string | null;
  creadoPor: string;
}

// Fase 7 exige explícitamente que la solicitud exista y esté en estado
// EN_REVISION antes de permitir crear una cotización. No cambia
// solicitudes.estado (decisión aprobada 2 de la autorización de Fase 7).
export async function crearCotizacion(input: CrearCotizacionInput): Promise<Cotizacion> {
  const solicitud = await solicitudesRepo.findById(input.solicitudId);
  if (!solicitud) {
    throw new SolicitudNoEncontradaError();
  }
  if (solicitud.estado !== 'EN_REVISION') {
    throw new SolicitudNoEnRevisionError();
  }

  return cotizacionesRepo.create(pool, {
    solicitudId: input.solicitudId,
    valor: input.valor,
    descripcion: input.descripcion,
    creadoPor: input.creadoPor,
  });
}

export async function cambiarEstadoCotizacion(id: string, nuevoEstado: string): Promise<Cotizacion> {
  if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
    throw new EstadoInvalidoError();
  }

  const estadosOrigenValidos = Object.entries(TRANSICIONES)
    .filter(([, destinos]) => destinos.includes(nuevoEstado))
    .map(([origen]) => origen);

  if (estadosOrigenValidos.length === 0) {
    throw new TransicionInvalidaError();
  }

  try {
    const actualizado = await cotizacionesRepo.updateEstado(id, nuevoEstado, estadosOrigenValidos);
    if (actualizado) {
      return actualizado;
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new YaExisteAceptadaError();
    }
    throw error;
  }

  // El UPDATE no afectó ninguna fila: no existe, o su estado actual no
  // admite esta transición (misma técnica de mensaje que solicitudes).
  const actual = await cotizacionesRepo.findById(id);
  if (!actual) {
    throw new CotizacionNoEncontradaError();
  }
  throw new TransicionInvalidaError();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
