import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import * as leadsRepo from '../repositories/leads.repository.js';
import * as clientesRepo from '../repositories/clientes.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
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
// Integridad Lead -> Cliente -> Solicitud: el `message` se envía tal cual al
// frontend (409), por eso cada lanzamiento lleva su propio texto.
export class VinculosBloqueadosError extends Error {}
export class IntegridadClienteSolicitudError extends Error {}
// Enlace de solicitud de un lead TIBIO.
export class LeadNoElegibleParaEnlaceError extends Error {}
export class EnlaceInvalidoError extends Error {}
export class EnlaceExpiradoError extends Error {}
export class EnlaceNoDisponibleError extends Error {}

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

// ASISTENTE-COMERCIAL-05 (autorización explícita — "evitar duplicación de
// Lead entre ambos formularios"): tipo de seguimiento y texto fijos para el
// registro automático que deja "Hablar con un asesor" cuando reutiliza un
// lead que ya existía (ver más abajo). 'OTRO' porque ninguno de los 4 tipos
// reales (LLAMADA/WHATSAPP/EMAIL/VISITA) describe con precisión un envío de
// este formulario.
const SEGUIMIENTO_TIPO_ASESOR = 'OTRO';
const SEGUIMIENTO_OBSERVACION_ASESOR = "Contacto realizado mediante formulario 'Hablar con un asesor'.";

