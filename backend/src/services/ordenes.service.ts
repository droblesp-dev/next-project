import { pool } from '../config/db.js';
import * as ordenesRepo from '../repositories/ordenes.repository.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import * as evidenciasRepo from '../repositories/ordenEvidencia.repository.js';
import { findByIdWithRol } from '../repositories/usuarios.repository.js';
import type { Orden } from '../repositories/ordenes.repository.js';

export class CotizacionNoEncontradaError extends Error {}
export class CotizacionNoAceptadaError extends Error {}
export class AnticipoNoConfirmadoError extends Error {}
export class OrdenYaExisteError extends Error {}
export class OrdenNoEncontradaError extends Error {}
export class TransicionInvalidaError extends Error {}
export class EstadoInvalidoError extends Error {}
export class ResponsableInvalidoError extends Error {}
export class FechaEntregaInvalidaError extends Error {}
export class AvanceInvalidoError extends Error {}
export class AvanceNoModificableError extends Error {}
export class AvanceIncompletoError extends Error {}
export class EvidenciaFaltanteError extends Error {}
export class ObservacionFaltanteError extends Error {}
export class OrdenNoFinalizadaError extends Error {}
export class SaldoNoValidadoError extends Error {}
export class EntregaNoConfirmadaError extends Error {}
export class EntregaEstadoInvalidoError extends Error {}

const ESTADOS_VALIDOS = ['PENDIENTE', 'EN_PROCESO', 'PAUSADA', 'FINALIZADA', 'CERRADA', 'CANCELADA'];

// Transiciones alcanzables mediante el endpoint genérico PATCH /:id/estado.
// CANCELADA es terminal. Bloque saldo/entrega/cierre: CERRADA se retira de
// aquí a propósito — decisión explícita de que NO se puede alcanzar por
// este endpoint genérico. La única vía a CERRADA es el endpoint dedicado
// PATCH /:id/cerrar (ver cerrarOrden), que exige además saldo VALIDADO y
// entrega confirmada. `CERRADA` permanece en ESTADOS_VALIDOS porque sigue
// siendo un valor legítimo de `ordenes.estado`.
const TRANSICIONES: Record<string, string[]> = {
  PENDIENTE: ['EN_PROCESO', 'CANCELADA'],
  EN_PROCESO: ['PAUSADA', 'FINALIZADA', 'CANCELADA'],
  PAUSADA: ['EN_PROCESO', 'CANCELADA'],
  FINALIZADA: [],
  CERRADA: [],
  CANCELADA: [],
};

// Estados en los que ya no tiene sentido seguir reportando avance
// (decisión del bloque: el service, no la DB, gobierna esta regla — ver
// CLAUDE.md §10).
const ESTADOS_AVANCE_BLOQUEADO = ['FINALIZADA', 'CERRADA', 'CANCELADA'];

export async function listarOrdenes(): Promise<Orden[]> {
  return ordenesRepo.listAll();
}

export async function obtenerOrden(id: string): Promise<Orden | null> {
  return ordenesRepo.findById(id);
}

export interface CrearOrdenInput {
  cotizacionId: string;
  descripcion: string | null;
  fechaEntrega?: string | null;
}

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Validación de formato + calendario real (ej. rechaza "2026-02-30").
// No valida que sea futura: una fecha pasada es un dato válido (permite,
// por ejemplo, generar evidencia real de vencimiento en Fase 11).
function esFechaValida(fecha: string): boolean {
  if (!FECHA_REGEX.test(fecha)) {
    return false;
  }
  const fechaUtc = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(fechaUtc.getTime()) && fechaUtc.toISOString().slice(0, 10) === fecha;
}

