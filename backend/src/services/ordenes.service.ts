import { pool } from '../config/db.js';
import * as ordenesRepo from '../repositories/ordenes.repository.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import { findByIdWithRol } from '../repositories/usuarios.repository.js';
import type { Orden } from '../repositories/ordenes.repository.js';

export class CotizacionNoEncontradaError extends Error {}
export class CotizacionNoAceptadaError extends Error {}
export class OrdenYaExisteError extends Error {}
export class OrdenNoEncontradaError extends Error {}
export class TransicionInvalidaError extends Error {}
export class EstadoInvalidoError extends Error {}
export class ResponsableInvalidoError extends Error {}

const ESTADOS_VALIDOS = ['PENDIENTE', 'EN_PROCESO', 'FINALIZADA', 'CERRADA', 'CANCELADA'];

// Transiciones aprobadas para Fase 8 (autorización explícita). CERRADA y
// CANCELADA son terminales.
const TRANSICIONES: Record<string, string[]> = {
  PENDIENTE: ['EN_PROCESO', 'CANCELADA'],
  EN_PROCESO: ['FINALIZADA', 'CANCELADA'],
  FINALIZADA: ['CERRADA'],
  CERRADA: [],
  CANCELADA: [],
};

export async function listarOrdenes(): Promise<Orden[]> {
  return ordenesRepo.listAll();
}

export async function obtenerOrden(id: string): Promise<Orden | null> {
  return ordenesRepo.findById(id);
}

export interface CrearOrdenInput {
  cotizacionId: string;
  descripcion: string | null;
}

// Solo se permite crear una orden desde una cotización existente y en
// estado ACEPTADA (decisión aprobada). No cambia cotizaciones.estado.
export async function crearOrden(input: CrearOrdenInput): Promise<Orden> {
  const cotizacion = await cotizacionesRepo.findById(input.cotizacionId);
  if (!cotizacion) {
    throw new CotizacionNoEncontradaError();
  }
  if (cotizacion.estado !== 'ACEPTADA') {
    throw new CotizacionNoAceptadaError();
  }

  try {
    return await ordenesRepo.create(pool, {
      cotizacionId: input.cotizacionId,
      descripcion: input.descripcion,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new OrdenYaExisteError();
    }
    throw error;
  }
}

export async function cambiarEstadoOrden(id: string, nuevoEstado: string): Promise<Orden> {
  if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
    throw new EstadoInvalidoError();
  }

  const estadosOrigenValidos = Object.entries(TRANSICIONES)
    .filter(([, destinos]) => destinos.includes(nuevoEstado))
    .map(([origen]) => origen);

  if (estadosOrigenValidos.length === 0) {
    throw new TransicionInvalidaError();
  }

  const actualizado = await ordenesRepo.updateEstado(id, nuevoEstado, estadosOrigenValidos);
  if (actualizado) {
    return actualizado;
  }

  const actual = await ordenesRepo.findById(id);
  if (!actual) {
    throw new OrdenNoEncontradaError();
  }
  throw new TransicionInvalidaError();
}

// `responsable_id` debe corresponder a un usuario existente, con rol
// OPERATIVO y activo=true (decisión aprobada explícitamente para Fase 8).
export async function asignarResponsable(id: string, responsableId: string): Promise<Orden> {
  const orden = await ordenesRepo.findById(id);
  if (!orden) {
    throw new OrdenNoEncontradaError();
  }

  const usuario = await findByIdWithRol(responsableId);
  if (!usuario || usuario.rol !== 'OPERATIVO' || !usuario.activo) {
    throw new ResponsableInvalidoError();
  }

  const actualizado = await ordenesRepo.updateResponsable(id, responsableId);
  if (!actualizado) {
    throw new OrdenNoEncontradaError();
  }
  return actualizado;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
