import { pool } from '../config/db.js';
import * as leadsRepo from '../repositories/leads.repository.js';
import { findByIdWithRol } from '../repositories/usuarios.repository.js';
import type { Lead, LeadSeguimiento } from '../repositories/leads.repository.js';

export class LeadNoEncontradoError extends Error {}
export class FuenteInvalidaError extends Error {}
export class ClienteNoEncontradoError extends Error {}
export class SolicitudNoEncontradaError extends Error {}
export class ComercialInvalidoError extends Error {}
export class ClasificacionNoPermitidaError extends Error {}
export class TransicionInvalidaError extends Error {}
export class SinEvidenciaError extends Error {}
export class TipoSeguimientoInvalidoError extends Error {}

const FUENTES_VALIDAS = ['WEB', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'REFERIDO', 'OTRO'];
const TIPOS_SEGUIMIENTO_VALIDOS = ['LLAMADA', 'WHATSAPP', 'EMAIL', 'VISITA', 'OTRO'];

export async function listarLeads(): Promise<Lead[]> {
  return leadsRepo.listAll();
}

export async function obtenerLead(id: string): Promise<Lead | null> {
  return leadsRepo.findById(id);
}

export interface CrearLeadInput {
  nombre: string;
  telefono: string;
  email: string | null;
  fuente: string;
}

// Captación pública: solo acepta los 4 campos mínimos de contacto.
// estado/clasificacion/comercial_id/cliente_id/solicitud_id NUNCA se
// reciben del body — quedan en sus valores por defecto (ACTIVO/FRIO/NULL),
// controlados exclusivamente por el backend (decisión aprobada).
export async function crearLead(input: CrearLeadInput): Promise<Lead> {
  if (!FUENTES_VALIDAS.includes(input.fuente)) {
    throw new FuenteInvalidaError();
  }
  return leadsRepo.create(pool, input);
}

export interface ActualizarLeadInput {
  nombre?: string;
  telefono?: string;
  email?: string | null;
  fuente?: string;
  observaciones?: string | null;
  cliente_id?: string | null;
  solicitud_id?: string | null;
  clasificacion?: string;
  estado?: string;
}

// Único punto de mutación general del lead. Cada campo se valida por
// separado; `clasificacion` y `estado` respetan estrictamente las reglas
// de la Fase 10 (ver comentarios inline) — ninguna se acepta "porque sí".
export async function actualizarLead(id: string, input: ActualizarLeadInput): Promise<Lead> {
  const actual = await leadsRepo.findById(id);
  if (!actual) {
    throw new LeadNoEncontradoError();
  }

  const cambios: Record<string, unknown> = {};
  let clasificacionEfectiva = actual.clasificacion;

  if (input.nombre !== undefined) cambios.nombre = input.nombre;
  if (input.telefono !== undefined) cambios.telefono = input.telefono;
  if (input.email !== undefined) cambios.email = input.email;
  if (input.observaciones !== undefined) cambios.observaciones = input.observaciones;

  if (input.fuente !== undefined) {
    if (!FUENTES_VALIDAS.includes(input.fuente)) {
      throw new FuenteInvalidaError();
    }
    cambios.fuente = input.fuente;
  }

  // `estado`: única transición permitida ACTIVO -> DESCARTADO, sin retorno
  // (mismo principio que el resto del proyecto: sin saltos hacia atrás).
  if (input.estado !== undefined) {
    if (input.estado !== 'DESCARTADO' || actual.estado === 'DESCARTADO') {
      throw new TransicionInvalidaError();
    }
    cambios.estado = 'DESCARTADO';
  }

  if (input.cliente_id !== undefined) {
    if (input.cliente_id !== null) {
      const existe = await leadsRepo.existeCliente(input.cliente_id);
      if (!existe) {
        throw new ClienteNoEncontradoError();
      }
    }
    cambios.cliente_id = input.cliente_id;
  }

  if (input.solicitud_id !== undefined) {
    if (input.solicitud_id !== null) {
      const solicitud = await leadsRepo.buscarSolicitud(input.solicitud_id);
      if (!solicitud) {
        throw new SolicitudNoEncontradaError();
      }
      // CALIENTE: efecto real de vincular una solicitud existente, no una
      // etiqueta manual — solo avanza si el lead venía de FRIO/TIBIO.
      if (clasificacionEfectiva === 'FRIO' || clasificacionEfectiva === 'TIBIO') {
        cambios.clasificacion = 'CALIENTE';
        clasificacionEfectiva = 'CALIENTE';
      }
    }
    cambios.solicitud_id = input.solicitud_id;
  }

  if (input.clasificacion !== undefined) {
    if (input.clasificacion === 'CONVERTIDO') {
      if (clasificacionEfectiva !== 'CALIENTE') {
        throw new TransicionInvalidaError();
      }
      const solicitudId = (input.solicitud_id ?? actual.solicitud_id) as string | null;
      if (!solicitudId) {
        throw new TransicionInvalidaError();
      }
      const tieneEvidencia = await leadsRepo.existeCotizacionAceptada(solicitudId);
      if (!tieneEvidencia) {
        throw new SinEvidenciaError();
      }
      cambios.clasificacion = 'CONVERTIDO';
      clasificacionEfectiva = 'CONVERTIDO';
    } else if (input.clasificacion === 'RECURRENTE') {
      if (clasificacionEfectiva !== 'CONVERTIDO') {
        throw new TransicionInvalidaError();
      }
      if (!actual.cliente_id) {
        throw new TransicionInvalidaError();
      }
      if (!actual.solicitud_id) {
        throw new TransicionInvalidaError();
      }
      const tieneEvidencia = await leadsRepo.existeSolicitudPosteriorALaConvertida(
        actual.cliente_id,
        actual.solicitud_id
      );
      if (!tieneEvidencia) {
        throw new SinEvidenciaError();
      }
      cambios.clasificacion = 'RECURRENTE';
    } else {
      // FRIO/TIBIO/CALIENTE nunca se aceptan como valor solicitado
      // directamente por quien llama al endpoint — son siempre efecto de
      // otra acción real (creación, seguimiento, vinculación).
      throw new ClasificacionNoPermitidaError();
    }
  }

  if (Object.keys(cambios).length === 0) {
    return actual;
  }

  const actualizado = await leadsRepo.update(id, cambios);
  if (!actualizado) {
    throw new LeadNoEncontradoError();
  }
  return actualizado;
}