// Captación pública: solo acepta los 4 campos mínimos de contacto.
// estado/clasificacion/comercial_id/cliente_id/solicitud_id NUNCA se
// reciben del body — quedan en sus valores por defecto (ACTIVO/FRIO/NULL) en
// el caso normal (lead nuevo), controlados exclusivamente por el backend
// (decisión aprobada).
//
// ASISTENTE-COMERCIAL-05: antes de crear un lead "en blanco", se busca uno
// YA EXISTENTE con el mismo teléfono normalizado + correo normalizado
// (coincidencia ALTA, única que dispara reutilización automática — ver
// leadsRepo.buscarPorTelefonoYEmail). Si existe y sigue en un estado
// reutilizable: NO se crea un lead nuevo — se registra un seguimiento sobre
// el lead existente (infraestructura ya existente, sin tabla nueva) y se
// promueve FRIO -> TIBIO sin nunca degradar una clasificación más avanzada.
// Nunca se crea Cliente ni Solicitud desde este flujo (sin cambios).
// Transacción + `FOR UPDATE` sobre la búsqueda: protege contra dos
// peticiones casi simultáneas que intenten reutilizar el MISMO lead ya
// existente (quedan serializadas). NO protege el caso de dos peticiones
// simultáneas cuyo lead todavía no existe — eso exigiría una restricción
// UNIQUE en BD, fuera del alcance autorizado en este bloque (ver informe).
export async function crearLead(input: CrearLeadInput): Promise<Lead> {
  if (!FUENTES_VALIDAS.includes(input.fuente)) {
    throw new FuenteInvalidaError();
  }

  if (!input.email) {
    // Sin correo no hay coincidencia ALTA posible (requiere ambos) — se
    // evita la ida a BD y la transacción innecesaria; comportamiento
    // idéntico al anterior (crea un lead nuevo en blanco).
    return leadsRepo.create(pool, input);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existente = await leadsRepo.buscarPorTelefonoYEmail(client, input.telefono, input.email);

    if (existente) {
      const promovido = await leadsRepo.promoverSiFrio(client, existente.id);
      if (promovido) {
        await leadsRepo.crearSeguimiento(existente.id, null, SEGUIMIENTO_TIPO_ASESOR, SEGUIMIENTO_OBSERVACION_ASESOR, client);
        await client.query('COMMIT');
        return promovido;
      }
      // El lead encontrado ya no es reutilizable (DESCARTADO/CONVERTIDO/
      // RECURRENTE) — nunca se reescribe automáticamente (mismo principio
      // que actualizarLead). Se cae al camino normal: crear un lead nuevo,
      // para no dejar este contacto sin registrar.
    }

    const nuevo = await leadsRepo.create(client, input);
    await client.query('COMMIT');
    return nuevo;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

  // Bloqueo por estado: un lead DESCARTADO, CONVERTIDO o RECURRENTE ya no
  // admite cambiar su cliente ni su solicitud. Solo cuenta como cambio un
  // valor distinto del almacenado (reenviar el mismo valor es inocuo).
  const cambiaCliente = input.cliente_id !== undefined && input.cliente_id !== actual.cliente_id;
  const cambiaSolicitud = input.solicitud_id !== undefined && input.solicitud_id !== actual.solicitud_id;
  const vinculosBloqueados =
    actual.estado === 'DESCARTADO' || actual.clasificacion === 'CONVERTIDO' || actual.clasificacion === 'RECURRENTE';
  if ((cambiaCliente || cambiaSolicitud) && vinculosBloqueados) {
    throw new VinculosBloqueadosError(
      'No se puede cambiar el cliente ni la solicitud de un lead DESCARTADO, CONVERTIDO o RECURRENTE.'
    );
  }

  // Un lead CALIENTE cuya solicitud vinculada ya tiene alguna cotización no
  // puede cambiar (ni desvincular) esa solicitud: se conserva la relación
  // histórica Lead -> Solicitud -> Cotización. Se valida antes de tocar nada.
  // Un lead CALIENTE sin cotización conserva el comportamiento anterior.
  if (cambiaSolicitud && actual.clasificacion === 'CALIENTE' && actual.solicitud_id) {
    if (await leadsRepo.existeCotizacionDeSolicitud(actual.solicitud_id)) {
      throw new VinculosBloqueadosError(
        'No se puede cambiar la solicitud de un lead CALIENTE cuya solicitud ya tiene una cotización asociada.'
      );
    }
  }

  const cambios: Record<string, unknown> = {};
  let clasificacionEfectiva = actual.clasificacion;
  // Valores FINALES de los vínculos tras aplicar el PATCH (no solo los
  // almacenados): sobre ellos se valida la coherencia Cliente <-> Solicitud.
  let clienteEfectivo: string | null = input.cliente_id !== undefined ? input.cliente_id : actual.cliente_id;
  const solicitudEfectivaId: string | null =
    input.solicitud_id !== undefined ? input.solicitud_id : actual.solicitud_id;
  let solicitudNueva: { id: string; cliente_id: string } | null = null;

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
      solicitudNueva = solicitud;
      // CALIENTE: efecto real de vincular una solicitud existente, no una
      // etiqueta manual — solo avanza si el lead venía de FRIO/TIBIO.
      if (clasificacionEfectiva === 'FRIO' || clasificacionEfectiva === 'TIBIO') {
        cambios.clasificacion = 'CALIENTE';
        clasificacionEfectiva = 'CALIENTE';
      }
    }
    cambios.solicitud_id = input.solicitud_id;
  }

  // Regla de integridad: solicitud.cliente_id = lead.cliente_id. Se valida
  // sobre los valores efectivos y ANTES de persistir (nada se escribe si
  // algo falla). Corre al tocar vínculos y al pedir CONVERTIDO/RECURRENTE
  // (para no respaldarlos con una relación incoherente); no bloquea PATCH
  // de otros campos sobre leads históricos.
  const tocaVinculos = input.cliente_id !== undefined || input.solicitud_id !== undefined;
  const pideConversion = input.clasificacion === 'CONVERTIDO' || input.clasificacion === 'RECURRENTE';
  if ((tocaVinculos || pideConversion) && solicitudEfectivaId) {
    const solicitud = solicitudNueva ?? (await leadsRepo.buscarSolicitud(solicitudEfectivaId));
    if (!solicitud) {
      throw new SolicitudNoEncontradaError();
    }
    if (clienteEfectivo === null) {
      // Lead sin cliente: al vincular una solicitud, el cliente se deriva de ella.
      if (input.solicitud_id && input.cliente_id === undefined) {
        cambios.cliente_id = solicitud.cliente_id;
        clienteEfectivo = solicitud.cliente_id;
      } else {
        throw new IntegridadClienteSolicitudError(
          'Un lead con solicitud vinculada debe tener también el cliente de esa solicitud.'
        );
      }
    } else if (solicitud.cliente_id !== clienteEfectivo) {
      throw new IntegridadClienteSolicitudError(
        input.solicitud_id
          ? 'La solicitud seleccionada pertenece a otro cliente. Solo se pueden vincular solicitudes del cliente del lead.'
          : 'El lead ya tiene una solicitud vinculada que pertenece a otro cliente; el cliente no puede cambiarse a uno incompatible.'
      );
    }
  }

  if (input.clasificacion !== undefined) {
    if (input.clasificacion === 'CONVERTIDO') {
      if (clasificacionEfectiva !== 'CALIENTE') {
        throw new TransicionInvalidaError();
      }
      const solicitudId = solicitudEfectivaId;
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
      if (!clienteEfectivo) {
        throw new TransicionInvalidaError();
      }
      if (!solicitudEfectivaId) {
        throw new TransicionInvalidaError();
      }
      const tieneEvidencia = await leadsRepo.existeSolicitudPosteriorALaConvertida(
        clienteEfectivo,
        solicitudEfectivaId
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

// ---------------------------------------------------------------------
// Enlace seguro de solicitud para un lead TIBIO.
// JWT stateless firmado con LEAD_LINK_SECRET (independiente de JWT_SECRET
// y de COTIZACION_LINK_SECRET), vigencia 7 días, sin código adicional. El
// navegador solo presenta el token: el lead sale SIEMPRE del token
// verificado y su estado se vuelve a leer de la BD en cada uso. El uso
// único no depende del token (stateless) sino de la condición transaccional
// ACTIVO + TIBIO + solicitud_id IS NULL. Regenerar no invalida enlaces
// anteriores: siguen válidos hasta usarse o caducar (decisión aprobada).
// ---------------------------------------------------------------------

const ENLACE_SOLICITUD_PURPOSE = 'solicitud_lead';
const ENLACE_SOLICITUD_EXPIRA_EN = '7d';

interface EnlaceSolicitudPayload {
  leadId: string;
  purpose: typeof ENLACE_SOLICITUD_PURPOSE;
}

function leadAdmiteEnlace(lead: Lead): boolean {
  return lead.estado === 'ACTIVO' && lead.clasificacion === 'TIBIO' && lead.solicitud_id === null;
}

export interface EnlaceSolicitudGenerado {
  token: string;
  expira_en: string;
}

export async function generarEnlaceSolicitud(id: string): Promise<EnlaceSolicitudGenerado> {
  const lead = await leadsRepo.findById(id);
  if (!lead) {
    throw new LeadNoEncontradoError();
  }
  if (!leadAdmiteEnlace(lead)) {
    throw new LeadNoElegibleParaEnlaceError();
  }

  const payload: EnlaceSolicitudPayload = { leadId: lead.id, purpose: ENLACE_SOLICITUD_PURPOSE };
  const token = jwt.sign(payload, env.leadLinkSecret, { algorithm: 'HS256', expiresIn: ENLACE_SOLICITUD_EXPIRA_EN });
  const { exp } = jwt.decode(token) as { exp: number };
  return { token, expira_en: new Date(exp * 1000).toISOString() };
}

// Verifica firma + algoritmo + expiración + propósito y devuelve el leadId
// real del token. Un token de cotización falla aquí (otro secreto).
function verificarTokenEnlaceSolicitud(token: string): string {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.leadLinkSecret, { algorithms: ['HS256'] });
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new EnlaceExpiradoError();
    }
    throw new EnlaceInvalidoError();
  }

  if (typeof decoded !== 'object' || decoded === null) {
    throw new EnlaceInvalidoError();
  }
  const payload = decoded as Partial<EnlaceSolicitudPayload>;
  if (payload.purpose !== ENLACE_SOLICITUD_PURPOSE || typeof payload.leadId !== 'string') {
    throw new EnlaceInvalidoError();
  }
  return payload.leadId;
}

