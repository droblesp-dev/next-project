import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

// `valor` es NUMERIC en PostgreSQL; el driver `pg` lo devuelve como string
// (no lo convierte a number) para no perder precisión — se respeta ese
// comportamiento real en lugar de asumir un tipo numérico en TypeScript.
export interface Cotizacion {
  id: string;
  solicitud_id: string;
  valor: string;
  estado: string;
  descripcion: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
  fecha_vigencia: string | null;
  aceptada_en: string | null;
  rechazada_en: string | null;
  subtotal: string | null;
  iva_porcentaje: string | null;
  iva_valor: string | null;
  total: string | null;
  anticipo_porcentaje: string | null;
  anticipo_valor: string | null;
  saldo_pendiente: string | null;
  metodo_anticipo: string | null;
  estado_anticipo: string | null;
  anticipo_confirmado_en: string | null;
  anticipo_confirmado_por: string | null;
  comprobante_recibido: boolean;
  metodo_saldo: string | null;
  estado_saldo: string;
  saldo_confirmado_en: string | null;
  saldo_confirmado_por: string | null;
  saldo_comprobante_recibido: boolean;
}

type Executor = Pool | PoolClient;

// `fecha_vigencia`/`aceptada_en` ya existían en el esquema (V1) pero no se
// exponían: necesarias para la vista pública de cotización (vigencia) y
// para registrar/mostrar la fecha real de aceptación.
// Los 8 campos de IVA/anticipo (Fase D.2) también ya existían en el
// esquema desde V1, sin usarse: ahora se calculan y persisten desde
// crearCotizacion(). `rechazada_en` (V5) se agrega en Fase D.5 para
// registrar el rechazo público. `anticipo_confirmado_en/_por` se agregan
// en D.6. `comprobante_anticipo` (la referencia real del archivo) se
// mantiene deliberadamente FUERA de COLUMNAS — igual que
// `acceso_codigo_hash` — y solo se expone como el booleano calculado
// `comprobante_recibido`: ni el listado interno ni la vista pública deben
// conocer jamás el nombre/ruta real del archivo (Comercial lo descarga
// mediante un endpoint dedicado que resuelve la ruta en el servidor).
// Bloque saldo/entrega/cierre: `comprobante_saldo` se mantiene fuera de
// COLUMNAS, mismo tratamiento que `comprobante_anticipo` — solo se expone
// el booleano calculado `saldo_comprobante_recibido`. `saldo_pendiente`
// sigue siendo exclusivamente el monto fijo calculado en crearCotizacion();
// ninguna función de este archivo permite escribirlo.
const COLUMNAS = `id, solicitud_id, valor, estado, descripcion, creado_por, creado_en, actualizado_en, fecha_vigencia, aceptada_en, rechazada_en, subtotal, iva_porcentaje, iva_valor, total, anticipo_porcentaje, anticipo_valor, saldo_pendiente, metodo_anticipo, estado_anticipo, anticipo_confirmado_en, anticipo_confirmado_por, (comprobante_anticipo IS NOT NULL) AS comprobante_recibido, metodo_saldo, estado_saldo, saldo_confirmado_en, saldo_confirmado_por, (comprobante_saldo IS NOT NULL) AS saldo_comprobante_recibido`;

export async function listAll(): Promise<Cotizacion[]> {
  const result = await pool.query<Cotizacion>(
    `SELECT ${COLUMNAS} FROM cotizaciones ORDER BY creado_en DESC`
  );
  return result.rows;
}

export async function findById(id: string): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `SELECT ${COLUMNAS} FROM cotizaciones WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function create(
  executor: Executor,
  data: {
    solicitudId: string;
    valor: number;
    descripcion: string | null;
    creadoPor: string;
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
): Promise<Cotizacion> {
  const result = await executor.query<Cotizacion>(
    `INSERT INTO cotizaciones (
       id, solicitud_id, valor, descripcion, creado_por,
       subtotal, iva_porcentaje, iva_valor, total,
       anticipo_porcentaje, anticipo_valor, saldo_pendiente,
       metodo_anticipo, estado_anticipo, fecha_vigencia
     )
     VALUES (
       gen_random_uuid(), $1, $2, $3, $4,
       $5, $6, $7, $8,
       $9, $10, $11,
       $12, $13, CURRENT_TIMESTAMP + ($14 || ' days')::INTERVAL
     )
     RETURNING ${COLUMNAS}`,
    [
      data.solicitudId,
      data.valor,
      data.descripcion,
      data.creadoPor,
      data.subtotal,
      data.ivaPorcentaje,
      data.ivaValor,
      data.total,
      data.anticipoPorcentaje,
      data.anticipoValor,
      data.saldoPendiente,
      data.metodoAnticipo,
      data.estadoAnticipo,
      data.diasVigencia,
    ]
  );
  return result.rows[0];
}

// UPDATE condicional (misma técnica que solicitudes.repository.ts): solo
// aplica el cambio si el estado actual sigue siendo uno de los orígenes
// válidos para la transición solicitada. El índice único parcial
// `ux_cotizaciones_una_aceptada` (ya existente, no se toca) es quien
// garantiza a nivel de PostgreSQL que no haya dos cotizaciones ACEPTADA
// para la misma solicitud; una violación de esa unicidad se traduce en el
// service a un error de dominio específico.
export async function updateEstado(
  id: string,
  nuevoEstado: string,
  estadosOrigenValidos: string[]
): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = ANY($3::varchar[])
     RETURNING ${COLUMNAS}`,
    [id, nuevoEstado, estadosOrigenValidos]
  );
  return result.rows[0] ?? null;
}

