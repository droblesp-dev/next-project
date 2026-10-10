import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

export interface Solicitud {
  id: string;
  cliente_id: string;
  servicio: string;
  descripcion: string;
  cantidad: number;
  fecha_requerida: string | null;
  estado: string;
  especificaciones: string | null;
  requiere_comprobante: boolean;
  // FORMULARIO-01 (V10): código legible ("SOL-000123"), generado por el
  // trigger `trg_solicitudes_generar_codigo` — nunca se pasa por INSERT.
  // NULL en toda solicitud creada antes de la migración V10 (histórico
  // nunca se completa retroactivamente, ver V10__solicitudes_codigo.sql).
  codigo: string | null;
  creado_en: string;
  actualizado_en: string;
}

type Executor = Pool | PoolClient;

const COLUMNAS = `id, cliente_id, servicio, descripcion, cantidad, fecha_requerida,
                   estado, creado_en, actualizado_en, especificaciones, requiere_comprobante, codigo`;

export async function listAll(): Promise<Solicitud[]> {
  const result = await pool.query<Solicitud>(
    `SELECT ${COLUMNAS} FROM solicitudes ORDER BY creado_en DESC`
  );
  return result.rows;
}

export async function findById(id: string): Promise<Solicitud | null> {
  const result = await pool.query<Solicitud>(
    `SELECT ${COLUMNAS} FROM solicitudes WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function create(
  executor: Executor,
  data: {
    clienteId: string;
    servicio: string;
    descripcion: string;
    cantidad: number;
    fechaRequerida: string | null;
    // FORMULARIO-01: nota para Comercial cuando el cliente no conoce la
    // cantidad todavía ("Aún no lo sé") — columna ya existente, sin uso
    // previo desde el formulario público (ver auditoría previa). Opcional
    // y por defecto null: ningún llamador existente cambia de comportamiento.
    especificaciones?: string | null;
    // SOLICITUD-RECUPERACION-01A (autorización explícita, V11): clave de
    // idempotencia de la operación de envío (ver
    // solicitudes.service.ts::crearSolicitud). Opcional a propósito: el
    // ÚNICO otro llamador real de esta función (crearSolicitudPorEnlace en
    // leads.service.ts) no la envía y sigue comportándose exactamente igual
    // — la columna queda NULL para ese flujo, igual que para toda solicitud
    // histórica (mismo patrón ya usado por `codigo`, V10). Se almacena pero
    // NUNCA se agrega a COLUMNAS/RETURNING: no debe exponerse en la
    // respuesta pública de ningún endpoint (decisión explícita de seguridad
    // del bloque, Bloque Q).
    idempotencyKey?: string | null;
  }
): Promise<Solicitud> {
  const result = await executor.query<Solicitud>(
    `INSERT INTO solicitudes (id, cliente_id, servicio, descripcion, cantidad, fecha_requerida, especificaciones, idempotency_key)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
     RETURNING ${COLUMNAS}`,
    [
      data.clienteId,
      data.servicio,
      data.descripcion,
      data.cantidad,
      data.fechaRequerida,
      data.especificaciones ?? null,
      data.idempotencyKey ?? null,
    ]
  );
  return result.rows[0];
}

// SOLICITUD-RECUPERACION-01A (autorización explícita): recupera la
// solicitud YA creada por una operación de envío anterior con la misma
// clave de idempotencia. Uso exclusivo: el camino de "repetición" dentro de
// crearSolicitud() (solicitudes.service.ts) cuando el INSERT de create()
// choca con la restricción UNIQUE uq_solicitudes_idempotency_key — nunca se
// llama con una clave vacía/nula. Misma COLUMNAS pública de siempre
// (idempotency_key nunca se expone, ver create() arriba).
export async function findByIdempotencyKey(executor: Executor, idempotencyKey: string): Promise<Solicitud | null> {
  const result = await executor.query<Solicitud>(
    `SELECT ${COLUMNAS} FROM solicitudes WHERE idempotency_key = $1`,
    [idempotencyKey]
  );
  return result.rows[0] ?? null;
}

// UPDATE condicional (concurrencia optimista): solo aplica el cambio si el
// estado actual sigue siendo uno de los orígenes permitidos para la
// transición solicitada. Atómico por definición de PostgreSQL — no requiere
// una transacción explícita ni un SELECT previo para garantizar la
// integridad (el SELECT posterior en el service es solo para el mensaje de
// error, no para la garantía de corrección).
//
// `executor` opcional (por defecto el pool): permite invocar este mismo
// UPDATE condicional dentro de una transacción ya abierta por otro service
// (ver cotizaciones.service.ts::cambiarAEnviadaConSolicitud) sin duplicar la
// sentencia SQL. Todos los llamadores existentes, que no pasan `executor`,
// se comportan exactamente igual que antes.
export async function updateEstado(
  id: string,
  nuevoEstado: string,
  estadosOrigenValidos: string[],
  executor: Executor = pool
): Promise<Solicitud | null> {
  const result = await executor.query<Solicitud>(
    `UPDATE solicitudes
     SET estado = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = ANY($3::varchar[])
     RETURNING ${COLUMNAS}`,
    [id, nuevoEstado, estadosOrigenValidos]
  );
  return result.rows[0] ?? null;
}
