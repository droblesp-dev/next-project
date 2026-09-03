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
}

type Executor = Pool | PoolClient;

const COLUMNAS = `id, solicitud_id, valor, estado, descripcion, creado_por, creado_en, actualizado_en`;

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
  }
): Promise<Cotizacion> {
  const result = await executor.query<Cotizacion>(
    `INSERT INTO cotizaciones (id, solicitud_id, valor, descripcion, creado_por)
     VALUES (gen_random_uuid(), $1, $2, $3, $4)
     RETURNING ${COLUMNAS}`,
    [data.solicitudId, data.valor, data.descripcion, data.creadoPor]
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
