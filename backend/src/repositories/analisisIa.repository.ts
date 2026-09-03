import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

export interface AnalisisIa {
  id: string;
  solicitud_id: string;
  fecha_hora: string;
  resultado: string | null;
  prioridad_sugerida: string | null;
  informacion_estructurada: Record<string, unknown> | null;
  modelo_ia: string | null;
  version_ia: string | null;
  estado: string;
  revisado: boolean;
  revisado_por: string | null;
  revisado_en: string | null;
}

type Executor = Pool | PoolClient;

const COLUMNAS = `id, solicitud_id, fecha_hora, resultado, prioridad_sugerida,
                   informacion_estructurada, modelo_ia, version_ia, estado,
                   revisado, revisado_por, revisado_en`;

export async function listAll(solicitudId?: string): Promise<AnalisisIa[]> {
  if (solicitudId) {
    const result = await pool.query<AnalisisIa>(
      `SELECT ${COLUMNAS} FROM analisis_ia WHERE solicitud_id = $1 ORDER BY fecha_hora DESC`,
      [solicitudId]
    );
    return result.rows;
  }
  const result = await pool.query<AnalisisIa>(`SELECT ${COLUMNAS} FROM analisis_ia ORDER BY fecha_hora DESC`);
  return result.rows;
}

export async function findById(id: string): Promise<AnalisisIa | null> {
  const result = await pool.query<AnalisisIa>(`SELECT ${COLUMNAS} FROM analisis_ia WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

// `estado` inicial queda en PENDIENTE por el DEFAULT ya existente de la
// columna (migración V1) — no se fija explícitamente aquí.
export async function create(executor: Executor, solicitudId: string): Promise<AnalisisIa> {
  const result = await executor.query<AnalisisIa>(
    `INSERT INTO analisis_ia (id, solicitud_id) VALUES (gen_random_uuid(), $1) RETURNING ${COLUMNAS}`,
    [solicitudId]
  );
  return result.rows[0];
}

export async function marcarProcesando(id: string): Promise<void> {
  await pool.query(`UPDATE analisis_ia SET estado = 'PROCESANDO' WHERE id = $1`, [id]);
}

export async function marcarCompletado(
  id: string,
  data: {
    resultado: string;
    prioridadSugerida: string | null;
    informacionEstructurada: Record<string, unknown>;
    modeloIa: string;
    versionIa: string | null;
  }
): Promise<AnalisisIa | null> {
  const result = await pool.query<AnalisisIa>(
    `UPDATE analisis_ia
     SET estado = 'COMPLETADO', resultado = $2, prioridad_sugerida = $3,
         informacion_estructurada = $4, modelo_ia = $5, version_ia = $6
     WHERE id = $1
     RETURNING ${COLUMNAS}`,
    [
      id,
      data.resultado,
      data.prioridadSugerida,
      JSON.stringify(data.informacionEstructurada),
      data.modeloIa,
      data.versionIa,
    ]
  );
  return result.rows[0] ?? null;
}

export async function marcarError(id: string, mensaje: string): Promise<AnalisisIa | null> {
  const result = await pool.query<AnalisisIa>(
    `UPDATE analisis_ia SET estado = 'ERROR', resultado = $2 WHERE id = $1 RETURNING ${COLUMNAS}`,
    [id, mensaje]
  );
  return result.rows[0] ?? null;
}

// UPDATE condicional (mismo patrón que solicitudes/cotizaciones/ordenes):
// solo marca revisado si el estado sigue siendo COMPLETADO en ese momento.
export async function marcarRevisado(id: string, revisadoPor: string): Promise<AnalisisIa | null> {
  const result = await pool.query<AnalisisIa>(
    `UPDATE analisis_ia
     SET revisado = true, revisado_por = $2, revisado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'COMPLETADO'
     RETURNING ${COLUMNAS}`,
    [id, revisadoPor]
  );
  return result.rows[0] ?? null;
}
