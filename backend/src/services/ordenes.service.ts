import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import * as ordenesRepo from '../repositories/ordenes.repository.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import * as evidenciasRepo from '../repositories/ordenEvidencia.repository.js';
import * as alertasRepo from '../repositories/alertas.repository.js';
import { findByIdWithRol, findByEmailWithRol } from '../repositories/usuarios.repository.js';
import type { Orden } from '../repositories/ordenes.repository.js';

export class CotizacionNoEncontradaError extends Error {}
export class CotizacionNoAceptadaError extends Error {}
export class AnticipoNoConfirmadoError extends Error {}
export class OrdenYaExisteError extends Error {}
export class OrdenNoEncontradaError extends Error {}
export class TransicionInvalidaError extends Error {}
export class EstadoInvalidoError extends Error {}
export class ResponsableInvalidoError extends Error {}
// Bloque 1: no hay un OPERATIVO por defecto válido para asignar a la orden nueva.
// `motivo` es solo para el registro del servidor; al cliente se le responde un mensaje genérico.
export class OperativoPorDefectoInvalidoError extends Error {
  constructor(public readonly motivo: 'NO_CONFIGURADO' | 'NO_EXISTE' | 'INACTIVO' | 'ROL_INVALIDO') {
    super(`OPERATIVO por defecto no válido: ${motivo}`);
  }
}
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
// Bloque 3B.
export class AvanceRegresivoError extends Error {}
export class ObservacionInvalidaError extends Error {
  constructor(message: string) {
    super(message);
  }
}
export class OrdenTerminalError extends Error {}
export class EntregaYaConfirmadaError extends Error {}
export class MotivoCancelacionInvalidoError extends Error {
  constructor(message: string) {
    super(message);
  }
}
export class FechaEntregaAnteriorAInicioError extends Error {}
// Bloque 3B.1: PENDIENTE solo admite avance = 0; un intento de fijar avance > 0 mientras la orden no
// ha pasado a EN_PROCESO se rechaza con este error específico (distinto de AvanceNoModificableError,
// que sigue siendo para los estados terminales, y de AvanceRegresivoError).
export class AvanceNoPermitidoEnPendienteError extends Error {}

const ESTADOS_VALIDOS = ['PENDIENTE', 'EN_PROCESO', 'PAUSADA', 'FINALIZADA', 'CERRADA', 'CANCELADA'];

// Longitud máxima de `ordenes.observaciones` — comparte columna entre la observación de
// finalización y el motivo de cancelación (ver cancelarOrden). Bloque 3B: la auditoría del Bloque
// 3A detectó que no existía ningún límite (se aceptaban 90.000 caracteres).
const OBSERVACION_MAX_CARACTERES = 2000;

// Transiciones alcanzables mediante el endpoint genérico PATCH /:id/estado.
// Bloque saldo/entrega/cierre: CERRADA se retira de aquí a propósito —
// decisión explícita de que NO se puede alcanzar por este endpoint
// genérico. La única vía a CERRADA es el endpoint dedicado PATCH
// /:id/cerrar (ver cerrarOrden), que exige además saldo VALIDADO y
// entrega confirmada.
// Bloque 3B: CANCELADA se retira de aquí por el mismo motivo (decisión
// explícita, mismo patrón ya usado para CERRADA) — la única vía es el
// endpoint dedicado PATCH /:id/cancelar (ver cancelarOrden), exclusivo de
// ADMIN/COMERCIAL (antes OPERATIVO podía cancelar su propia orden por
// aquí, vía E-01) y que exige un motivo. `CERRADA` y `CANCELADA`
// permanecen en ESTADOS_VALIDOS porque siguen siendo valores legítimos de
// `ordenes.estado`.
const TRANSICIONES: Record<string, string[]> = {
  PENDIENTE: ['EN_PROCESO'],
  EN_PROCESO: ['PAUSADA', 'FINALIZADA'],
  PAUSADA: ['EN_PROCESO'],
  FINALIZADA: [],
  CERRADA: [],
  CANCELADA: [],
};

