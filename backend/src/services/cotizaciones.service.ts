import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import { crearOrdenAutomatica } from './ordenAutomatica.service.js';
import type { Cotizacion } from '../repositories/cotizaciones.repository.js';

export class SolicitudNoEncontradaError extends Error {}
export class SolicitudNoEnRevisionError extends Error {}
export class CotizacionNoEncontradaError extends Error {}
export class TransicionInvalidaError extends Error {}
export class EstadoInvalidoError extends Error {}
export class YaExisteAceptadaError extends Error {}
export class EnlaceInvalidoError extends Error {}
export class CotizacionNoDisponibleError extends Error {}
export class CodigoInvalidoError extends Error {}
export class DemasiadosIntentosError extends Error {}
export class IvaPorcentajeInvalidoError extends Error {}
export class AnticipoPorcentajeInvalidoError extends Error {}
export class MetodoAnticipoRequeridoError extends Error {}
export class MetodoAnticipoNoPermitidoError extends Error {}
export class MetodoAnticipoInvalidoError extends Error {}
export class DiasVigenciaInvalidoError extends Error {}
export class AccionNoPermitidaError extends Error {}
export class AnticipoNoGestionableError extends Error {}
export class SaldoNoGestionableError extends Error {}
export class MetodoSaldoRequeridoError extends Error {}
export class MetodoSaldoInvalidoError extends Error {}
export class ComprobanteSaldoRequeridoError extends Error {}
export class SaldoNoRechazadoError extends Error {}
export class CotizacionNoEditableError extends Error {}

const ESTADOS_VALIDOS = ['BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CANCELADA'];

// Transiciones justificadas para Fase 7 (documentadas en el CHECKPOINT de
// implementación, no asumidas): BORRADOR es el estado inicial de toda
// cotización recién creada; ENVIADA representa el envío formal al cliente;
// CANCELADA es alcanzable desde cualquier estado no terminal (cancelación
// administrativa). ACEPTADA/RECHAZADA/VENCIDA/CANCELADA son terminales: no
// hay respaldo en el esquema ni en una decisión aprobada para reabrir o
// renegociar una cotización ya resuelta.
//
// Fase D.4: ACEPTADA y RECHAZADA se retiran como destinos alcanzables
// desde este flujo interno. A partir de esta sub-fase, la única vía para
// que una cotización ENVIADA pase a ACEPTADA/RECHAZADA es el enlace
// público (token + código), implementado en D.5 — Comercial ya no puede
// aceptar/rechazar en nombre del cliente mediante PATCH /:id/estado.
// VENCIDA sigue alcanzable aquí (además de por el vencimiento perezoso de
// D.3): no había ninguna razón para retirarla, no se toca innecesariamente.
const TRANSICIONES: Record<string, string[]> = {
  BORRADOR: ['ENVIADA', 'CANCELADA'],
  ENVIADA: ['VENCIDA', 'CANCELADA'],
  ACEPTADA: [],
  RECHAZADA: [],
  VENCIDA: [],
  CANCELADA: [],
};

// Vencimiento perezoso (Fase D.3): se aplica antes de leer, tanto en el
// listado/detalle interno (ADMIN/COMERCIAL) como en cualquier punto de
// acceso público (más abajo). No hay scheduler: cada lectura "corrige" el
// estado real en ese instante, mismo patrón ya usado para alertas.
export async function listarCotizaciones(): Promise<Cotizacion[]> {
  await cotizacionesRepo.marcarVencidasSiCorresponde();
  return cotizacionesRepo.listAll();
}

export async function obtenerCotizacion(id: string): Promise<Cotizacion | null> {
  await cotizacionesRepo.marcarVencidasSiCorresponde();
  return cotizacionesRepo.findById(id);
}

// ---------------------------------------------------------------------
// Cálculo automático de IVA/anticipo/vigencia (Fase D.2). Únicos valores
// permitidos, decisión explícita — cualquier otro porcentaje se rechaza
// como entrada inválida, nunca se "redondea" al más cercano.
// ---------------------------------------------------------------------
const IVA_PORCENTAJE_DEFAULT = 15;
const IVA_PORCENTAJES_PERMITIDOS = [0, 15];
const ANTICIPO_PORCENTAJE_DEFAULT = 50;
const ANTICIPO_PORCENTAJES_PERMITIDOS = [0, 50, 75];
const DIAS_VIGENCIA_DEFAULT = 15;
const METODOS_ANTICIPO_PERMITIDOS = ['TRANSFERENCIA', 'EFECTIVO'];
const METODOS_SALDO_PERMITIDOS = ['TRANSFERENCIA', 'EFECTIVO'];

