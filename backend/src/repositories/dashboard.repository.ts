import { pool } from '../config/db.js';

export interface ConteoPorEstado {
  estado: string;
  total: number;
}

// Todas las consultas de este repositorio son exclusivamente de lectura
// (SELECT/COUNT/SUM/GROUP BY) sobre tablas ya existentes de Fases 4-11.
// Ninguna función de este archivo ejecuta INSERT, UPDATE ni DELETE.

export async function solicitudesPorEstado(): Promise<ConteoPorEstado[]> {
  const result = await pool.query<ConteoPorEstado>(
    `SELECT estado, COUNT(*)::int AS total FROM solicitudes GROUP BY estado ORDER BY estado`
  );
  return result.rows;
}

export async function cotizacionesPorEstado(): Promise<ConteoPorEstado[]> {
  const result = await pool.query<ConteoPorEstado>(
    `SELECT estado, COUNT(*)::int AS total FROM cotizaciones GROUP BY estado ORDER BY estado`
  );
  return result.rows;
}

// Suma real de `valor` únicamente sobre cotizaciones ACEPTADA. No se
// interpreta como ingreso/facturación (decisión explícita de Fase 12).
export async function valorTotalCotizacionesAceptadas(): Promise<number> {
  const result = await pool.query<{ total: string | null }>(
    `SELECT SUM(valor) AS total FROM cotizaciones WHERE estado = 'ACEPTADA'`
  );
  return result.rows[0].total !== null ? Number(result.rows[0].total) : 0;
}

export async function ordenesPorEstado(): Promise<ConteoPorEstado[]> {
  const result = await pool.query<ConteoPorEstado>(
    `SELECT estado, COUNT(*)::int AS total FROM ordenes GROUP BY estado ORDER BY estado`
  );
  return result.rows;
}

export async function alertasPendientesYAtendidas(): Promise<{ pendientes: number; atendidas: number }> {
  const result = await pool.query<{ pendientes: number; atendidas: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE estado = 'PENDIENTE')::int AS pendientes,
       COUNT(*) FILTER (WHERE estado = 'ATENDIDA')::int AS atendidas
     FROM alertas`
  );
  return result.rows[0];
}

export async function leadsPorClasificacion(): Promise<ConteoPorEstado[]> {
  const result = await pool.query<{ clasificacion: string; total: number }>(
    `SELECT clasificacion, COUNT(*)::int AS total FROM leads GROUP BY clasificacion ORDER BY clasificacion`
  );
  return result.rows.map((r) => ({ estado: r.clasificacion, total: r.total }));
}

export interface ResumenAnalisisIa {
  totalEjecuciones: number;
  completadas: number;
  conError: number;
  revisadas: number;
  solicitudesDistintas: number;
}

// KPI "Análisis IA — ejecuciones registradas" (Fase 12, autorización
// definitiva): cuenta EJECUCIONES reales de analisis_ia, no solicitudes.
// `solicitudesDistintas` permite construir la nota aclaratoria de forma
// dinámica en el service, sin hardcodear "una única solicitud".
export async function resumenAnalisisIa(): Promise<ResumenAnalisisIa> {
  const result = await pool.query<{
    total_ejecuciones: number;
    completadas: number;
    con_error: number;
    revisadas: number;
    solicitudes_distintas: number;
  }>(
    `SELECT
       COUNT(*)::int AS total_ejecuciones,
       COUNT(*) FILTER (WHERE estado = 'COMPLETADO')::int AS completadas,
       COUNT(*) FILTER (WHERE estado = 'ERROR')::int AS con_error,
       COUNT(*) FILTER (WHERE revisado = true)::int AS revisadas,
       COUNT(DISTINCT solicitud_id)::int AS solicitudes_distintas
     FROM analisis_ia`
  );
  const row = result.rows[0];
  return {
    totalEjecuciones: row.total_ejecuciones,
    completadas: row.completadas,
    conError: row.con_error,
    revisadas: row.revisadas,
    solicitudesDistintas: row.solicitudes_distintas,
  };
}