// Bloque 3B: mismos orígenes que antes admitían CANCELADA en TRANSICIONES — la cancelación sigue
// alcanzable exactamente desde los mismos 3 estados que antes, solo cambia el endpoint y quién
// puede invocarlo.
const ESTADOS_CANCELABLES = ['PENDIENTE', 'EN_PROCESO', 'PAUSADA'];

// Estados en los que ya no tiene sentido seguir reportando avance
// (decisión del bloque: el service, no la DB, gobierna esta regla — ver
// CLAUDE.md §10).
const ESTADOS_AVANCE_BLOQUEADO = ['FINALIZADA', 'CERRADA', 'CANCELADA'];

// Bloque 3B: ADMIN solo puede reasignar responsable mientras la orden no sea terminal.
const ESTADOS_REASIGNACION_BLOQUEADA = ['FINALIZADA', 'CERRADA', 'CANCELADA'];

// Bloque 3B: la fecha PROGRAMADA de entrega (`fecha_entrega`) no se reprograma sobre una orden
// terminal; tampoco si la entrega REAL (`entrega_confirmada_en`) ya se confirmó (repository).
const ESTADOS_REPROGRAMACION_BLOQUEADA = ['CERRADA', 'CANCELADA'];

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

// Bloque 1: el backend decide quién es el responsable de una orden nueva.
// Se resuelve por correo configurado en OPERATIVO_POR_DEFECTO_EMAIL y se
// valida en cada creación (existe, activo, rol OPERATIVO); nunca se acepta
// un responsable indicado por el cliente.
async function resolverOperativoPorDefecto(): Promise<string> {
  const email = env.operativoPorDefectoEmail;
  if (!email) {
    throw new OperativoPorDefectoInvalidoError('NO_CONFIGURADO');
  }
  const usuario = await findByEmailWithRol(email);
  if (!usuario) {
    throw new OperativoPorDefectoInvalidoError('NO_EXISTE');
  }
  if (!usuario.activo) {
    throw new OperativoPorDefectoInvalidoError('INACTIVO');
  }
  if (usuario.rol !== 'OPERATIVO') {
    throw new OperativoPorDefectoInvalidoError('ROL_INVALIDO');
  }
  return usuario.id;
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

  const responsableId = await resolverOperativoPorDefecto();

  // La solicitud se bloquea mientras se crea la orden para serializarla con el envío de mensajes del chat (el régimen de
  // acceso cambia de «participantes» a «responsable de la orden» al existir la orden).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ordenesRepo.bloquearSolicitudDeCotizacion(client, input.cotizacionId);
    const orden = await ordenesRepo.create(client, {
      cotizacionId: input.cotizacionId,
      descripcion: input.descripcion,
      fechaEntrega,
      responsableId,
    });
    await client.query('COMMIT');
    return orden;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (isUniqueViolation(error)) {
      throw new OrdenYaExisteError();
    }
    throw error;
  } finally {
    client.release();
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
  observaciones?: string,
  actorId?: string
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

  // Bloque 3B: límite de longitud, cualquiera sea la transición (antes no existía — la auditoría del
  // Bloque 3A encontró que se aceptaban 90.000 caracteres). Se mide sobre el valor ya recortado.
  const observacionRecortada = observaciones !== undefined ? observaciones.trim() : undefined;
  if (observacionRecortada !== undefined && observacionRecortada.length > OBSERVACION_MAX_CARACTERES) {
    throw new ObservacionInvalidaError(`observaciones no puede superar ${OBSERVACION_MAX_CARACTERES} caracteres.`);
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
    const observacionFinal = observacionRecortada !== undefined ? observacionRecortada : orden.observaciones;
    if (!observacionFinal || !observacionFinal.trim()) {
      throw new ObservacionFaltanteError();
    }
  }

  // Bloque 3B: en cualquier transición que NO sea FINALIZADA, un `observaciones: ""` (vacío tras el
  // recorte) ya NO se guarda — se trata como si no se hubiera enviado, para no borrar por accidente
  // una observación existente (hallazgo de la auditoría previa a 3A). Para FINALIZADA no aplica: un
  // valor vacío ya fue rechazado arriba con ObservacionFaltanteError si no había una previa.
  const observacionParaGuardar =
    nuevoEstado !== 'FINALIZADA' && observacionRecortada === '' ? undefined : observacionRecortada;

  const actualizado = await ordenesRepo.updateEstado(id, nuevoEstado, estadosOrigenValidos, observacionParaGuardar, actorId);
  if (actualizado) {
    if (nuevoEstado === 'EN_PROCESO' && actualizado.fecha_inicio === null) {
      // Bloque 3A: la orden ya inició pero su fecha_inicio no pudo registrarse (fecha_entrega anterior a hoy
      // y CHECK chk_ordenes_fechas). Se deja constancia técnica; la orden sí inicia. [REQUIERE DECISIÓN]
      console.warn(`[ordenes] fecha_inicio no registrada para la orden ${id}: fecha_entrega anterior a la fecha de inicio.`);
    }
    return actualizado;
  }

  const actual = await ordenesRepo.findById(id);
  if (!actual) {
    throw new OrdenNoEncontradaError();
  }
  // Bloque 3A: el UPDATE de FINALIZADA comprueba avance/evidencia/observación de forma atómica. Si
  // no aplicó aunque el origen era válido, un cambio concurrente incumplió un requisito entre la
  // lectura y el UPDATE: se informa el requisito que falta (mismos errores que la pre-comprobación).
  if (nuevoEstado === 'FINALIZADA' && estadosOrigenValidos.includes(actual.estado)) {
    if (actual.avance !== 100) {
      throw new AvanceIncompletoError();
    }
    if ((await evidenciasRepo.contarTotal(id)) < 1) {
      throw new EvidenciaFaltanteError();
    }
    const observacionFinal = observacionRecortada !== undefined ? observacionRecortada : actual.observaciones;
    if (!observacionFinal || !observacionFinal.trim()) {
      throw new ObservacionFaltanteError();
    }
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

  // Bloque 3A: el estado se comprueba dentro del propio UPDATE (atómico). Bloque 3B: el UPDATE
  // agrega `avance <= $2` en el mismo WHERE — el avance nunca puede disminuir, y al estar en la
  // misma condición atómica, dos PATCH simultáneos (uno subiendo, otro bajando) no pueden dejar
  // ganando al valor más bajo. Si no aplica, se lee la orden para distinguir "no existe" (404) de
  // "estado que no admite avance" (409) de "el valor es menor al actual" (409).
  const actualizado = await ordenesRepo.updateAvance(id, avance, ESTADOS_AVANCE_BLOQUEADO);
  if (actualizado) {
    return actualizado;
  }

  const orden = await ordenesRepo.findById(id);
  if (!orden) {
    throw new OrdenNoEncontradaError();
  }
  if (ESTADOS_AVANCE_BLOQUEADO.includes(orden.estado)) {
    throw new AvanceNoModificableError();
  }
  if (avance < orden.avance) {
    throw new AvanceRegresivoError();
  }
  // Bloque 3B.1: PENDIENTE con avance > 0 solicitado (el único motivo restante por el que la
  // condición atómica podía no aplicar, descartados ya los dos casos anteriores).
  if (orden.estado === 'PENDIENTE' && avance > 0) {
    throw new AvanceNoPermitidoEnPendienteError();
  }
  // Condición de carrera: el estado cambió a uno bloqueado justo entre el UPDATE y esta lectura.
  throw new AvanceNoModificableError();
}

// `responsable_id` debe corresponder a un usuario existente, con rol
// OPERATIVO y activo=true (decisión aprobada explícitamente para Fase 8;
// esa validación no cambia en el Bloque 3B).
// Bloque 3B: ADMIN solo puede reasignar mientras la orden esté PENDIENTE, EN_PROCESO o PAUSADA. El
// UPDATE es atómico (ver ordenes.repository.ts::updateResponsable); si la orden es terminal
// (FINALIZADA/CERRADA/CANCELADA), el UPDATE no aplica y `responsable_id` no cambia.
export async function asignarResponsable(id: string, responsableId: string): Promise<Orden> {
  const orden = await ordenesRepo.findById(id);
  if (!orden) {
    throw new OrdenNoEncontradaError();
  }

  const usuario = await findByIdWithRol(responsableId);
  if (!usuario || usuario.rol !== 'OPERATIVO' || !usuario.activo) {
    throw new ResponsableInvalidoError();
  }

  const actualizado = await ordenesRepo.updateResponsable(id, responsableId, ESTADOS_REASIGNACION_BLOQUEADA);
  if (actualizado) {
    // #7: si el responsable cambió, se avisa al nuevo responsable mediante una alerta de la orden. Es un paso posterior a
    // la reasignación: un fallo se registra y nunca revierte ni bloquea la reasignación ya hecha.
    if (orden.responsable_id !== responsableId) {
      try {
        await alertasRepo.crearAlertaReasignacion(id, `La orden ${actualizado.codigo} fue asignada a ${usuario.nombre}.`);
      } catch (error) {
        console.error('No se pudo crear el aviso de reasignación de la orden', id, '-', error instanceof Error ? error.message : error);
      }
    }
    return actualizado;
  }

  const actual = await ordenesRepo.findById(id);
  if (!actual) {
    throw new OrdenNoEncontradaError();
  }
  throw new OrdenTerminalError();
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
// Bloque 3B: idempotente — una segunda confirmación ya NO sobrescribe la fecha real
// (`entrega_confirmada_en`) ya registrada (repository). Se distingue "no está FINALIZADA" (mismo
// error de siempre) de "ya estaba confirmada" (nuevo error, deja la fecha original intacta).
export async function confirmarEntregaOrden(id: string, actorId?: string): Promise<Orden> {
  const actualizado = await ordenesRepo.confirmarEntrega(id, actorId);
  if (actualizado) {
    return actualizado;
  }

  const actual = await ordenesRepo.findById(id);
  if (!actual) {
    throw new OrdenNoEncontradaError();
  }
  if (actual.estado !== 'FINALIZADA') {
    throw new EntregaEstadoInvalidoError();
  }
  throw new EntregaYaConfirmadaError();
}

// Bloque 3B: cancelación con motivo obligatorio. Única vía para alcanzar CANCELADA (decisión
// explícita, mismo patrón ya usado para CERRADA — ver TRANSICIONES): reutiliza
// ordenesRepo.updateEstado tal cual, pasando el motivo por el parámetro `observaciones` ya
// existente (misma columna que la observación de finalización; no se crea ninguna columna nueva).
// Los orígenes válidos son los mismos 3 estados que antes admitían CANCELADA en TRANSICIONES.
export async function cancelarOrden(id: string, motivo: string, actorId?: string): Promise<Orden> {
  const motivoRecortado = motivo.trim();
  if (!motivoRecortado) {
    throw new MotivoCancelacionInvalidoError('motivo es requerido y no puede estar vacío.');
  }
  if (motivoRecortado.length > OBSERVACION_MAX_CARACTERES) {
    throw new MotivoCancelacionInvalidoError(`motivo no puede superar ${OBSERVACION_MAX_CARACTERES} caracteres.`);
  }

  const actualizado = await ordenesRepo.updateEstado(id, 'CANCELADA', ESTADOS_CANCELABLES, motivoRecortado, actorId);
  if (actualizado) {
    // ALERTAS-02 (decisión 7A): una orden CANCELADA ya no requiere atención por fecha de entrega —
    // cualquier alerta ENTREGA pendiente de esta orden se resuelve (preserva historial, sin borrar).
    await alertasRepo.resolverAlertasEntregaObsoletas(id);
    return actualizado;
  }

  const actual = await ordenesRepo.findById(id);
  if (!actual) {
    throw new OrdenNoEncontradaError();
  }
  throw new TransicionInvalidaError();
}

// Bloque 3B: reprogramación de la fecha PROGRAMADA de entrega (`fecha_entrega`). Distinta de la
// fecha REAL (`entrega_confirmada_en`, gestionada por confirmarEntregaOrden) — reprogramar nunca
// marca la orden como entregada ni toca esa columna. Bloqueada en estados terminales y una vez que
// la entrega real ya se confirmó (repository). El CHECK `chk_ordenes_fechas` (fecha_entrega >=
// fecha_inicio, ya existente, sin tocar) puede rechazar el UPDATE — se traduce a un error de
// dominio específico en vez de dejar propagar el error crudo de PostgreSQL.
export async function reprogramarFechaEntrega(id: string, fechaEntrega: string): Promise<Orden> {
  if (!esFechaValida(fechaEntrega)) {
    throw new FechaEntregaInvalidaError();
  }

  let actualizado: Orden | null;
  try {
    actualizado = await ordenesRepo.updateFechaEntrega(id, fechaEntrega, ESTADOS_REPROGRAMACION_BLOQUEADA);
  } catch (error) {
    if (isCheckViolation(error, 'chk_ordenes_fechas')) {
      throw new FechaEntregaAnteriorAInicioError();
    }
    throw error;
  }
  if (actualizado) {
    // ALERTAS-02 (decisión 6A, casos A/C): la fecha reprogramada puede hacer que una alerta
    // VENCIDA o PROXIMA ya generada deje de corresponder a la realidad — se resuelve si ya no
    // aplica; si sigue aplicando (o no existía), no tiene ningún efecto.
    await alertasRepo.resolverAlertasEntregaObsoletas(id);
    return actualizado;
  }

  const actual = await ordenesRepo.findById(id);
  if (!actual) {
    throw new OrdenNoEncontradaError();
  }
  if (actual.entrega_confirmada_en) {
    throw new EntregaYaConfirmadaError();
  }
  throw new OrdenTerminalError();
}

// Bloque saldo/entrega/cierre. Única vía para alcanzar CERRADA (decisión
// explícita: el endpoint genérico de estado ya no permite esta
// transición, ver TRANSICIONES). Exige, en este orden: la orden debe
// estar FINALIZADA; la cotización asociada debe tener estado_saldo =
// VALIDADO; la orden debe tener entrega_confirmada_en asignado. Si no se
// cumple alguna condición, la orden permanece FINALIZADA — no existe
// ningún mecanismo de reintento automático.
export async function cerrarOrden(id: string, actorId?: string): Promise<Orden> {
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

  const actualizado = await ordenesRepo.updateEstado(id, 'CERRADA', ['FINALIZADA'], undefined, actorId);
  if (!actualizado) {
    // Condición de carrera: el estado cambió entre la verificación y el
    // UPDATE (ej. otra pestaña canceló la orden justo antes).
    throw new OrdenNoFinalizadaError();
  }
  // ALERTAS-02 (extensión razonada de la decisión 7A, no una decisión nueva): CERRADA se agrupa
  // exactamente igual que CANCELADA en la propia condición de exclusión de la generación
  // (`estado NOT IN ('CERRADA','CANCELADA')`, ver alertas.repository.ts) — una orden CERRADA exige
  // además que la entrega ya esté confirmada (precondición de cerrarOrden), por lo que tampoco
  // puede seguir necesitando atención por fecha de entrega. Documentado explícitamente para que
  // Darwin pueda revertirlo si no corresponde a la intención de 7A.
  await alertasRepo.resolverAlertasEntregaObsoletas(id);
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

// Bloque 3B: detecta la violación de un CHECK de PostgreSQL en particular (código 23514), por
// nombre de constraint — se usa para traducir una violación de `chk_ordenes_fechas` a un error de
// dominio claro, sin tocar ni relajar el CHECK existente.
function isCheckViolation(error: unknown, constraintName: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23514' &&
    'constraint' in error &&
    (error as { constraint?: string }).constraint === constraintName
  );
}
