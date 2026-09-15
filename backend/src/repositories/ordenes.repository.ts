import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

export interface Orden {
  id: string;
  cotizacion_id: string;
  responsable_id: string | null;
  estado: string;
  codigo: string;
  descripcion: string | null;
  fecha_inicio: string | null;
  fecha_entrega: string | null;
  fecha_programada: string | null;
  fecha_finalizacion: string | null;
  fecha_cierre: string | null;
  observaciones: string | null;
  creado_en: string;
  actualizado_en: string;
  avance: number;
  entrega_confirmada_en: string | null;
}

type Executor = Pool | PoolClient;

const COLUMNAS = `id, cotizacion_id, responsable_id, estado, codigo, descripcion,
                   fecha_inicio, fecha_entrega, fecha_programada, fecha_finalizacion,
                   fecha_cierre, observaciones, creado_en, actualizado_en, avance,
                   entrega_confirmada_en`;

export async function listAll(): Promise<Orden[]> {
  const result = await pool.query<Orden>(`SELECT ${COLUMNAS} FROM ordenes ORDER BY creado_en DESC`);
  return result.rows;
}

export async function findById(id: string): Promise<Orden | null> {
  const result = await pool.query<Orden>(`SELECT ${COLUMNAS} FROM ordenes WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

// No se envía `codigo`: lo asigna exclusivamente el trigger
// `trg_ordenes_generar_codigo` ya existente (ver migración V1). La
// unicidad de `cotizacion_id` (ya existente en el esquema) es quien
// garantiza que no pueda haber dos órdenes para la misma cotización.
// `fechaEntrega` (Fase 11, ajuste mínimo autorizado de Fase 8) es opcional
// y viaja parametrizada; `fecha_entrega` ya existe en el esquema sin
// requerir ALTER TABLE.
export async function create(
  executor: Executor,
  data: { cotizacionId: string; descripcion: string | null; fechaEntrega: string | null }
): Promise<Orden> {
  const result = await executor.query<Orden>(
    `INSERT INTO ordenes (id, cotizacion_id, descripcion, fecha_entrega)
     VALUES (gen_random_uuid(), $1, $2, $3)
     RETURNING ${COLUMNAS}`,
    [data.cotizacionId, data.descripcion, data.fechaEntrega]
  );
  return result.rows[0];
}

// UPDATE condicional (misma técnica que solicitudes/cotizaciones): solo
// aplica si el estado actual sigue siendo uno de los orígenes válidos.
// `nuevoEstado` ya fue validado contra la lista fija de estados antes de
// llegar aquí (ver ordenes.service.ts), por lo que la rama que decide qué
// columna de fecha fijar no interpola ningún valor externo sin controlar.
//
// Bloque MVP (avance/evidencia): `observaciones` es opcional — solo se
// pasa cuando la transición a FINALIZADA viene acompañada de una
// observación nueva (ver cambiarEstadoOrden). Se actualiza en la MISMA
// sentencia que el estado (atómico), nunca en un UPDATE separado.
export async function updateEstado(
  id: string,
  nuevoEstado: string,
  estadosOrigenValidos: string[],
  observaciones?: string
): Promise<Orden | null> {
  let columnaFecha = '';
  if (nuevoEstado === 'FINALIZADA') {
    columnaFecha = ', fecha_finalizacion = CURRENT_TIMESTAMP';
  } else if (nuevoEstado === 'CERRADA') {
    columnaFecha = ', fecha_cierre = CURRENT_TIMESTAMP';
  }

  const columnaObservaciones = observaciones !== undefined ? ', observaciones = $4' : '';
  const params: unknown[] = [id, nuevoEstado, estadosOrigenValidos];
  if (observaciones !== undefined) {
    params.push(observaciones);
  }

  const result = await pool.query<Orden>(
    `UPDATE ordenes
     SET estado = $2, actualizado_en = CURRENT_TIMESTAMP${columnaFecha}${columnaObservaciones}
     WHERE id = $1 AND estado = ANY($3::varchar[])
     RETURNING ${COLUMNAS}`,
    params
  );
  return result.rows[0] ?? null;
}

// Bloque MVP: sin restricción de estado en el propio UPDATE — el service
// (`actualizarAvance`) es quien decide si el estado actual admite
// modificar el avance (ej. bloquea CERRADA/CANCELADA), igual que el resto
// de reglas de negocio del proyecto (CLAUDE.md §10).
export async function updateAvance(id: string, avance: number): Promise<Orden | null> {
  const result = await pool.query<Orden>(
    `UPDATE ordenes
     SET avance = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING ${COLUMNAS}`,
    [id, avance]
  );
  return result.rows[0] ?? null;
}

// H-D (auditoría post-V9): UPDATE condicional — solo aplica si la orden
// sigue FINALIZADA en este instante (mismo patrón atómico que
// updateEstado). 0 filas afectadas se traduce en el service a un error
// específico distinto de "orden no encontrada".
export async function confirmarEntrega(id: string): Promise<Orden | null> {
  const result = await pool.query<Orden>(
    `UPDATE ordenes
     SET entrega_confirmada_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'FINALIZADA'
     RETURNING ${COLUMNAS}`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function updateResponsable(id: string, responsableId: string): Promise<Orden | null> {
  const result = await pool.query<Orden>(
    `UPDATE ordenes
     SET responsable_id = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING ${COLUMNAS}`,
    [id, responsableId]
  );
  return result.rows[0] ?? null;
}
