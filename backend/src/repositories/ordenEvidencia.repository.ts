import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

// Bloque 3A: contarPorTipo/crear aceptan un executor opcional para ejecutarse dentro de la
// transacción de subida de evidencia (ver ordenEvidencia.service.ts). Sin él usan el pool, igual que antes.
type Executor = Pool | PoolClient;

export interface OrdenEvidencia {
  id: string;
  orden_id: string;
  tipo: string;
  nombre_archivo: string;
  creado_en: string;
}

const COLUMNAS = 'id, orden_id, tipo, nombre_archivo, creado_en';

export async function listarPorOrden(ordenId: string): Promise<OrdenEvidencia[]> {
  const result = await pool.query<OrdenEvidencia>(
    `SELECT ${COLUMNAS} FROM ordenes_evidencias WHERE orden_id = $1 ORDER BY creado_en ASC`,
    [ordenId]
  );
  return result.rows;
}

export async function contarPorTipo(ordenId: string, tipo: string, executor: Executor = pool): Promise<number> {
  const result = await executor.query<{ total: string }>(
    'SELECT COUNT(*) AS total FROM ordenes_evidencias WHERE orden_id = $1 AND tipo = $2',
    [ordenId, tipo]
  );
  return Number(result.rows[0].total);
}

export async function contarTotal(ordenId: string): Promise<number> {
  const result = await pool.query<{ total: string }>(
    'SELECT COUNT(*) AS total FROM ordenes_evidencias WHERE orden_id = $1',
    [ordenId]
  );
  return Number(result.rows[0].total);
}

// H-B (auditoría post-V9): único punto de lectura de una evidencia
// individual — usado exclusivamente por el endpoint de descarga, que
// además verifica que `orden_id` coincida con la orden de la ruta.
export async function findById(id: string): Promise<OrdenEvidencia | null> {
  const result = await pool.query<OrdenEvidencia>(
    `SELECT ${COLUMNAS} FROM ordenes_evidencias WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

// Sin función de eliminación (decisión explícita del bloque: solo agregar).
export async function crear(
  data: {
    ordenId: string;
    tipo: string;
    nombreArchivo: string;
  },
  executor: Executor = pool
): Promise<OrdenEvidencia> {
  const result = await executor.query<OrdenEvidencia>(
    `INSERT INTO ordenes_evidencias (id, orden_id, tipo, nombre_archivo)
     VALUES (gen_random_uuid(), $1, $2, $3)
     RETURNING ${COLUMNAS}`,
    [data.ordenId, data.tipo, data.nombreArchivo]
  );
  return result.rows[0];
}
