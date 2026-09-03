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
  creado_en: string;
  actualizado_en: string;
}

type Executor = Pool | PoolClient;

const COLUMNAS = `id, cliente_id, servicio, descripcion, cantidad, fecha_requerida,
                   estado, especificaciones, requiere_comprobante, creado_en, actualizado_en`;

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
  }
): Promise<Solicitud> {
  const result = await executor.query<Solicitud>(
    `INSERT INTO solicitudes (id, cliente_id, servicio, descripcion, cantidad, fecha_requerida)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
     RETURNING ${COLUMNAS}`,
    [data.clienteId, data.servicio, data.descripcion, data.cantidad, data.fechaRequerida]
  );
  return result.rows[0];
}

// UPDATE condicional (concurrencia optimista): solo aplica el cambio si el
// estado actual sigue siendo uno de los orígenes permitidos para la
// transición solicitada. Atómico por definición de PostgreSQL — no requiere
// una transacción explícita ni un SELECT previo para garantizar la
// integridad (el SELECT posterior en el service es solo para el mensaje de
// error, no para la garantía de corrección).
export async function updateEstado(
  id: string,
  nuevoEstado: string,
  estadosOrigenValidos: string[]
): Promise<Solicitud | null> {
  const result = await pool.query<Solicitud>(
    `UPDATE solicitudes
     SET estado = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = ANY($3::varchar[])
     RETURNING ${COLUMNAS}`,
    [id, nuevoEstado, estadosOrigenValidos]
  );
  return result.rows[0] ?? null;
}