// `acceso_codigo_hash` (Fase B) se mantiene deliberadamente fuera de
// `COLUMNAS`/`Cotizacion`: nunca debe viajar en la respuesta de ningún
// listado/consulta general (interno o público). Estas dos funciones son
// el único punto de lectura/escritura de ese campo.
// Aceptación/rechazo público (Fase D.5): UPDATE condicional — solo aplica
// si la fila SIGUE en estado ENVIADA en este instante (protege contra
// condiciones de carrera: dos pestañas del cliente, o un vencimiento
// perezoso que ocurrió entre la validación y este UPDATE). Si otra
// cotización de la misma solicitud ya está ACEPTADA, `ux_cotizaciones_una_
// aceptada` rechaza el UPDATE con una violación de unicidad — el service
// la traduce a YaExisteAceptadaError, igual que en cambiarEstadoCotizacion.
export async function marcarAceptada(id: string): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado = 'ACEPTADA', aceptada_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ENVIADA'
     RETURNING ${COLUMNAS}`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function marcarRechazada(id: string): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado = 'RECHAZADA', rechazada_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ENVIADA'
     RETURNING ${COLUMNAS}`,
    [id]
  );
  return result.rows[0] ?? null;
}

// Vencimiento perezoso (Fase D.3): UPDATE condicional sin scheduler/cron,
// mismo patrón ya usado para alertas. Solo afecta filas ENVIADA cuya
// fecha_vigencia ya pasó — nunca toca ACEPTADA/RECHAZADA/CANCELADA/
// VENCIDA/BORRADOR ni filas ENVIADA sin fecha_vigencia asignada (datos
// previos a D.2). No elimina ninguna fila: solo cambia su estado.
export async function marcarVencidasSiCorresponde(): Promise<void> {
  await pool.query(
    `UPDATE cotizaciones
     SET estado = 'VENCIDA', actualizado_en = CURRENT_TIMESTAMP
     WHERE estado = 'ENVIADA'
       AND fecha_vigencia IS NOT NULL
       AND fecha_vigencia < CURRENT_TIMESTAMP`
  );
}

// Comprobante de transferencia (Fase D.6): UPDATE condicional — solo
// aplica si la cotización sigue ACEPTADA, el método sigue siendo
// TRANSFERENCIA y el anticipo sigue PENDIENTE (protege contra que alguien
// suba un comprobante sobre un anticipo ya validado/rechazado, o sobre
// una cotización que dejó de ser ACEPTADA). `nombreArchivo` es siempre un
// nombre generado por el propio backend (uploadsComprobantes.ts), nunca
// un valor recibido tal cual del cliente.
export async function guardarComprobante(id: string, nombreArchivo: string): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `UPDATE cotizaciones
     SET comprobante_anticipo = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA' AND metodo_anticipo = 'TRANSFERENCIA' AND estado_anticipo = 'PENDIENTE'
     RETURNING ${COLUMNAS}`,
    [id, nombreArchivo]
  );
  return result.rows[0] ?? null;
}

// Único punto que lee el nombre REAL del archivo — usado exclusivamente
// por el endpoint interno de descarga, que resuelve la ruta absoluta en
// el servidor (COMPROBANTES_DIR + este nombre). El cliente nunca ve ni
// envía este valor.
export async function obtenerNombreComprobante(id: string): Promise<string | null> {
  const result = await pool.query<{ comprobante_anticipo: string | null }>(
    'SELECT comprobante_anticipo FROM cotizaciones WHERE id = $1',
    [id]
  );
  return result.rows[0]?.comprobante_anticipo ?? null;
}

