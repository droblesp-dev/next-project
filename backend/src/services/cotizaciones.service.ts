import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import * as comprobantesClienteRepo from '../repositories/comprobantesPagoCliente.repository.js';
import * as transferenciasRepo from '../repositories/transferenciasPago.repository.js';
import { existeCuentaActiva, listarCuentasActivasPublico } from './cuentasBancarias.service.js';
import type { CuentaBancariaPublica } from '../repositories/cuentasBancarias.repository.js';
import { crearOrdenAutomatica } from './ordenAutomatica.service.js';
import { convertirLeadPorAceptacion } from './leads.service.js';
import { enviarCodigoTemporalCotizacion, enviarCodigoAccesoRegenerado } from './email.service.js';
import type { Cotizacion } from '../repositories/cotizaciones.repository.js';
import * as itemsRepo from '../repositories/cotizacionItems.repository.js';
import type { CotizacionItem, SugerenciaConcepto } from '../repositories/cotizacionItems.repository.js';
import { obtenerEsquemaCotizaciones } from '../repositories/cotizacionesEsquema.js';
import { LineasInvalidasError, normalizarLineas } from './cotizacionItems.js';
import { normalizarTermino, patronParcial, terminoValido } from './busquedaPatron.js';
import type { PoolClient } from 'pg';

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
// #4: el enlace es de una cotización VENCIDA. A diferencia de CANCELADA (mensaje genérico, sin revelar nada), al cliente
// se le informa que caducó para que consulte con su asesor. No revela ningún dato de la cotización.
export class CotizacionVencidaError extends Error {}
export class IvaPorcentajeInvalidoError extends Error {}
export class AnticipoPorcentajeInvalidoError extends Error {}
export class MetodoAnticipoRequeridoError extends Error {}
export class MetodoAnticipoNoPermitidoError extends Error {}
export class MetodoAnticipoInvalidoError extends Error {}
export class DiasVigenciaInvalidoError extends Error {}
export class AccionNoPermitidaError extends Error {}
// Subclases con mensaje propio para el cliente (el controlador las atiende antes que la genérica).
export class SaldoRequiereAnticipoValidadoError extends AccionNoPermitidaError {}
// Acreditar («Dinero acreditado») un anticipo por TRANSFERENCIA exige el comprobante del cliente y la revisión
// previa de COMERCIAL (una gestión vigente PENDIENTE). Se definen aquí, junto a las demás, porque
// cotizaciones.controller traduce a HTTP los errores de este módulo y de transferenciasPago.service.
export class AnticipoRequiereComprobanteError extends AccionNoPermitidaError {}
export class AnticipoRequiereRevisionError extends AccionNoPermitidaError {}
export class ComprobanteYaRecibidoError extends AccionNoPermitidaError {}
// QA-08: la cuenta que el cliente indicó al subir el comprobante no existe o no está activa.
export class CuentaIndicadaInvalidaError extends Error {}
export class AnticipoNoGestionableError extends Error {}
export class SaldoNoGestionableError extends Error {}
export class MetodoSaldoRequeridoError extends Error {}
export class MetodoSaldoInvalidoError extends Error {}
export class ComprobanteSaldoRequeridoError extends Error {}
export class SaldoNoRechazadoError extends Error {}
export class CotizacionNoEditableError extends Error {}
// Líneas de detalle (V28). Sin la tabla en la base no se pueden guardar líneas; no se mezclan `valor` manual y líneas; y un borrador que
// ya tiene líneas no admite un valor manual.
export class LineasNoDisponiblesError extends Error {}
export class LineasYValorError extends Error {}
export class LineasRequeridasError extends Error {}
export { LineasInvalidasError };

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
  // Camino anterior a V28 (y de pruebas/procesos internos): un único subtotal manual. Excluyente con `lineas`.
  valor?: number;
  // Líneas de detalle ({descripcion, cantidad, precio_unitario}[]): el subtotal y los importes derivados se calculan en el backend.
  lineas?: unknown;
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
//
// Requerimiento 4 (V28): con `lineas`, el subtotal es la suma de los subtotales de línea (aritmética exacta, ver
// cotizacionItems.ts) y la cotización y sus líneas se guardan en UNA transacción. Las reglas de IVA, anticipo, saldo y
// vigencia son exactamente las mismas de siempre.
export async function crearCotizacion(input: CrearCotizacionInput): Promise<Cotizacion> {
  const solicitud = await solicitudesRepo.findById(input.solicitudId);
  if (!solicitud) {
    throw new SolicitudNoEncontradaError();
  }
  if (solicitud.estado !== 'EN_REVISION') {
    throw new SolicitudNoEnRevisionError();
  }

  if (input.lineas === undefined) {
    if (input.valor === undefined) {
      throw new LineasInvalidasError(['La cotización necesita al menos una línea de detalle.']);
    }
    const condiciones = calcularCondicionesComerciales({ ...input, valor: input.valor });
    return cotizacionesRepo.create(pool, {
      solicitudId: input.solicitudId,
      valor: input.valor,
      descripcion: input.descripcion,
      creadoPor: input.creadoPor,
      ...condiciones,
    });
  }

  if (input.valor !== undefined) {
    throw new LineasYValorError();
  }
  if (!(await obtenerEsquemaCotizaciones()).items) {
    throw new LineasNoDisponiblesError();
  }
  const { lineas, subtotal } = normalizarLineas(input.lineas);
  const condiciones = calcularCondicionesComerciales({ ...input, valor: subtotal });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const creada = await cotizacionesRepo.create(client, {
      solicitudId: input.solicitudId,
      valor: subtotal,
      descripcion: input.descripcion,
      creadoPor: input.creadoPor,
      ...condiciones,
    });
    await itemsRepo.reemplazar(client, creada.id, lineas);
    await client.query('COMMIT');
    return creada;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface EditarCotizacionBorradorInput {
  valor?: number;
  lineas?: unknown;
  descripcion: string | null;
  ivaPorcentaje?: number;
  anticipoPorcentaje?: number;
  diasVigencia?: number;
  metodoAnticipo?: string | null;
}

// Bloquea la fila de la cotización (FOR UPDATE) y comprueba que sigue en BORRADOR DENTRO de la misma transacción que escribe las
// líneas y actualiza los importes. Enviar la cotización (ENVIADA) toma el mismo bloqueo con su UPDATE condicional, de modo que
// editar y enviar se serializan: si el envío gana, la edición se rechaza; si la edición gana, el envío espera y ve el borrador
// ya actualizado. Nunca se pierde ni se mezcla una edición con un envío.
async function conBorradorBloqueado<T>(id: string, accion: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fila = await client.query<{ estado: string }>('SELECT estado FROM cotizaciones WHERE id = $1 FOR UPDATE', [id]);
    if (!fila.rows[0]) {
      throw new CotizacionNoEncontradaError();
    }
    if (fila.rows[0].estado !== 'BORRADOR') {
      throw new CotizacionNoEditableError();
    }
    const resultado = await accion(client);
    await client.query('COMMIT');
    return resultado;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Edición de condiciones comerciales — EXCLUSIVA de BORRADOR (autorización
// explícita — "IMPLEMENTACIÓN AUTORIZADA — EDICIÓN DE COTIZACIONES
// BORRADOR"). No importa ni toca solicitudes.repository/service: a
// diferencia de cambiarAEnviadaConSolicitud(), esta función nunca tiene
// razón para afectar la solicitud asociada (que permanece EN_REVISION
// durante todo el ciclo de vida de un BORRADOR). Reutiliza exactamente las
// mismas reglas/cálculos que crearCotizacion() vía
// calcularCondicionesComerciales() — ninguna regla duplicada.
//
// Requerimiento 4 (V28): con `lineas` se reemplaza el conjunto de líneas y se recalculan los importes (la vigencia se reinicia,
// como siempre). Un borrador anterior a V28 (sin líneas) se convierte en un borrador con líneas SOLO cuando el usuario confirma
// la edición con líneas; hasta entonces no se guarda nada.
export async function editarCotizacionBorrador(
  id: string,
  input: EditarCotizacionBorradorInput
): Promise<Cotizacion> {
  if (input.lineas !== undefined) {
    if (input.valor !== undefined) {
      throw new LineasYValorError();
    }
    if (!(await obtenerEsquemaCotizaciones()).items) {
      throw new LineasNoDisponiblesError();
    }
    const { lineas, subtotal } = normalizarLineas(input.lineas);
    const condiciones = calcularCondicionesComerciales({ ...input, valor: subtotal });
    return conBorradorBloqueado(id, async (client) => {
      const actualizada = await cotizacionesRepo.updateCondiciones(
        id,
        { valor: subtotal, descripcion: input.descripcion, ...condiciones },
        client
      );
      if (!actualizada) {
        throw new CotizacionNoEditableError();
      }
      await itemsRepo.reemplazar(client, id, lineas);
      return actualizada;
    });
  }

  if (input.valor === undefined) {
    throw new LineasInvalidasError(['La cotización necesita al menos una línea de detalle.']);
  }
  const valorManual = input.valor;
  const condiciones = calcularCondicionesComerciales({ ...input, valor: valorManual });

  // Con la tabla de líneas creada, un borrador que YA tiene líneas no admite un valor manual (descuadraría líneas e importes).
  if ((await obtenerEsquemaCotizaciones()).items) {
    return conBorradorBloqueado(id, async (client) => {
      if ((await itemsRepo.listarPorCotizacion(id, client)).length > 0) {
        throw new LineasRequeridasError();
      }
      const actualizada = await cotizacionesRepo.updateCondiciones(
        id,
        { valor: valorManual, descripcion: input.descripcion, ...condiciones },
        client
      );
      if (!actualizada) {
        throw new CotizacionNoEditableError();
      }
      return actualizada;
    });
  }

  const actualizada = await cotizacionesRepo.updateCondiciones(id, {
    valor: valorManual,
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

// Líneas de detalle de una cotización; vacío para las cotizaciones sin líneas (históricas) o mientras V28 no esté aplicada.
export async function obtenerLineasDeCotizacion(id: string): Promise<CotizacionItem[]> {
  if (!(await obtenerEsquemaCotizaciones()).items) {
    return [];
  }
  return itemsRepo.listarPorCotizacion(id);
}

// Buscador de conceptos reutilizables (sin catálogo): descripciones ya usadas en cotizaciones ENVIADA, ACEPTADA, RECHAZADA o VENCIDA,
// compartidas entre ADMIN y COMERCIAL. Es solo una sugerencia: el precio devuelto se puede editar. `disponible` indica si la
// base ya tiene las líneas de detalle (el frontend usa el formulario anterior mientras no).
export async function sugerirConceptosUsados(q: unknown): Promise<{ disponible: boolean; sugerencias: SugerenciaConcepto[] }> {
  if (!(await obtenerEsquemaCotizaciones()).items) {
    return { disponible: false, sugerencias: [] };
  }
  const termino = terminoValido(q);
  if (termino === null || normalizarTermino(termino).length < 2) {
    return { disponible: true, sugerencias: [] };
  }
  return { disponible: true, sugerencias: await itemsRepo.sugerirConceptos(patronParcial(termino), 10) };
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
// Bloqueo por intentos fallidos del código de acceso (QA-06, V23): máximo 5 fallos consecutivos por
// cotización y bloqueo de 15 minutos al superarlo. Es PERSISTENTE (columnas de `cotizaciones`): sobrevive a
// reinicios y se comparte entre instancias. El contador se reinicia con un código correcto, al generar un
// código nuevo, al terminar la recuperación por correo o cuando el bloqueo vence. Mientras dura el bloqueo
// no se suman más fallos, así que no se extiende. Quien esté bloqueado puede recuperar su código por
// correo (flujo independiente) sin esperar los 15 minutos.
// ---------------------------------------------------------------------

const CODIGO_SALT_ROUNDS = 10;
const MAX_INTENTOS_FALLIDOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;

// Se verifica ANTES de comparar el código: un código correcto presentado
// durante el bloqueo debe seguir siendo rechazado (requisito explícito de
// Fase B), no solo los códigos incorrectos.
async function verificarNoBloqueado(cotizacionId: string): Promise<void> {
  if (await cotizacionesRepo.accesoEstaBloqueado(cotizacionId)) {
    throw new DemasiadosIntentosError();
  }
}

async function registrarIntentoFallido(cotizacionId: string): Promise<void> {
  await cotizacionesRepo.registrarFalloAcceso(cotizacionId, MAX_INTENTOS_FALLIDOS, BLOQUEO_MS);
}

async function limpiarIntentos(cotizacionId: string): Promise<void> {
  await cotizacionesRepo.limpiarFallosAcceso(cotizacionId);
}

export interface EnlaceGenerado {
  token: string;
  codigo: string;
  // Fase 1 (autorización explícita — "Implementación Fase 1: envío
  // automático de cotizaciones por correo"): datos mínimos para que el
  // controller decida si puede enviar el correo con el enlace — nunca el
  // código de 6 dígitos, que esta fase excluye deliberadamente de
  // cualquier correo. `null` si no se pudo resolver un correo real del
  // cliente (relación inexistente o email vacío) — nunca se inventa ni se
  // asume un valor.
  destinatario: { nombre: string; email: string; solicitudCodigo: string | null; cotizacionCodigo: string | null } | null;
}

// Generar un enlace tiene sentido en ENVIADA (único estado desde el cual
// el cliente podrá aceptar o rechazar, Fase C) y, desde la autorización
// explícita "Regeneración manual del código para cotizaciones ACEPTADAS",
// también en ACEPTADA — no hay ninguna regla documentada que lo prohíba
// (el comentario original solo reflejaba el alcance de la Fase C, nunca
// una restricción deliberada); Q1/la Fase de recuperación ya establecieron
// que una cotización ACEPTADA sigue teniendo acciones reales del cliente
// (subir comprobante de anticipo/saldo), así que sí tiene sentido poder
// regenerar su código ahí también. RECHAZADA/VENCIDA/CANCELADA/BORRADOR
// siguen bloqueadas exactamente igual que antes — ninguna de esas sí es
// terminal sin ninguna acción pendiente. Cada llamada genera un código
// NUEVO y sobrescribe el hash anterior — invalida en la práctica
// cualquier código previamente entregado, sin necesidad de una columna de
// versión (decisión explícita). También limpia el contador de intentos:
// un enlace nuevo empieza con el contador en cero. Nunca toca `estado`,
// `valor`, anticipo/saldo, comprobantes ni crea ninguna orden — solo
// `acceso_codigo_hash` y el JWT (mismo código ya existente, sin tocar esa
// parte).
export async function generarEnlaceCotizacion(id: string): Promise<EnlaceGenerado> {
  await cotizacionesRepo.marcarVencidasSiCorresponde();
  const cotizacion = await cotizacionesRepo.findById(id);
  if (!cotizacion) {
    throw new CotizacionNoEncontradaError();
  }
  if (cotizacion.estado !== 'ENVIADA' && cotizacion.estado !== 'ACEPTADA') {
    throw new CotizacionNoDisponibleError();
  }

  const codigo = crypto.randomInt(100000, 1000000).toString();
  const hash = await bcrypt.hash(codigo, CODIGO_SALT_ROUNDS);
  await cotizacionesRepo.guardarCodigoAcceso(id, hash);
  await limpiarIntentos(id);

  const payload: EnlacePayload = { cotizacionId: id, purpose: ENLACE_PURPOSE };
  const token = jwt.sign(payload, env.cotizacionLinkSecret, { algorithm: 'HS256', expiresIn: ENLACE_EXPIRA_EN });

  // Fase 1 (autorización explícita): resuelve el correo real del cliente
  // mediante la relación cotizaciones.solicitud_id -> solicitudes.cliente_id
  // -> clientes.email (único JOIN de solo lectura, sin inventar ninguna
  // relación nueva). Si no hay fila (no debería ocurrir bajo las FK
  // existentes, pero no se asume) o el email queda vacío tras recortar
  // espacios, `destinatario` es `null` — el llamador decide no enviar
  // nada, nunca se envía a una dirección vacía.
  const contacto = await cotizacionesRepo.obtenerContactoParaCorreo(id);
  const emailContacto = contacto?.clienteEmail.trim();
  const destinatario =
    contacto && emailContacto
      ? {
          nombre: contacto.clienteNombre,
          email: emailContacto,
          solicitudCodigo: contacto.solicitudCodigo,
          cotizacionCodigo: contacto.cotizacionCodigo,
        }
      : null;

  return { token, codigo, destinatario };
}

export interface CotizacionPublica {
  id: string;
  // Código comercial legible (COT-XXXXXX); null en cotizaciones históricas.
  codigo: string | null;
  valor: string;
  // Desglose oficial calculado por el backend (crearCotizacion): `valor` es el subtotal sin IVA.
  subtotal: string | null;
  iva_porcentaje: string | null;
  iva_valor: string | null;
  total: string | null;
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
  // true cuando el saldo admite comprobante: el anticipo ya está VALIDADO o no aplica (regla QA-04).
  saldo_habilitado: boolean;
  // Motivo del último rechazo mientras el pago siga RECHAZADO; null en cualquier otro caso.
  rechazo_anticipo: RechazoPagoPublico | null;
  rechazo_saldo: RechazoPagoPublico | null;
  datos_bancarios: DatosBancarios | null;
  // PC-2026-01, Etapa 4: lista aditiva — convive con `datos_bancarios`
  // (variables BANCO_*, todavía no retiradas) sin romper el contrato
  // existente; el frontend público no la consume todavía (eso pertenece a
  // una etapa de frontend independiente, fuera del alcance de esta tarea).
  // Solo cuentas activas, solo campos públicos (ver cuentasBancarias.repository.ts).
  cuentas_bancarias_activas: CuentaBancariaPublica[];
  // Líneas de detalle (V28) que ve el cliente: descripción, cantidad, precio unitario y subtotal. Vacío en cotizaciones sin líneas.
  items: Array<{ descripcion: string; cantidad: string; precio_unitario: string; subtotal: string }>;
  solicitud: {
    // Número de la solicitud (SOL-…) para que el cliente pueda referenciarla; NULL en solicitudes anteriores a V10.
    codigo: string | null;
    servicio: string;
    descripcion: string;
    cantidad: number;
    especificaciones: string | null;
  };
}

export interface RechazoPagoPublico {
  motivo: string | null;
  detalle: string | null;
  fecha: string;
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

// Decisión del negocio: VENCIDA responde que la cotización caducó (sin datos) y CANCELADA el mensaje genérico
// («Enlace inválido o expirado»), también sin datos. RECHAZADA sí se muestra, con su mensaje, sin acciones.
function exigirVisibleAlCliente(estado: string): void {
  if (estado === 'VENCIDA') throw new CotizacionVencidaError();
  if (estado === 'CANCELADA') throw new EnlaceInvalidoError();
}

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Verifica firma + propósito del token y devuelve el cotizacionId real.
// Compartido por obtenerCotizacionPublica() y verificarCodigoCotizacion().
function verificarToken(token: string): string {
  let payload: EnlacePayload;
  try {
    const decoded = jwt.verify(token, env.cotizacionLinkSecret, { algorithms: ['HS256'] });
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
  // Un identificador sin formato UUID no puede corresponder a ninguna cotización: se trata como
  // enlace inválido (401) en vez de dejar que PostgreSQL falle con "invalid input syntax for type uuid" (500).
  if (!FORMATO_UUID.test(payload.cotizacionId)) {
    throw new EnlaceInvalidoError();
  }

  return payload.cotizacionId;
}

// Regla QA-04 (confirmada por el negocio): el cliente solo puede subir el comprobante del saldo
// cuando el anticipo ya fue VALIDADO (acreditación confirmada por ADMIN, directa o registrada por
// COMERCIAL tras la confirmación telefónica de un ADMIN) o cuando no hay anticipo. Es la única
// definición de «anticipo validado» que existe en el modelo de estados; si el negocio decide otro
// evento, se cambia aquí y en `guardarComprobanteSaldo` (repositorio).
export function anticipoPermiteSaldo(estadoAnticipo: string | null): boolean {
  return estadoAnticipo === 'VALIDADO' || estadoAnticipo === 'NO_APLICA';
}

// Motivo del rechazo vigente de un pago (fila vigente RECHAZADO de transferencias_pago).
async function obtenerRechazoVigente(
  cotizacionId: string,
  tipoPago: 'ANTICIPO' | 'SALDO'
): Promise<RechazoPagoPublico | null> {
  const vigente = await transferenciasRepo.obtenerVigente(cotizacionId, tipoPago);
  if (!vigente || vigente.estado !== 'RECHAZADO') return null;
  return { motivo: vigente.motivo_rechazo, detalle: vigente.motivo_rechazo_detalle, fecha: vigente.creado_en };
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

  const [rechazoAnticipo, rechazoSaldo] = await Promise.all([
    cotizacion.estado_anticipo === 'RECHAZADO' ? obtenerRechazoVigente(cotizacion.id, 'ANTICIPO') : null,
    cotizacion.estado_saldo === 'RECHAZADO' ? obtenerRechazoVigente(cotizacion.id, 'SALDO') : null,
  ]);

  // Las cuentas se entregan siempre que el cliente pueda necesitarlas: método TRANSFERENCIA ya fijado
  // o cotización ACEPTADA (el saldo puede pagarse por transferencia aunque su método no esté definido).
  const puedeTransferir =
    cotizacion.metodo_anticipo === 'TRANSFERENCIA' ||
    cotizacion.metodo_saldo === 'TRANSFERENCIA' ||
    cotizacion.estado === 'ACEPTADA';

  return {
    id: cotizacion.id,
    codigo: cotizacion.codigo,
    valor: cotizacion.valor,
    subtotal: cotizacion.subtotal,
    iva_porcentaje: cotizacion.iva_porcentaje,
    iva_valor: cotizacion.iva_valor,
    total: cotizacion.total,
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
    saldo_habilitado: anticipoPermiteSaldo(cotizacion.estado_anticipo),
    rechazo_anticipo: rechazoAnticipo,
    rechazo_saldo: rechazoSaldo,
    datos_bancarios: puedeTransferir ? obtenerDatosBancariosSiConfigurados() : null,
    cuentas_bancarias_activas: puedeTransferir ? await listarCuentasActivasPublico() : [],
    items: (await obtenerLineasDeCotizacion(cotizacion.id)).map((i) => ({
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      subtotal: i.subtotal,
    })),
    solicitud: {
      codigo: solicitud.codigo,
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
  exigirVisibleAlCliente(cotizacion.estado);

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
  exigirVisibleAlCliente(cotizacionActual.estado);

  await verificarNoBloqueado(cotizacionId);

  const hashGuardado = await cotizacionesRepo.obtenerHashCodigoAcceso(cotizacionId);
  if (!hashGuardado) {
    // Nunca se generó un código para esta cotización (dato inconsistente
    // o enlace de una versión anterior) — mismo mensaje genérico que un
    // enlace inválido, sin distinguir la causa exacta al cliente.
    throw new EnlaceInvalidoError();
  }

  const coincide = await bcrypt.compare(codigo, hashGuardado);
  if (!coincide) {
    await registrarIntentoFallido(cotizacionId);
    throw new CodigoInvalidoError();
  }

  await limpiarIntentos(cotizacionId);
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
//
// C2.2 (autorización explícita — alternativa B de la auditoría C2.1):
// registrar la aceptación y convertir el lead vinculado ocurren dentro de
// la MISMA transacción PostgreSQL — se confirman juntas (COMMIT) o se
// revierten juntas (ROLLBACK). Mismo patrón ya usado en el proyecto para
// transacciones explícitas (solicitudes.service.ts::crearSolicitud,
// cotizaciones.service.ts::cambiarAEnviadaConSolicitud): `pool.connect()`
// dedicado, BEGIN/COMMIT/ROLLBACK explícitos, `client.release()` siempre en
// `finally`.
//
// La validación de acceso (token + código + estado ENVIADA vigente) ocurre
// ANTES de abrir la transacción — "enviar una cotización, abrir un enlace o
// completar una solicitud no equivale a aceptarla": solo a partir de aquí
// hay una aceptación que de verdad se intentará registrar.
//
// La creación de la orden automática (y, dentro de ella, la ficha técnica
// vía Gemini) se mantiene DELIBERADAMENTE fuera de esta transacción y se
// invoca solo después del COMMIT — ver auditoría C2.1: incluirla exigiría
// propagar este mismo `client` a través de crearOrden()/
// resolverOperativoPorDefecto() (usado también por la creación manual de
// órdenes, que no debe quedar forzada a ninguna transacción externa) y,
// además, generarFicha() se dispara sin esperar y lee la orden por su
// cuenta (otra conexión) — si la orden todavía no estuviera confirmada por
// un COMMIT, esa lectura no la encontraría. crearOrdenAutomatica() sigue
// sin lanzar nunca (sin cambios): la aceptación ya quedó confirmada por el
// COMMIT anterior y no debe revertirse por este efecto secundario.
export async function aceptarCotizacionPublica(token: string, codigo: string): Promise<CotizacionPublica> {
  const cotizacion = await validarAccesoConCodigo(token, codigo);
  if (cotizacion.estado !== 'ENVIADA') {
    throw new AccionNoPermitidaError();
  }

  const client = await pool.connect();
  let actualizada: Cotizacion | null = null;
  try {
    await client.query('BEGIN');

    actualizada = await cotizacionesRepo.marcarAceptada(cotizacion.id, client);
    if (actualizada) {
      await convertirLeadPorAceptacion(actualizada.solicitud_id, client);
    }

    await client.query('COMMIT');
  } catch (error) {
    // C2.4 (autorización explícita, hallazgo de la revisión C2.3): el
    // ROLLBACK se protege con su propio try/catch — si la conexión ya está
    // rota (p. ej. por el mismo motivo que causó `error`), un ROLLBACK que
    // también falla ya NO sobrescribe ni oculta el error original. Solo se
    // registra el fallo secundario del ROLLBACK (mensaje de la excepción,
    // nunca parámetros de consulta ni datos de la cotización/el cliente) —
    // el error que de verdad se propaga sigue siendo `error`, con la misma
    // traducción de isUniqueViolation() que ya existía.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(
        '[cotizaciones] ROLLBACK falló al revertir aceptarCotizacionPublica (se conserva el error original):',
        rollbackError instanceof Error ? rollbackError.message : 'error desconocido'
      );
    }
    if (isUniqueViolation(error)) {
      throw new YaExisteAceptadaError();
    }
    throw error;
  } finally {
    client.release();
  }

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

// Escritura del archivo en disco, entregada por el controlador. Se ejecuta DENTRO de la transacción,
// después de validar token + código + estado y antes del COMMIT: si la escritura falla se revierte
// todo (la BD nunca referencia un archivo que no existe) y si el COMMIT falla se deshace el archivo.
export interface EscrituraArchivo {
  escribir: () => Promise<void>;
  deshacer: () => Promise<void>;
}

// Núcleo compartido por anticipo y saldo. La fila de la cotización se bloquea (FOR UPDATE) igual que
// en transferenciasPago.service.ts, de modo que una carga concurrente con un rechazo/validación
// interna o con otra carga se serializa. Cada carga queda registrada en comprobantes_pago_cliente:
// nunca se pierde un comprobante anterior.
async function registrarComprobanteCliente(
  tipoPago: 'ANTICIPO' | 'SALDO',
  token: string,
  codigo: string,
  nombreArchivo: string,
  archivo: EscrituraArchivo,
  cuentaBancariaId: string | null = null
): Promise<CotizacionPublica> {
  const cotizacion = await validarAccesoConCodigo(token, codigo);

  const client = await pool.connect();
  let escrito = false;
  try {
    await client.query('BEGIN');

    const actual = await cotizacionesRepo.lockParaTransferencia(cotizacion.id, client);
    if (!actual || actual.estado !== 'ACEPTADA') {
      throw new AccionNoPermitidaError();
    }

    if (tipoPago === 'ANTICIPO') {
      if (actual.metodo_anticipo !== 'TRANSFERENCIA') throw new AccionNoPermitidaError();
      if (actual.estado_anticipo === 'PENDIENTE' && actual.comprobante_anticipo) throw new ComprobanteYaRecibidoError();
      if (actual.estado_anticipo !== 'PENDIENTE' && actual.estado_anticipo !== 'RECHAZADO') throw new AccionNoPermitidaError();
    } else {
      if (actual.metodo_saldo !== null && actual.metodo_saldo !== 'TRANSFERENCIA') throw new AccionNoPermitidaError();
      if (!anticipoPermiteSaldo(actual.estado_anticipo)) throw new SaldoRequiereAnticipoValidadoError();
      if (actual.estado_saldo === 'PENDIENTE' && actual.comprobante_saldo) throw new ComprobanteYaRecibidoError();
      if (actual.estado_saldo !== 'PENDIENTE' && actual.estado_saldo !== 'RECHAZADO') throw new AccionNoPermitidaError();
    }

    const actualizada =
      tipoPago === 'ANTICIPO'
        ? await cotizacionesRepo.guardarComprobante(cotizacion.id, nombreArchivo, client)
        : await cotizacionesRepo.guardarComprobanteSaldo(cotizacion.id, nombreArchivo, client);
    if (!actualizada) {
      throw new AccionNoPermitidaError();
    }

    // QA-08: la cuenta indicada por el cliente es solo informativa, pero debe ser una cuenta activa real.
    if (cuentaBancariaId !== null && !(await existeCuentaActiva(cuentaBancariaId, client))) {
      throw new CuentaIndicadaInvalidaError();
    }

    await comprobantesClienteRepo.registrar(
      { id: crypto.randomUUID(), cotizacionId: cotizacion.id, tipoPago, archivo: nombreArchivo, cuentaBancariaId },
      client
    );

    await archivo.escribir();
    escrito = true;
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (escrito) {
      await archivo.deshacer().catch(() => undefined);
    }
    throw error;
  } finally {
    client.release();
  }

  return construirCotizacionPublica(cotizacion.id);
}

// Público: el cliente sube el comprobante del ANTICIPO desde el enlace (token + código, igual que
// aceptar/rechazar). Solo procede si la cotización está ACEPTADA, el método es TRANSFERENCIA y el
// anticipo está PENDIENTE sin comprobante o RECHAZADO (nueva carga tras corregir). Nunca resuelve el
// anticipo: validarlo o rechazarlo es exclusivo del equipo interno.
export async function registrarComprobantePublico(
  token: string,
  codigo: string,
  nombreArchivo: string,
  archivo: EscrituraArchivo,
  cuentaBancariaId: string | null = null
): Promise<CotizacionPublica> {
  return registrarComprobanteCliente('ANTICIPO', token, codigo, nombreArchivo, archivo, cuentaBancariaId);
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

// Público: el cliente sube el comprobante de transferencia del SALDO desde el mismo enlace. Regla
// QA-04: solo con el anticipo ya validado (o sin anticipo) — el backend la aplica aquí y de forma
// atómica en el UPDATE del repositorio; ocultar el botón en la interfaz no es la protección.
// Fija metodo_saldo en TRANSFERENCIA si todavía no estaba fijado (ver guardarComprobanteSaldo).
export async function registrarComprobanteSaldoPublico(
  token: string,
  codigo: string,
  nombreArchivo: string,
  archivo: EscrituraArchivo,
  cuentaBancariaId: string | null = null
): Promise<CotizacionPublica> {
  return registrarComprobanteCliente('SALDO', token, codigo, nombreArchivo, archivo, cuentaBancariaId);
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
  // Saldo RECHAZADO pero con el anticipo sin resolver (dato inconsistente): el UPDATE no aplica por
  // la regla del anticipo, no porque el saldo no esté RECHAZADO; se informa con el error correcto.
  if (actual.estado_saldo === 'RECHAZADO' && !anticipoPermiteSaldo(actual.estado_anticipo)) {
    throw new SaldoRequiereAnticipoValidadoError();
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

// =======================================================================
// Recuperación del código de acceso — "Implementación Fase 1: Recuperación
// segura del código de cotización" (autorización explícita). Exclusiva del
// escenario "el cliente conserva el enlace público, pero perdió el código
// de acceso de 6 dígitos" — NUNCA cambia ni emite un token nuevo, NUNCA
// toca el escenario de "perdió ambos" (Escenario B de la Fase 3A, fuera de
// alcance aquí).
//
// Contadores/bloqueo en memoria del propio proceso, completamente
// INDEPENDIENTES del bloqueo persistente del código de acceso REAL (QA-06,
// V23, arriba en este mismo archivo) — nunca se comparten ni se debilitan
// entre sí.
//
// LIMITACIÓN DOCUMENTADA: el estado de la RECUPERACIÓN (a diferencia del
// bloqueo del código de acceso, que ya es persistente) vive solo en memoria del proceso backend — un reinicio lo pierde por
// completo (todos los contadores, bloqueos y códigos temporales
// pendientes). No se presenta como persistente entre reinicios. No existe
// hoy ningún mecanismo automático para levantar un bloqueo una vez
// activado — queda, deliberadamente, fuera del alcance de esta fase
// construir ese mecanismo de desbloqueo comercial (ver informe de cierre).
// =======================================================================

const OTP_VIGENCIA_MS = 10 * 60 * 1000;
const OTP_MAX_FALLOS = 3;
const OTP_MAX_SOLICITUDES = 5;
const OTP_VENTANA_SOLICITUDES_MS = 60 * 60 * 1000;

interface EstadoRecuperacionCotizacion {
  otpHash: string | null;
  otpExpiraEn: number | null;
  fallosVerificacion: number;
  // Marcas de tiempo (epoch ms) de cada solicitud de OTP dentro de la
  // ventana móvil de 60 minutos — se recorta en cada solicitud nueva.
  solicitudesRecientes: number[];
  bloqueado: boolean;
  // Serializa verificaciones concurrentes de la MISMA cotización: evita
  // que dos peticiones simultáneas con el mismo OTP correcto disparen dos
  // regeneraciones inconsistentes (ver verificarRecuperacionCodigo).
  procesandoVerificacion: boolean;
}

const recuperacionPorCotizacion = new Map<string, EstadoRecuperacionCotizacion>();

function obtenerEstadoRecuperacion(cotizacionId: string): EstadoRecuperacionCotizacion {
  let estado = recuperacionPorCotizacion.get(cotizacionId);
  if (!estado) {
    estado = {
      otpHash: null,
      otpExpiraEn: null,
      fallosVerificacion: 0,
      solicitudesRecientes: [],
      bloqueado: false,
      procesandoVerificacion: false,
    };
    recuperacionPorCotizacion.set(cotizacionId, estado);
  }
  return estado;
}

export type EstadoSolicitudOtp = 'enviado' | 'no_disponible' | 'bloqueado';

// Paso A. El token ya identifica, firmado y verificado, una cotización
// real — por eso esta función nunca necesita (ni acepta) un correo
// alternativo: siempre resuelve el correo YA REGISTRADO mediante
// obtenerContactoParaCorreo() (misma función de la Fase 1 de correo
// automático, sin cambios). La respuesta pública nunca distingue "no hay
// correo registrado" de "Brevo falló" — ambas colapsan en 'no_disponible',
// para no revelar nada sobre la relación cliente/cotización.
export async function solicitarRecuperacionCodigo(token: string): Promise<EstadoSolicitudOtp> {
  const cotizacionId = verificarToken(token);
  await cotizacionesRepo.marcarVencidasSiCorresponde();
  const cotizacion = await cotizacionesRepo.findById(cotizacionId);
  if (!cotizacion) {
    throw new CotizacionNoEncontradaError();
  }
  exigirVisibleAlCliente(cotizacion.estado);

  const estado = obtenerEstadoRecuperacion(cotizacionId);
  if (estado.bloqueado) {
    return 'bloqueado';
  }

  const ahora = Date.now();
  estado.solicitudesRecientes = estado.solicitudesRecientes.filter(
    (marca) => ahora - marca < OTP_VENTANA_SOLICITUDES_MS
  );
  // "Cinco solicitudes permitidas, la sexta bloquea": la ventana ya
  // contiene como máximo 5 marcas válidas en este punto; si ya hay 5, ESTA
  // solicitud (la sexta) es la que activa el bloqueo, sin emitir OTP.
  if (estado.solicitudesRecientes.length >= OTP_MAX_SOLICITUDES) {
    estado.bloqueado = true;
    return 'bloqueado';
  }
  estado.solicitudesRecientes.push(ahora);

  const contacto = await cotizacionesRepo.obtenerContactoParaCorreo(cotizacionId);
  const email = contacto?.clienteEmail.trim();
  if (!contacto || !email) {
    return 'no_disponible';
  }

  const otp = crypto.randomInt(100000, 1000000).toString();

  // Orden deliberado (autorización explícita, "revisar cuidadosamente el
  // orden de las operaciones"): se intenta ENVIAR primero; el nuevo OTP
  // solo se persiste en memoria (invalidando el anterior, si había uno
  // todavía vigente) cuando el envío confirma éxito. Si falla, un OTP
  // previo todavía no vencido sigue siendo utilizable — el cliente nunca
  // queda sin ningún código funcional por una segunda solicitud fallida.
  const envio = await enviarCodigoTemporalCotizacion({
    destinatarioEmail: email,
    destinatarioNombre: contacto.clienteNombre,
    solicitudCodigo: contacto.solicitudCodigo,
    cotizacionCodigo: contacto.cotizacionCodigo,
    otp,
  });

  if (envio.estado !== 'sent') {
    return 'no_disponible';
  }

  estado.otpHash = await bcrypt.hash(otp, CODIGO_SALT_ROUNDS);
  estado.otpExpiraEn = ahora + OTP_VIGENCIA_MS;
  return 'enviado';
}

export type EstadoVerificacionOtp = 'regenerado' | 'incorrecto' | 'vencido' | 'bloqueado' | 'no_disponible';

// Paso B + Paso C, en una sola operación (tal como exige "solo después de
// verificar correctamente el correo se podrá regenerar el código real" —
// no hay ningún estado intermedio público entre "verificado" y
// "regenerado"). El código de acceso REAL anterior nunca se toca hasta
// que: (1) el OTP coincide, Y (2) el nuevo código pudo enviarse con éxito.
// Si cualquiera de las dos falla, el código de acceso real anterior sigue
// intacto y funcionando.
export async function verificarRecuperacionCodigo(token: string, otp: string): Promise<EstadoVerificacionOtp> {
  const cotizacionId = verificarToken(token);
  await cotizacionesRepo.marcarVencidasSiCorresponde();
  const cotizacion = await cotizacionesRepo.findById(cotizacionId);
  if (!cotizacion) {
    throw new CotizacionNoEncontradaError();
  }
  exigirVisibleAlCliente(cotizacion.estado);

  const estado = obtenerEstadoRecuperacion(cotizacionId);
  if (estado.bloqueado) {
    return 'bloqueado';
  }
  if (estado.procesandoVerificacion) {
    return 'no_disponible';
  }

  const ahora = Date.now();
  if (!estado.otpHash || estado.otpExpiraEn === null || estado.otpExpiraEn <= ahora) {
    // Vencido o nunca solicitado: NUNCA cuenta como intento incorrecto
    // (requisito explícito — "un código vencido no consume un intento
    // incorrecto").
    return 'vencido';
  }

  estado.procesandoVerificacion = true;
  try {
    const coincide = await bcrypt.compare(otp, estado.otpHash);
    if (!coincide) {
      estado.fallosVerificacion += 1;
      if (estado.fallosVerificacion >= OTP_MAX_FALLOS) {
        // El fallo que CRUZA el umbral se anuncia como 'bloqueado', no
        // como 'incorrecto' — el cliente debe saber de inmediato que ya no
        // quedan más intentos, en vez de parecer que puede seguir
        // probando (consistente con el mismo criterio ya usado en
        // solicitarRecuperacionCodigo para la sexta solicitud).
        estado.bloqueado = true;
        return 'bloqueado';
      }
      return 'incorrecto';
    }

    const contacto = await cotizacionesRepo.obtenerContactoParaCorreo(cotizacionId);
    const email = contacto?.clienteEmail.trim();
    if (!contacto || !email) {
      // Verificación correcta, pero sin correo real al que enviar el
      // código nuevo: el OTP sigue vigente (no se consume) para permitir
      // un reintento si la situación se resuelve antes de que expire.
      return 'no_disponible';
    }

    const nuevoCodigo = crypto.randomInt(100000, 1000000).toString();
    const envio = await enviarCodigoAccesoRegenerado({
      destinatarioEmail: email,
      destinatarioNombre: contacto.clienteNombre,
      solicitudCodigo: contacto.solicitudCodigo,
      cotizacionCodigo: contacto.cotizacionCodigo,
      codigo: nuevoCodigo,
    });

    if (envio.estado !== 'sent') {
      // Mismo criterio que arriba: el OTP (ya verificado correcto) no se
      // consume — el cliente puede reintentar con el MISMO OTP, sin gastar
      // otra de sus solicitudes, y el código de acceso anterior sigue
      // intacto y funcionando.
      return 'no_disponible';
    }

    await cotizacionesRepo.guardarCodigoAcceso(cotizacionId, await bcrypt.hash(nuevoCodigo, CODIGO_SALT_ROUNDS));
    // El código de acceso real cambió: limpia también el contador de
    // intentos del ACCESO NORMAL (mismo criterio que ya aplica
    // generarEnlaceCotizacion al generar un código nuevo) — un código
    // nuevo siempre empieza con ese contador en cero.
    await limpiarIntentos(cotizacionId);

    // Éxito completo de la recuperación: el OTP queda consumido y los
    // fallos de esta sesión de recuperación se reinician.
    estado.otpHash = null;
    estado.otpExpiraEn = null;
    estado.fallosVerificacion = 0;

    return 'regenerado';
  } finally {
    estado.procesandoVerificacion = false;
  }
}