function round2(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

interface CondicionesComercialesInput {
  valor: number;
  ivaPorcentaje?: number;
  anticipoPorcentaje?: number;
  diasVigencia?: number;
  metodoAnticipo?: string | null;
}

interface CondicionesComercialesCalculadas {
  subtotal: number;
  ivaPorcentaje: number;
  ivaValor: number;
  total: number;
  anticipoPorcentaje: number;
  anticipoValor: number;
  saldoPendiente: number;
  metodoAnticipo: string | null;
  estadoAnticipo: string;
  diasVigencia: number;
}

// Cálculo + validación de las condiciones comerciales de una cotización
// (Fase D.2, extraído para Fase "EDICIÓN DE COTIZACIONES BORRADOR" —
// autorización explícita): compartido entre crearCotizacion() y
// editarCotizacionBorrador() para que ambas apliquen EXACTAMENTE las mismas
// reglas, sin duplicarlas. Nunca confía en un total/subtotal/anticipo_valor
// enviado por el cliente — todo se recalcula aquí a partir únicamente de
// valor + los 3 porcentajes/días de entrada.
function calcularCondicionesComerciales(input: CondicionesComercialesInput): CondicionesComercialesCalculadas {
  const ivaPorcentaje = input.ivaPorcentaje ?? IVA_PORCENTAJE_DEFAULT;
  if (!IVA_PORCENTAJES_PERMITIDOS.includes(ivaPorcentaje)) {
    throw new IvaPorcentajeInvalidoError();
  }

  const anticipoPorcentaje = input.anticipoPorcentaje ?? ANTICIPO_PORCENTAJE_DEFAULT;
  if (!ANTICIPO_PORCENTAJES_PERMITIDOS.includes(anticipoPorcentaje)) {
    throw new AnticipoPorcentajeInvalidoError();
  }

  const diasVigencia = input.diasVigencia ?? DIAS_VIGENCIA_DEFAULT;
  if (!Number.isInteger(diasVigencia) || diasVigencia <= 0) {
    throw new DiasVigenciaInvalidoError();
  }

  // Si no hay anticipo, no se solicita método de pago (regla explícita).
  // Si hay anticipo, el método es obligatorio y debe ser uno de los dos
  // permitidos.
  let metodoAnticipo: string | null = null;
  let estadoAnticipo: string;
  if (anticipoPorcentaje === 0) {
    if (input.metodoAnticipo !== undefined && input.metodoAnticipo !== null) {
      throw new MetodoAnticipoNoPermitidoError();
    }
    estadoAnticipo = 'NO_APLICA';
  } else {
    if (!input.metodoAnticipo) {
      throw new MetodoAnticipoRequeridoError();
    }
    if (!METODOS_ANTICIPO_PERMITIDOS.includes(input.metodoAnticipo)) {
      throw new MetodoAnticipoInvalidoError();
    }
    metodoAnticipo = input.metodoAnticipo;
    estadoAnticipo = 'PENDIENTE';
  }

  const subtotal = round2(input.valor);
  const ivaValor = round2(subtotal * (ivaPorcentaje / 100));
  const total = round2(subtotal + ivaValor);
  const anticipoValor = round2(total * (anticipoPorcentaje / 100));
  const saldoPendiente = round2(total - anticipoValor);

  return {
    subtotal,
    ivaPorcentaje,
    ivaValor,
    total,
    anticipoPorcentaje,
    anticipoValor,
    saldoPendiente,
    metodoAnticipo,
    estadoAnticipo,
    diasVigencia,
  };
}

export interface CrearCotizacionInput {
  solicitudId: string;
  valor: number;
  descripcion: string | null;
  creadoPor: string;
  ivaPorcentaje?: number;
  anticipoPorcentaje?: number;
  diasVigencia?: number;
  metodoAnticipo?: string | null;
}

// Fase 7 exige explícitamente que la solicitud exista y esté en estado
// EN_REVISION antes de permitir crear una cotización. No cambia
// solicitudes.estado (decisión aprobada 2 de la autorización de Fase 7).
// Fase D.2 agrega el cálculo automático de subtotal/IVA/total/anticipo/
// saldo/vigencia — todo se calcula aquí, nunca se confía en un valor
// derivado enviado por el cliente (solo se reciben los 3 parámetros de
// entrada: porcentajes y días).
export async function crearCotizacion(input: CrearCotizacionInput): Promise<Cotizacion> {
  const solicitud = await solicitudesRepo.findById(input.solicitudId);
  if (!solicitud) {
    throw new SolicitudNoEncontradaError();
  }
  if (solicitud.estado !== 'EN_REVISION') {
    throw new SolicitudNoEnRevisionError();
  }

  const condiciones = calcularCondicionesComerciales(input);

  return cotizacionesRepo.create(pool, {
    solicitudId: input.solicitudId,
    valor: input.valor,
    descripcion: input.descripcion,
    creadoPor: input.creadoPor,
    ...condiciones,
  });
}

export interface EditarCotizacionBorradorInput {
  valor: number;
  descripcion: string | null;
  ivaPorcentaje?: number;
  anticipoPorcentaje?: number;
  diasVigencia?: number;
  metodoAnticipo?: string | null;
}

// Edición de condiciones comerciales — EXCLUSIVA de BORRADOR (autorización
// explícita — "IMPLEMENTACIÓN AUTORIZADA — EDICIÓN DE COTIZACIONES
// BORRADOR"). No importa ni toca solicitudes.repository/service: a
// diferencia de cambiarAEnviadaConSolicitud(), esta función nunca tiene
// razón para afectar la solicitud asociada (que permanece EN_REVISION
// durante todo el ciclo de vida de un BORRADOR). Reutiliza exactamente las
// mismas reglas/cálculos que crearCotizacion() vía
// calcularCondicionesComerciales() — ninguna regla duplicada.
export async function editarCotizacionBorrador(
  id: string,
  input: EditarCotizacionBorradorInput
): Promise<Cotizacion> {
  const condiciones = calcularCondicionesComerciales(input);

  const actualizada = await cotizacionesRepo.updateCondiciones(id, {
    valor: input.valor,
    descripcion: input.descripcion,
    ...condiciones,
  });
  if (actualizada) {
    return actualizada;
  }

  // El UPDATE no afectó ninguna fila: no existe, o su estado actual ya no
  // es BORRADOR (misma técnica de mensaje que el resto del service).
  const actual = await cotizacionesRepo.findById(id);
  if (!actual) {
    throw new CotizacionNoEncontradaError();
  }
  throw new CotizacionNoEditableError();
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

  // ENVIADA formaliza la cotización y se envía al cliente (decisión
  // aprobada — "IMPLEMENTACIÓN AUTORIZADA — SOLICITUDES COMERCIAL"): en la
  // MISMA transacción, la solicitud asociada pasa de EN_REVISION a
  // COTIZADA. Ninguna otra transición (VENCIDA/CANCELADA) toca la
  // solicitud, así que sigue el camino simple de siempre.
  if (nuevoEstado === 'ENVIADA') {
    return cambiarAEnviadaConSolicitud(id, estadosOrigenValidos);
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

// Transacción dedicada: cotización -> ENVIADA + (condicionalmente)
// solicitud EN_REVISION -> COTIZADA. Ambos UPDATE son condicionales (mismo
// patrón ya usado en todo el proyecto): si la cotización ya cambió de
// estado entre la verificación y este punto (condición de carrera), el
// primer UPDATE no afecta filas y no se toca la solicitud. Si la solicitud
// ya no está en EN_REVISION (caso límite — p. ej. fue cancelada por otra
// vía mientras tanto), el segundo UPDATE simplemente no afecta filas: la
// cotización igual queda ENVIADA — la solicitud es una consecuencia de
// enviar la cotización, nunca una condición bloqueante para poder enviarla.
// Llamadas repetidas con la cotización ya ENVIADA no reingresan aquí (ya no
// figura como origen válido), por lo que el efecto es naturalmente
// idempotente sin lógica adicional.
async function cambiarAEnviadaConSolicitud(
  id: string,
  estadosOrigenValidos: string[]
): Promise<Cotizacion> {
  const client = await pool.connect();
  let actualizado: Cotizacion | null = null;
  try {
    await client.query('BEGIN');

    actualizado = await cotizacionesRepo.updateEstado(id, 'ENVIADA', estadosOrigenValidos, client);
    if (actualizado) {
      await solicitudesRepo.updateEstado(actualizado.solicitud_id, 'COTIZADA', ['EN_REVISION'], client);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (actualizado) {
    return actualizado;
  }

  // El UPDATE de la cotización no afectó ninguna fila: no existe, o su
  // estado actual no admite esta transición. Se resuelve fuera de la
  // transacción (ya se confirmó un COMMIT vacío, no queda nada que revertir).
  const actual = await cotizacionesRepo.findById(id);
  if (!actual) {
    throw new CotizacionNoEncontradaError();
  }
  throw new TransicionInvalidaError();
}

// ---------------------------------------------------------------------
// Enlace seguro de cotización (vista pública sin login de cliente).
// Token JWT stateless firmado con `COTIZACION_LINK_SECRET` (secreto
// independiente de JWT_SECRET, decisión explícita) — nunca se persiste en
// PostgreSQL. La seguridad real de la operación de aceptar/rechazar no
// depende únicamente del token: siempre se vuelve a consultar el estado
// real de la cotización en el momento de usarlo (ver Fase C).
// ---------------------------------------------------------------------

const ENLACE_PURPOSE = 'cotizacion_publica';
const ENLACE_EXPIRA_EN = '30d';

interface EnlacePayload {
  cotizacionId: string;
  purpose: typeof ENLACE_PURPOSE;
}

// ---------------------------------------------------------------------
// Código de acceso (Fase B — segundo factor, independiente del token).
// Rate limiting en memoria del propio proceso backend: política definida
// para el alcance actual del proyecto (un único proceso Node, sin
// balanceo de carga) — máximo 5 intentos fallidos por cotización, bloqueo
// de 15 minutos al superarlo. El contador se reinicia con un código
// correcto o al expirar el bloqueo. No sobrevive a un reinicio del
// backend: limitación conocida y aceptada para este alcance (decisión
// explícita de no usar columnas persistentes de intentos/bloqueo).
// ---------------------------------------------------------------------

const CODIGO_SALT_ROUNDS = 10;
const MAX_INTENTOS_FALLIDOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

interface EstadoIntentos {
  fallidos: number;
  bloqueadoHasta: number | null;
}

const intentosPorCotizacion = new Map<string, EstadoIntentos>();

function obtenerEstadoIntentos(cotizacionId: string): EstadoIntentos {
  const actual = intentosPorCotizacion.get(cotizacionId);
  if (actual?.bloqueadoHasta !== null && actual?.bloqueadoHasta !== undefined && actual.bloqueadoHasta <= Date.now()) {
    intentosPorCotizacion.delete(cotizacionId);
    return { fallidos: 0, bloqueadoHasta: null };
  }
  return actual ?? { fallidos: 0, bloqueadoHasta: null };
}

// Se verifica ANTES de comparar el código: un código correcto presentado
// durante el bloqueo debe seguir siendo rechazado (requisito explícito de
// Fase B), no solo los códigos incorrectos.
function verificarNoBloqueado(cotizacionId: string): void {
  const estado = obtenerEstadoIntentos(cotizacionId);
  if (estado.bloqueadoHasta !== null && estado.bloqueadoHasta > Date.now()) {
    throw new DemasiadosIntentosError();
  }
}

function registrarIntentoFallido(cotizacionId: string): void {
  const estado = obtenerEstadoIntentos(cotizacionId);
  const fallidos = estado.fallidos + 1;
  const bloqueadoHasta = fallidos >= MAX_INTENTOS_FALLIDOS ? Date.now() + BLOQUEO_MS : null;
  intentosPorCotizacion.set(cotizacionId, { fallidos, bloqueadoHasta });
}

function limpiarIntentos(cotizacionId: string): void {
  intentosPorCotizacion.delete(cotizacionId);
}

export interface EnlaceGenerado {
  token: string;
  codigo: string;
}

// Solo tiene sentido generar un enlace mientras la cotización está
// ENVIADA: es el único estado desde el cual el cliente podrá aceptar o
// rechazar (Fase C). Generar un enlace sobre un estado terminal no tendría
// ninguna acción posible del lado del cliente. Cada llamada genera un
// código NUEVO y sobrescribe el hash anterior — invalida en la práctica
// cualquier código previamente entregado, sin necesidad de una columna de
// versión (decisión explícita). También limpia el contador de intentos:
// un enlace nuevo empieza con el contador en cero.
export async function generarEnlaceCotizacion(id: string): Promise<EnlaceGenerado> {
  await cotizacionesRepo.marcarVencidasSiCorresponde();
  const cotizacion = await cotizacionesRepo.findById(id);
  if (!cotizacion) {
    throw new CotizacionNoEncontradaError();
  }
  if (cotizacion.estado !== 'ENVIADA') {
    throw new CotizacionNoDisponibleError();
  }

  const codigo = crypto.randomInt(100000, 1000000).toString();
  const hash = await bcrypt.hash(codigo, CODIGO_SALT_ROUNDS);
  await cotizacionesRepo.guardarCodigoAcceso(id, hash);
  limpiarIntentos(id);

  const payload: EnlacePayload = { cotizacionId: id, purpose: ENLACE_PURPOSE };
  const token = jwt.sign(payload, env.cotizacionLinkSecret, { expiresIn: ENLACE_EXPIRA_EN });

  return { token, codigo };
}

export interface CotizacionPublica {
  id: string;
  valor: string;
  estado: string;
  descripcion: string | null;
  creado_en: string;
  fecha_vigencia: string | null;
  aceptada_en: string | null;
  rechazada_en: string | null;
  anticipo_porcentaje: string | null;
  anticipo_valor: string | null;
  saldo_pendiente: string | null;
  metodo_anticipo: string | null;
  estado_anticipo: string | null;
  comprobante_recibido: boolean;
  metodo_saldo: string | null;
  estado_saldo: string;
  saldo_comprobante_recibido: boolean;
  datos_bancarios: DatosBancarios | null;
  solicitud: {
    servicio: string;
    descripcion: string;
    cantidad: number;
    especificaciones: string | null;
  };
}

interface DatosBancarios {
  banco: string;
  tipoCuenta: string;
  numeroCuenta: string;
  titular: string;
  ruc: string;
}

// Solo se entregan al cliente cuando las 5 variables de entorno están
// configuradas (Fase D.1: pendientes hasta que se proporcionen valores
// reales, nunca se inventan). Si falta alguna, se devuelve null y el
// frontend muestra un aviso genérico en su lugar.
function obtenerDatosBancariosSiConfigurados(): DatosBancarios | null {
  const { banco, tipoCuenta, numeroCuenta, titular, ruc } = env.datosBancarios;
  if (!banco || !tipoCuenta || !numeroCuenta || !titular || !ruc) {
    return null;
  }
  return { banco, tipoCuenta, numeroCuenta, titular, ruc };
}

// Verifica firma + propósito del token y devuelve el cotizacionId real.
// Compartido por obtenerCotizacionPublica() y verificarCodigoCotizacion().
function verificarToken(token: string): string {
  let payload: EnlacePayload;
  try {
    const decoded = jwt.verify(token, env.cotizacionLinkSecret);
    if (typeof decoded !== 'object' || decoded === null) {
      throw new Error('Payload inválido.');
    }
    payload = decoded as EnlacePayload;
  } catch {
    throw new EnlaceInvalidoError();
  }

  if (payload.purpose !== ENLACE_PURPOSE || typeof payload.cotizacionId !== 'string') {
    throw new EnlaceInvalidoError();
  }

  return payload.cotizacionId;
}

// Construye el DTO público a partir del estado REAL vigente en
// PostgreSQL en este instante — nunca de lo que decía el token al
// generarse. No expone campos internos (creado_por, actualizado_en,
// acceso_codigo_hash, etc.). Compartido por ambos endpoints públicos.
async function construirCotizacionPublica(cotizacionId: string): Promise<CotizacionPublica> {
  const cotizacion = await cotizacionesRepo.findById(cotizacionId);
  if (!cotizacion) {
    throw new CotizacionNoEncontradaError();
  }

  const solicitud = await solicitudesRepo.findById(cotizacion.solicitud_id);
  if (!solicitud) {
    throw new SolicitudNoEncontradaError();
  }

  return {
    id: cotizacion.id,
    valor: cotizacion.valor,
    estado: cotizacion.estado,
    descripcion: cotizacion.descripcion,
    creado_en: cotizacion.creado_en,
    fecha_vigencia: cotizacion.fecha_vigencia,
    aceptada_en: cotizacion.aceptada_en,
    rechazada_en: cotizacion.rechazada_en,
    anticipo_porcentaje: cotizacion.anticipo_porcentaje,
    anticipo_valor: cotizacion.anticipo_valor,
    saldo_pendiente: cotizacion.saldo_pendiente,
    metodo_anticipo: cotizacion.metodo_anticipo,
    estado_anticipo: cotizacion.estado_anticipo,
    comprobante_recibido: cotizacion.comprobante_recibido,
    metodo_saldo: cotizacion.metodo_saldo,
    estado_saldo: cotizacion.estado_saldo,
    saldo_comprobante_recibido: cotizacion.saldo_comprobante_recibido,
    datos_bancarios:
      cotizacion.metodo_anticipo === 'TRANSFERENCIA' || cotizacion.metodo_saldo === 'TRANSFERENCIA'
        ? obtenerDatosBancariosSiConfigurados()
        : null,
    solicitud: {
      servicio: solicitud.servicio,
      descripcion: solicitud.descripcion,
      cantidad: solicitud.cantidad,
      especificaciones: solicitud.especificaciones,
    },
  };
}

export interface EnlaceValidez {
  valido: true;
  requiereCodigo: true;
}

// Corrección del hallazgo de Fase B: este endpoint deja de devolver los
// datos de la cotización. Solo confirma que el token es válido y que
// corresponde a una cotización real — nunca entrega información sensible
// (valor, descripción, datos de la solicitud, etc.). A partir de esta
// corrección, `verificarCodigoCotizacion()` es el ÚNICO punto que entrega
// los datos completos, y exige además el código de 6 dígitos.
//
// Fase D.3: se aplica el vencimiento perezoso antes de decidir la validez
// del enlace. Una cotización que acaba de pasar a VENCIDA se trata igual
// que un enlace inválido/expirado — el cliente ya no debe poder acceder a
// ella por esta vía (sí queda conservada como historial para Comercial).
export async function validarEnlaceCotizacion(token: string): Promise<EnlaceValidez> {
  const cotizacionId = verificarToken(token);

  await cotizacionesRepo.marcarVencidasSiCorresponde();
  const cotizacion = await cotizacionesRepo.findById(cotizacionId);
  if (!cotizacion) {
    throw new CotizacionNoEncontradaError();
  }
  if (cotizacion.estado === 'VENCIDA') {
    throw new EnlaceInvalidoError();
  }

  return { valido: true, requiereCodigo: true };
}

// Fase B: exige token válido + código de 6 dígitos correcto (contra el
// hash almacenado). Sujeto a bloqueo temporal por intentos fallidos.
// Fase D.3: mismo bloqueo por vencimiento que validarEnlaceCotizacion,
// aplicado antes de evaluar el código.
// Fase D.5: extraída como helper compartido — el token, por sí solo,
// nunca es suficiente: `aceptarCotizacionPublica()` y
// `rechazarCotizacionPublica()` exigen exactamente la misma verificación
// de código que la vista pública, antes de poder ejecutar cualquier
// acción. Devuelve la fila real (post-vencimiento) para que cada acción
// decida sobre el estado vigente, sin volver a golpear la BD.
async function validarAccesoConCodigo(token: string, codigo: string): Promise<Cotizacion> {
  const cotizacionId = verificarToken(token);

  await cotizacionesRepo.marcarVencidasSiCorresponde();
  const cotizacionActual = await cotizacionesRepo.findById(cotizacionId);
  if (!cotizacionActual) {
    throw new CotizacionNoEncontradaError();
  }
  if (cotizacionActual.estado === 'VENCIDA') {
    throw new EnlaceInvalidoError();
  }

  verificarNoBloqueado(cotizacionId);

  const hashGuardado = await cotizacionesRepo.obtenerHashCodigoAcceso(cotizacionId);
  if (!hashGuardado) {
    // Nunca se generó un código para esta cotización (dato inconsistente
    // o enlace de una versión anterior) — mismo mensaje genérico que un
    // enlace inválido, sin distinguir la causa exacta al cliente.
    throw new EnlaceInvalidoError();
  }

  const coincide = await bcrypt.compare(codigo, hashGuardado);
  if (!coincide) {
    registrarIntentoFallido(cotizacionId);
    throw new CodigoInvalidoError();
  }

  limpiarIntentos(cotizacionId);
  return cotizacionActual;
}

export async function verificarCodigoCotizacion(token: string, codigo: string): Promise<CotizacionPublica> {
  const cotizacion = await validarAccesoConCodigo(token, codigo);
  return construirCotizacionPublica(cotizacion.id);
}

// Fase D.5: el cliente acepta desde el enlace público — token + código son
// AMBOS obligatorios (nunca alcanza con el JWT solo, `validarAccesoConCodigo`
// ya lo exige). Solo procede si, en este instante, la cotización sigue
// ENVIADA: el UPDATE condicional del repositorio es quien realmente decide
// esto de forma atómica (protege contra condiciones de carrera). La
// restricción de una sola ACEPTADA por solicitud la sigue garantizando
// `ux_cotizaciones_una_aceptada` — una violación se traduce en
// YaExisteAceptadaError, igual que en el flujo interno.
export async function aceptarCotizacionPublica(token: string, codigo: string): Promise<CotizacionPublica> {
  const cotizacion = await validarAccesoConCodigo(token, codigo);
  if (cotizacion.estado !== 'ENVIADA') {
    throw new AccionNoPermitidaError();
  }

  try {
    const actualizada = await cotizacionesRepo.marcarAceptada(cotizacion.id);
    if (!actualizada) {
      throw new AccionNoPermitidaError();
    }
    // Bloque 1.1: sin anticipo, la orden se crea al aceptar. Con anticipo
    // PENDIENTE se espera a que ADMIN/COMERCIAL lo valide (gestionarAnticipo).
    // crearOrdenAutomatica nunca lanza: la aceptación ya está confirmada.
    if (actualizada.estado_anticipo === 'NO_APLICA') {
      await crearOrdenAutomatica(actualizada.id, 'ACEPTACION');
    }
    return construirCotizacionPublica(actualizada.id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new YaExisteAceptadaError();
    }
    throw error;
  }
}

// Fase D.5: mismas exigencias que aceptar (token + código, estado ENVIADA
// vigente en el instante del UPDATE).
export async function rechazarCotizacionPublica(token: string, codigo: string): Promise<CotizacionPublica> {
  const cotizacion = await validarAccesoConCodigo(token, codigo);
  if (cotizacion.estado !== 'ENVIADA') {
    throw new AccionNoPermitidaError();
  }

  const actualizada = await cotizacionesRepo.marcarRechazada(cotizacion.id);
  if (!actualizada) {
    throw new AccionNoPermitidaError();
  }
  return construirCotizacionPublica(actualizada.id);
}

// ---------------------------------------------------------------------
// Comprobante de transferencia + gestión de anticipo (Fase D.6).
// ---------------------------------------------------------------------

// Público: el cliente sube el comprobante desde el enlace (token + código,
// igual que aceptar/rechazar). Solo procede si la cotización está
// ACEPTADA, el método es TRANSFERENCIA y el anticipo sigue PENDIENTE —
// nunca modifica estado_anticipo (eso es exclusivo de Comercial). El
// nombre de archivo llega ya generado por multer (uploadsComprobantes.ts),
// nunca es un valor libre del cliente.
export async function registrarComprobantePublico(
  token: string,
  codigo: string,
  nombreArchivo: string
): Promise<CotizacionPublica> {
  const cotizacion = await validarAccesoConCodigo(token, codigo);

  if (cotizacion.estado !== 'ACEPTADA') {
    throw new AccionNoPermitidaError();
  }
  if (cotizacion.metodo_anticipo !== 'TRANSFERENCIA') {
    throw new AccionNoPermitidaError();
  }
  if (cotizacion.estado_anticipo !== 'PENDIENTE') {
    throw new AccionNoPermitidaError();
  }

  const actualizada = await cotizacionesRepo.guardarComprobante(cotizacion.id, nombreArchivo);
  if (!actualizada) {
    throw new AccionNoPermitidaError();
  }
  return construirCotizacionPublica(actualizada.id);
}

// Interno (ADMIN/COMERCIAL, detrás de requireAuth+requireRole en la
// ruta): confirma o rechaza el anticipo de una cotización ACEPTADA cuyo
// anticipo sigue PENDIENTE. `confirmadoPor` siempre proviene de
// `req.user.sub` — nunca del cliente público, que no tiene acceso a esta
// ruta bajo ninguna circunstancia (ni con token+código, ni sin ellos).
export async function gestionarAnticipo(
  id: string,
  accion: 'VALIDAR' | 'RECHAZAR',
  confirmadoPor: string
): Promise<Cotizacion> {
  const nuevoEstadoAnticipo = accion === 'VALIDAR' ? 'VALIDADO' : 'RECHAZADO';

  const actualizada = await cotizacionesRepo.actualizarEstadoAnticipo(id, nuevoEstadoAnticipo, confirmadoPor);
  if (actualizada) {
    // Bloque 1.1: al validar el anticipo se crea la orden. RECHAZAR no crea
    // nada. crearOrdenAutomatica nunca lanza: la validación ya está guardada.
    if (accion === 'VALIDAR') {
      await crearOrdenAutomatica(actualizada.id, 'ANTICIPO_VALIDADO');
    }
    return actualizada;
  }

  const actual = await cotizacionesRepo.findById(id);
  if (!actual) {
    throw new CotizacionNoEncontradaError();
  }
  throw new AnticipoNoGestionableError();
}

// Interno: resuelve el nombre de archivo real para el endpoint de
// descarga. Nunca se expone a través de listarCotizaciones/
// obtenerCotizacion ni de ningún DTO público.
export async function obtenerNombreComprobante(id: string): Promise<string | null> {
  return cotizacionesRepo.obtenerNombreComprobante(id);
}

// ---------------------------------------------------------------------
// Saldo (bloque saldo/entrega/cierre). saldo_pendiente sigue siendo el
// monto fijo calculado en crearCotizacion() — nada aquí lo modifica.
// A diferencia del anticipo, el saldo NUNCA es NO_APLICA (decisión
// explícita: incluso con anticipo 0% queda saldo pendiente por cobrar).
// ---------------------------------------------------------------------

// Público: el cliente sube el comprobante de transferencia del SALDO
// desde el mismo enlace (token + código) ya usado para el anticipo. Fija
// metodo_saldo en TRANSFERENCIA implícitamente (ver guardarComprobanteSaldo)
// si todavía no estaba fijado; si ya estaba fijado en EFECTIVO, la
// condición del repositorio bloquea el UPDATE y esta función lo traduce a
// AccionNoPermitidaError.
export async function registrarComprobanteSaldoPublico(
  token: string,
  codigo: string,
  nombreArchivo: string
): Promise<CotizacionPublica> {
  const cotizacion = await validarAccesoConCodigo(token, codigo);

  if (cotizacion.estado !== 'ACEPTADA') {
    throw new AccionNoPermitidaError();
  }
  if (cotizacion.estado_saldo !== 'PENDIENTE') {
    throw new AccionNoPermitidaError();
  }
  if (cotizacion.metodo_saldo !== null && cotizacion.metodo_saldo !== 'TRANSFERENCIA') {
    throw new AccionNoPermitidaError();
  }

  const actualizada = await cotizacionesRepo.guardarComprobanteSaldo(cotizacion.id, nombreArchivo);
  if (!actualizada) {
    throw new AccionNoPermitidaError();
  }
  return construirCotizacionPublica(actualizada.id);
}

// Interno (ADMIN/COMERCIAL, ruta ya restringida a nivel de router):
// valida o rechaza el saldo de una cotización ACEPTADA con saldo
// PENDIENTE. `metodo` es obligatorio únicamente si la cotización todavía
// no tiene `metodo_saldo` fijado (caso EFECTIVO, que nunca pasa por la
// subida de comprobante); si ya está fijado (por una subida previa de
// comprobante, siempre TRANSFERENCIA), no puede contradecirse con un
// `metodo` distinto. TRANSFERENCIA exige que el comprobante ya exista;
// EFECTIVO nunca lo exige (decisión explícita del bloque).
export async function gestionarSaldo(
  id: string,
  accion: 'VALIDAR' | 'RECHAZAR',
  confirmadoPor: string,
  metodo?: string
): Promise<Cotizacion> {
  const cotizacion = await cotizacionesRepo.findById(id);
  if (!cotizacion) {
    throw new CotizacionNoEncontradaError();
  }

  if (accion === 'RECHAZAR') {
    const actualizada = await cotizacionesRepo.rechazarSaldo(id, confirmadoPor);
    if (!actualizada) {
      throw new SaldoNoGestionableError();
    }
    return actualizada;
  }

  const metodoEfectivo = cotizacion.metodo_saldo ?? metodo ?? null;
  if (!metodoEfectivo) {
    throw new MetodoSaldoRequeridoError();
  }
  if (!METODOS_SALDO_PERMITIDOS.includes(metodoEfectivo)) {
    throw new MetodoSaldoInvalidoError();
  }
  if (cotizacion.metodo_saldo && metodo && metodo !== cotizacion.metodo_saldo) {
    throw new MetodoSaldoInvalidoError();
  }
  if (metodoEfectivo === 'TRANSFERENCIA' && !cotizacion.saldo_comprobante_recibido) {
    throw new ComprobanteSaldoRequeridoError();
  }

  const actualizada = await cotizacionesRepo.validarSaldo(id, confirmadoPor, metodoEfectivo);
  if (!actualizada) {
    throw new SaldoNoGestionableError();
  }
  return actualizada;
}

// Interno: resuelve el nombre real del comprobante de saldo para el
// endpoint de descarga. Mismo tratamiento que obtenerNombreComprobante().
export async function obtenerNombreComprobanteSaldo(id: string): Promise<string | null> {
  return cotizacionesRepo.obtenerNombreComprobanteSaldo(id);
}

// H-E (auditoría post-V9): endpoint/acción explícita y separada — no se
// amplía gestionarSaldo() con una tercera "accion" para esto (decisión
// explícita: preferir una acción dedicada antes que un PATCH genérico
// sobrecargado). Solo procede si el saldo está realmente RECHAZADO en
// este instante (UPDATE condicional, ver reabrirSaldo() en el
// repositorio).
export async function reabrirSaldo(id: string): Promise<Cotizacion> {
  const actualizada = await cotizacionesRepo.reabrirSaldo(id);
  if (actualizada) {
    return actualizada;
  }

  const actual = await cotizacionesRepo.findById(id);
  if (!actual) {
    throw new CotizacionNoEncontradaError();
  }
  throw new SaldoNoRechazadoError();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