// Confirmación/rechazo de anticipo por Comercial (Fase D.6): UPDATE
// condicional — solo aplica si la cotización sigue ACEPTADA y su
// anticipo sigue PENDIENTE (evita re-gestionar uno ya resuelto).
// `confirmadoPor` es siempre `req.user.sub` de un ADMIN/COMERCIAL
// autenticado (la ruta está detrás de requireAuth+requireRole) — nunca
// puede originarse en el flujo público.
export async function actualizarEstadoAnticipo(
  id: string,
  nuevoEstadoAnticipo: string,
  confirmadoPor: string
): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado_anticipo = $2, anticipo_confirmado_en = CURRENT_TIMESTAMP, anticipo_confirmado_por = $3, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA' AND estado_anticipo = 'PENDIENTE'
     RETURNING ${COLUMNAS}`,
    [id, nuevoEstadoAnticipo, confirmadoPor]
  );
  return result.rows[0] ?? null;
}

// Comprobante de saldo (bloque saldo/entrega/cierre): mismo patrón que
// guardarComprobante() para el anticipo — UPDATE condicional. A diferencia
// del anticipo, `metodo_saldo` no se elige de antemano al crear la
// cotización: esta subida lo fija implícitamente en TRANSFERENCIA la
// primera vez (si ya estaba en TRANSFERENCIA, no cambia nada). Si ya se
// hubiera fijado como EFECTIVO, la condición `metodo_saldo IS NULL OR
// metodo_saldo = 'TRANSFERENCIA'` bloquea el UPDATE (0 filas afectadas).
export async function guardarComprobanteSaldo(id: string, nombreArchivo: string): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `UPDATE cotizaciones
     SET comprobante_saldo = $2, metodo_saldo = 'TRANSFERENCIA', actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA' AND estado_saldo = 'PENDIENTE'
       AND (metodo_saldo IS NULL OR metodo_saldo = 'TRANSFERENCIA')
     RETURNING ${COLUMNAS}`,
    [id, nombreArchivo]
  );
  return result.rows[0] ?? null;
}

// Único punto que lee el nombre REAL del comprobante de saldo — mismo
// tratamiento que obtenerNombreComprobante() para el anticipo.
export async function obtenerNombreComprobanteSaldo(id: string): Promise<string | null> {
  const result = await pool.query<{ comprobante_saldo: string | null }>(
    'SELECT comprobante_saldo FROM cotizaciones WHERE id = $1',
    [id]
  );
  return result.rows[0]?.comprobante_saldo ?? null;
}

// Validación/rechazo de saldo (ADMIN/COMERCIAL, ruta ya restringida a
// nivel de router). `metodoSaldo` se persiste en la MISMA sentencia que
// VALIDAR — cubre el caso EFECTIVO, donde el método nunca se fijó antes
// (no hay comprobante que lo determine implícitamente). UPDATE
// condicional: solo aplica si la cotización sigue ACEPTADA con saldo
// PENDIENTE.
export async function validarSaldo(
  id: string,
  confirmadoPor: string,
  metodoSaldo: string
): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado_saldo = 'VALIDADO', metodo_saldo = $3, saldo_confirmado_en = CURRENT_TIMESTAMP, saldo_confirmado_por = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA' AND estado_saldo = 'PENDIENTE'
     RETURNING ${COLUMNAS}`,
    [id, confirmadoPor, metodoSaldo]
  );
  return result.rows[0] ?? null;
}

export async function rechazarSaldo(id: string, confirmadoPor: string): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado_saldo = 'RECHAZADO', saldo_confirmado_en = CURRENT_TIMESTAMP, saldo_confirmado_por = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA' AND estado_saldo = 'PENDIENTE'
     RETURNING ${COLUMNAS}`,
    [id, confirmadoPor]
  );
  return result.rows[0] ?? null;
}

// H-E (auditoría post-V9): recuperación explícita de un saldo RECHAZADO —
// vuelve a PENDIENTE en un estado limpio (mismo estado que antes del
// primer intento): se borran metodo_saldo/comprobante_saldo/
// saldo_confirmado_en/_por para que "pueda presentarse nuevamente
// comprobante y gestionarse normalmente" (decisión explícita), sin
// arrastrar el método o comprobante del intento rechazado. No crea tabla
// de historial — el registro del rechazo simplemente se sobrescribe.
export async function reabrirSaldo(id: string): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado_saldo = 'PENDIENTE', metodo_saldo = NULL, comprobante_saldo = NULL,
         saldo_confirmado_en = NULL, saldo_confirmado_por = NULL, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA' AND estado_saldo = 'RECHAZADO'
     RETURNING ${COLUMNAS}`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function guardarCodigoAcceso(id: string, hash: string): Promise<void> {
  await pool.query('UPDATE cotizaciones SET acceso_codigo_hash = $2 WHERE id = $1', [id, hash]);
}

export async function obtenerHashCodigoAcceso(id: string): Promise<string | null> {
  const result = await pool.query<{ acceso_codigo_hash: string | null }>(
    'SELECT acceso_codigo_hash FROM cotizaciones WHERE id = $1',
    [id]
  );
  return result.rows[0]?.acceso_codigo_hash ?? null;
}