// Solo confirma que el enlace es válido y sigue disponible. No devuelve
// ningún dato del lead y no consume nada (los previsualizadores de
// mensajería pueden abrirlo sin efectos).
export async function validarEnlaceSolicitud(token: string): Promise<{ valido: true }> {
  const leadId = verificarTokenEnlaceSolicitud(token);
  const lead = await leadsRepo.findById(leadId);
  if (!lead) {
    throw new EnlaceInvalidoError();
  }
  if (!leadAdmiteEnlace(lead)) {
    throw new EnlaceNoDisponibleError();
  }
  return { valido: true };
}

export interface CrearSolicitudPorEnlaceInput {
  nombre: string;
  empresa: string | null;
  email: string;
  telefono: string;
  servicio: string;
  descripcion: string;
  cantidad: number;
  fechaRequerida: string | null;
}

// Una única transacción: bloquea el lead, resuelve el cliente (el del lead
// si ya lo tiene; si no, find-or-create por email, igual que el formulario
// público), crea la solicitud y vincula + promueve TIBIO -> CALIENTE con la
// condición de uso único. Cualquier fallo revierte todo.
export async function crearSolicitudPorEnlace(token: string, input: CrearSolicitudPorEnlaceInput): Promise<void> {
  const leadId = verificarTokenEnlaceSolicitud(token);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lead = await leadsRepo.findByIdForUpdate(client, leadId);
    if (!lead) {
      throw new EnlaceInvalidoError();
    }
    if (!leadAdmiteEnlace(lead)) {
      throw new EnlaceNoDisponibleError();
    }

    let clienteId = lead.cliente_id;
    if (!clienteId) {
      const emailNormalizado = input.email.trim().toLowerCase();
      const existente = await clientesRepo.findByEmail(client, emailNormalizado);
      const cliente =
        existente ??
        (await clientesRepo.create(client, {
          nombre: input.nombre.trim(),
          empresa: input.empresa?.trim() || null,
          email: emailNormalizado,
          telefono: input.telefono.trim(),
        }));
      clienteId = cliente.id;
    }

    const solicitud = await solicitudesRepo.create(client, {
      clienteId,
      servicio: input.servicio.trim(),
      descripcion: input.descripcion.trim(),
      cantidad: input.cantidad,
      fechaRequerida: input.fechaRequerida,
    });

    const vinculado = await leadsRepo.vincularSolicitudDesdeEnlace(client, {
      leadId: lead.id,
      clienteId,
      solicitudId: solicitud.id,
    });
    if (!vinculado) {
      throw new EnlaceNoDisponibleError();
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