// Solo se permite crear una orden desde una cotización existente y en
// estado ACEPTADA (decisión aprobada). No cambia cotizaciones.estado.
// `fechaEntrega` es opcional (ajuste mínimo autorizado de Fase 8 para dar
// soporte a la automatización de Fase 11); no se modifica ninguna otra
// regla de negocio de esta función.
//
// Fase D.7: además de ACEPTADA, la cotización debe tener su anticipo
// resuelto — NO_APLICA (anticipo 0%, nada que confirmar) o VALIDADO
// (Comercial ya confirmó la recepción). PENDIENTE o RECHAZADO bloquean la
// creación. Cualquier otro valor (incluido NULL) se trata también como
// bloqueante por seguridad (denegar por defecto) — ver [HALLAZGO] en el
// reporte de esta sub-fase sobre cotizaciones ACEPTADA anteriores a D.2
// que nunca tuvieron estado_anticipo asignado.
export async function crearOrden(input: CrearOrdenInput): Promise<Orden> {
  const cotizacion = await cotizacionesRepo.findById(input.cotizacionId);
  if (!cotizacion) {
    throw new CotizacionNoEncontradaError();
  }
  if (cotizacion.estado !== 'ACEPTADA') {
    throw new CotizacionNoAceptadaError();
  }
  if (cotizacion.estado_anticipo !== 'NO_APLICA' && cotizacion.estado_anticipo !== 'VALIDADO') {
    throw new AnticipoNoConfirmadoError();
  }

  const fechaEntrega = input.fechaEntrega ?? null;
  if (fechaEntrega !== null && !esFechaValida(fechaEntrega)) {
    throw new FechaEntregaInvalidaError();
  }

  try {
    return await ordenesRepo.create(pool, {
      cotizacionId: input.cotizacionId,
      descripcion: input.descripcion,
      fechaEntrega,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new OrdenYaExisteError();
    }
    throw error;
  }
}

// Bloque avance/evidencia, decisión: la observación final viaja opcionalmente
// con el PATCH de estado y se guarda en `ordenes.observaciones` (columna ya
// existente, sin uso previo — no se crea una columna nueva). Al transicionar
// a FINALIZADA se exige, además, avance = 100 y al menos 1 evidencia
// (cualquier tipo, no ambos formatos).
export async function cambiarEstadoOrden(
  id: string,
  nuevoEstado: string,
  observaciones?: string
): Promise<Orden> {
  if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
    throw new EstadoInvalidoError();
  }

  const estadosOrigenValidos = Object.entries(TRANSICIONES)
    .filter(([, destinos]) => destinos.includes(nuevoEstado))
    .map(([origen]) => origen);

  if (estadosOrigenValidos.length === 0) {
    throw new TransicionInvalidaError();
  }

  if (nuevoEstado === 'FINALIZADA') {
    const orden = await ordenesRepo.findById(id);
    if (!orden) {
      throw new OrdenNoEncontradaError();
    }
    if (orden.avance !== 100) {
      throw new AvanceIncompletoError();
    }
    const totalEvidencias = await evidenciasRepo.contarTotal(id);
    if (totalEvidencias < 1) {
      throw new EvidenciaFaltanteError();
    }
    const observacionFinal = observaciones !== undefined ? observaciones.trim() : orden.observaciones;
    if (!observacionFinal || !observacionFinal.trim()) {
      throw new ObservacionFaltanteError();
    }
  }

  const actualizado = await ordenesRepo.updateEstado(
    id,
    nuevoEstado,
    estadosOrigenValidos,
    observaciones !== undefined ? observaciones.trim() : undefined
  );
  if (actualizado) {
    return actualizado;
  }

  const actual = await ordenesRepo.findById(id);
  if (!actual) {
    throw new OrdenNoEncontradaError();
  }
  throw new TransicionInvalidaError();
}

// Endpoint separado (decisión explícita del bloque: no mezclar con el
// cambio de estado genérico). Solo ADMIN/OPERATIVO llegan aquí (routes);
// se bloquea en estados terminales para evitar reportar avance sobre una
// orden ya finalizada/cerrada/cancelada.
export async function actualizarAvance(id: string, avance: number): Promise<Orden> {
  if (!Number.isInteger(avance) || avance < 0 || avance > 100) {
    throw new AvanceInvalidoError();
  }

  const orden = await ordenesRepo.findById(id);
  if (!orden) {
    throw new OrdenNoEncontradaError();
  }
  if (ESTADOS_AVANCE_BLOQUEADO.includes(orden.estado)) {
    throw new AvanceNoModificableError();
  }

  const actualizado = await ordenesRepo.updateAvance(id, avance);
  if (!actualizado) {
    throw new OrdenNoEncontradaError();
  }
  return actualizado;
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

// Bloque saldo/entrega/cierre. Endpoint separado del cambio de estado
// genérico (decisión explícita); exclusivo de ADMIN/COMERCIAL (routes) —
// OPERATIVO nunca confirma entrega. Sin restricción de estado de la orden
// (no se pidió esa restricción); simplemente registra el momento real de
// entrega, reutilizable las veces que sea necesario.
// H-D (auditoría post-V9): solo procede si la orden está realmente
// FINALIZADA en el instante del UPDATE (atómico, ver
// ordenes.repository.ts::confirmarEntrega). Bloquea PENDIENTE, EN_PROCESO,
// PAUSADA, CANCELADA y CERRADA.
export async function confirmarEntregaOrden(id: string): Promise<Orden> {
  const actualizado = await ordenesRepo.confirmarEntrega(id);
  if (actualizado) {
    return actualizado;
  }

  const actual = await ordenesRepo.findById(id);
  if (!actual) {
    throw new OrdenNoEncontradaError();
  }
  throw new EntregaEstadoInvalidoError();
}

// Bloque saldo/entrega/cierre. Única vía para alcanzar CERRADA (decisión
// explícita: el endpoint genérico de estado ya no permite esta
// transición, ver TRANSICIONES). Exige, en este orden: la orden debe
// estar FINALIZADA; la cotización asociada debe tener estado_saldo =
// VALIDADO; la orden debe tener entrega_confirmada_en asignado. Si no se
// cumple alguna condición, la orden permanece FINALIZADA — no existe
// ningún mecanismo de reintento automático.
export async function cerrarOrden(id: string): Promise<Orden> {
  const orden = await ordenesRepo.findById(id);
  if (!orden) {
    throw new OrdenNoEncontradaError();
  }
  if (orden.estado !== 'FINALIZADA') {
    throw new OrdenNoFinalizadaError();
  }

  const cotizacion = await cotizacionesRepo.findById(orden.cotizacion_id);
  if (!cotizacion) {
    throw new CotizacionNoEncontradaError();
  }
  if (cotizacion.estado_saldo !== 'VALIDADO') {
    throw new SaldoNoValidadoError();
  }
  if (!orden.entrega_confirmada_en) {
    throw new EntregaNoConfirmadaError();
  }

  const actualizado = await ordenesRepo.updateEstado(id, 'CERRADA', ['FINALIZADA']);
  if (!actualizado) {
    // Condición de carrera: el estado cambió entre la verificación y el
    // UPDATE (ej. otra pestaña canceló la orden justo antes).
    throw new OrdenNoFinalizadaError();
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