// Asignación administrativa: exclusivamente organizativa (decisión
// aprobada explícitamente) — comercial_id NO se usa para autorización ni
// visibilidad en esta fase.
export async function asignarComercial(id: string, comercialId: string): Promise<Lead> {
  const lead = await leadsRepo.findById(id);
  if (!lead) {
    throw new LeadNoEncontradoError();
  }

  const usuario = await findByIdWithRol(comercialId);
  if (!usuario || usuario.rol !== 'COMERCIAL' || !usuario.activo) {
    throw new ComercialInvalidoError();
  }

  const actualizado = await leadsRepo.updateComercial(id, comercialId);
  if (!actualizado) {
    throw new LeadNoEncontradoError();
  }
  return actualizado;
}

export interface RegistrarSeguimientoInput {
  tipo: string;
  observacion: string | null;
}

// Historial real: cada llamada INSERTA un registro nuevo en
// lead_seguimientos — nunca sobrescribe uno anterior. `comercial_id` viene
// siempre de `req.user.sub` (resuelto en el controller, nunca del body) y
// `fecha` la fija PostgreSQL (DEFAULT CURRENT_TIMESTAMP). TIBIO: efecto
// real de que exista al menos un seguimiento — se evalúa sobre el estado
// del lead ANTES de este seguimiento (si venía de FRIO, avanza a TIBIO).
export async function registrarSeguimiento(
  id: string,
  comercialId: string,
  input: RegistrarSeguimientoInput
): Promise<{ lead: Lead; seguimiento: LeadSeguimiento }> {
  const actual = await leadsRepo.findById(id);
  if (!actual) {
    throw new LeadNoEncontradoError();
  }

  if (!TIPOS_SEGUIMIENTO_VALIDOS.includes(input.tipo)) {
    throw new TipoSeguimientoInvalidoError();
  }

  const seguimiento = await leadsRepo.crearSeguimiento(id, comercialId, input.tipo, input.observacion);

  let lead = actual;
  if (actual.clasificacion === 'FRIO') {
    const actualizado = await leadsRepo.update(id, { clasificacion: 'TIBIO' });
    if (actualizado) {
      lead = actualizado;
    }
  }

  return { lead, seguimiento };
}

export async function listarSeguimientosDeLead(id: string): Promise<LeadSeguimiento[]> {
  const lead = await leadsRepo.findById(id);
  if (!lead) {
    throw new LeadNoEncontradoError();
  }
  return leadsRepo.listarSeguimientos(id);
}
