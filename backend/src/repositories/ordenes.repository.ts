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
  // V22: quién ejecutó cada hito (NULL = autor desconocido, p. ej. órdenes anteriores a V22). Los nombres son
  // datos DERIVADOS (JOIN a usuarios), no columnas de `ordenes`.
  estado_cambiado_por: string | null;
  finalizada_por: string | null;
  entrega_confirmada_por: string | null;
  cerrada_por: string | null;
  responsable_nombre: string | null;
  estado_cambiado_por_nombre: string | null;
  finalizada_por_nombre: string | null;
  entrega_confirmada_por_nombre: string | null;
  cerrada_por_nombre: string | null;
  // Bloque 2B.1: dato DERIVADO (no es una columna de `ordenes`): solicitud de la
  // cotización de la orden (ordenes.cotizacion_id -> cotizaciones.solicitud_id).
  // Solo identifica la conversación de la solicitud; no concede acceso a ella
  // (el chat sigue autorizando en backend según Bloque 2A).
  solicitud_id: string;
}

type Executor = Pool | PoolClient;

const COLUMNAS = `id, cotizacion_id, responsable_id, estado, codigo, descripcion,
                   fecha_inicio, fecha_entrega, fecha_programada, fecha_finalizacion,
                   fecha_cierre, observaciones, creado_en, actualizado_en, avance,
                   entrega_confirmada_en,
                   estado_cambiado_por, finalizada_por, entrega_confirmada_por, cerrada_por,
                   (SELECT u.nombre FROM usuarios u WHERE u.id = ordenes.responsable_id) AS responsable_nombre,
                   (SELECT u.nombre FROM usuarios u WHERE u.id = ordenes.estado_cambiado_por) AS estado_cambiado_por_nombre,
                   (SELECT u.nombre FROM usuarios u WHERE u.id = ordenes.finalizada_por) AS finalizada_por_nombre,
                   (SELECT u.nombre FROM usuarios u WHERE u.id = ordenes.entrega_confirmada_por) AS entrega_confirmada_por_nombre,
                   (SELECT u.nombre FROM usuarios u WHERE u.id = ordenes.cerrada_por) AS cerrada_por_nombre,
                   (SELECT c.solicitud_id FROM cotizaciones c WHERE c.id = ordenes.cotizacion_id) AS solicitud_id`;

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
  data: {
    cotizacionId: string;
    descripcion: string | null;
    fechaEntrega: string | null;
    responsableId: string;
  }
): Promise<Orden> {
  const result = await executor.query<Orden>(
    `INSERT INTO ordenes (id, cotizacion_id, descripcion, fecha_entrega, responsable_id)
     VALUES (gen_random_uuid(), $1, $2, $3, $4)
     RETURNING ${COLUMNAS}`,
    [data.cotizacionId, data.descripcion, data.fechaEntrega, data.responsableId]
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
  observaciones?: string,
  actorId?: string
): Promise<Orden | null> {
  let columnaFecha = '';
  let condicionFinalizacion = '';
  if (nuevoEstado === 'FINALIZADA') {
    columnaFecha = ', fecha_finalizacion = CURRENT_TIMESTAMP';
    // Bloque 3A: los requisitos de finalización se comprueban DENTRO del mismo UPDATE (atómico).
    // Antes se leían aparte (SELECT -> validar -> UPDATE) y un cambio de avance concurrente
    // podía dejar la orden FINALIZADA con avance < 100. Con la condición en el WHERE, si otra
    // transacción cambia el avance antes, PostgreSQL vuelve a evaluar la fila y el UPDATE no
    // aplica (0 filas). Las evidencias nunca se eliminan, por lo que la comprobación es estable.
    const observacionFinal = observaciones !== undefined ? '$4::text' : "COALESCE(observaciones, '')";
    condicionFinalizacion = ` AND avance = 100
       AND EXISTS (SELECT 1 FROM ordenes_evidencias e WHERE e.orden_id = ordenes.id)
       AND btrim(${observacionFinal}) <> ''`;
  } else if (nuevoEstado === 'CERRADA') {
    columnaFecha = ', fecha_cierre = CURRENT_TIMESTAMP';
  } else if (nuevoEstado === 'EN_PROCESO') {
    // Bloque 3A: fecha_inicio se registra la primera vez que la orden entra en EN_PROCESO y nunca
    // se sobrescribe (reanudar desde PAUSADA conserva la original). Es DATE (fecha local del
    // servidor de BD). El CHECK existente chk_ordenes_fechas exige fecha_entrega >= fecha_inicio:
    // si la fecha de entrega ya pasó, NO se registra (quedaría NULL) para no impedir el inicio de
    // la orden con un error de BD. [REQUIERE DECISIÓN] qué hacer en ese caso (ver informe 3A).
    columnaFecha = `, fecha_inicio = CASE
         WHEN fecha_inicio IS NOT NULL THEN fecha_inicio
         WHEN fecha_entrega IS NULL OR fecha_entrega >= CURRENT_DATE THEN CURRENT_DATE
         ELSE NULL
       END`;
  }

  const columnaObservaciones = observaciones !== undefined ? ', observaciones = $4' : '';
  const params: unknown[] = [id, nuevoEstado, estadosOrigenValidos];
  if (observaciones !== undefined) {
    params.push(observaciones);
  }

  // V22: el actor del cambio queda en el mismo UPDATE atómico (último cambio + hito de FINALIZADA/CERRADA).
  let columnaActor = '';
  if (actorId !== undefined) {
    params.push(actorId);
    const n = params.length;
    columnaActor = `, estado_cambiado_por = $${n}::uuid`;
    if (nuevoEstado === 'FINALIZADA') columnaActor += `, finalizada_por = $${n}::uuid`;
    if (nuevoEstado === 'CERRADA') columnaActor += `, cerrada_por = $${n}::uuid`;
  }

  const result = await pool.query<Orden>(
    `UPDATE ordenes
     SET estado = $2, actualizado_en = CURRENT_TIMESTAMP${columnaFecha}${columnaObservaciones}${columnaActor}
     WHERE id = $1 AND estado = ANY($3::varchar[])${condicionFinalizacion}
     RETURNING ${COLUMNAS}`,
    params
  );
  return result.rows[0] ?? null;
}

// Bloque 3A: UPDATE condicional — solo aplica si la orden NO está en uno de los estados que ya no
// admiten avance (FINALIZADA/CERRADA/CANCELADA, que decide el service). Antes el UPDATE era
// incondicional y el estado se comprobaba en un SELECT previo, por lo que una finalización
// concurrente podía quedar con el avance modificado después. 0 filas = no existe o no modificable
// (el service lo distingue).
// Bloque 3B: se agrega `AND avance <= $2` — el avance nunca puede disminuir. Al estar en el mismo
// WHERE del UPDATE atómico, dos PATCH de avance simultáneos (uno subiendo, otro bajando) sobre el
// mismo valor de partida no pueden dejar el valor más bajo "ganando": solo uno de los dos ve su
// propia condición cumplida en el momento de ejecutarse (el otro deja de cumplirla apenas el primero
// hace commit). 0 filas = no existe, estado bloqueado, o el nuevo valor es menor al actual (el
// service distingue leyendo la fila después).
// Bloque 3B.1: se agrega `AND (estado <> 'PENDIENTE' OR $2 = 0)` — mientras la orden está PENDIENTE
// el único valor de avance permitido es 0 (el trabajo empieza recién al pasar a EN_PROCESO); un
// intento de fijar avance > 0 en PENDIENTE no aplica el UPDATE, en la misma condición atómica que ya
// resuelve el resto de reglas de este endpoint.
export async function updateAvance(id: string, avance: number, estadosBloqueados: string[]): Promise<Orden | null> {
  const result = await pool.query<Orden>(
    `UPDATE ordenes
     SET avance = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND NOT (estado = ANY($3::varchar[])) AND avance <= $2 AND (estado <> 'PENDIENTE' OR $2 = 0)
     RETURNING ${COLUMNAS}`,
    [id, avance, estadosBloqueados]
  );
  return result.rows[0] ?? null;
}

// Bloque 3A: bloquea la fila de la orden (FOR UPDATE) dentro de una transacción ya abierta y
// devuelve solo lo necesario. Serializa las subidas de evidencia de una misma orden (y las
// transiciones de estado que actualizan esa fila) para que el límite por tipo sea exacto.
export async function findEstadoParaActualizar(
  executor: Executor,
  id: string
): Promise<{ id: string; estado: string } | null> {
  const result = await executor.query<{ id: string; estado: string }>(
    'SELECT id, estado FROM ordenes WHERE id = $1 FOR UPDATE',
    [id]
  );
  return result.rows[0] ?? null;
}

// H-D (auditoría post-V9): UPDATE condicional — solo aplica si la orden
// sigue FINALIZADA en este instante (mismo patrón atómico que
// updateEstado). 0 filas afectadas se traduce en el service a un error
// específico distinto de "orden no encontrada".
// Bloque 3B: se agrega `AND entrega_confirmada_en IS NULL` — la fecha real de entrega solo se
// registra una vez; una confirmación posterior ya no sobrescribe la fecha original (antes, cada
// llamada mientras la orden seguía FINALIZADA volvía a fijar CURRENT_TIMESTAMP). 0 filas ahora puede
// significar "no está FINALIZADA" o "ya estaba confirmada"; el service distingue leyendo la fila.
export async function confirmarEntrega(id: string, actorId?: string): Promise<Orden | null> {
  const result = await pool.query<Orden>(
    `UPDATE ordenes
     SET entrega_confirmada_en = CURRENT_TIMESTAMP, entrega_confirmada_por = $2::uuid, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'FINALIZADA' AND entrega_confirmada_en IS NULL
     RETURNING ${COLUMNAS}`,
    [id, actorId ?? null]
  );
  return result.rows[0] ?? null;
}

// Bloque 3B: UPDATE condicional — ADMIN solo puede reasignar mientras la orden NO esté en un estado
// terminal (FINALIZADA/CERRADA/CANCELADA, decide el service). 0 filas = no existe o estado terminal
// (el service distingue leyendo la fila después); `responsable_id` no cambia en ese caso.
export async function updateResponsable(id: string, responsableId: string, estadosBloqueados: string[]): Promise<Orden | null> {
  const result = await pool.query<Orden>(
    `UPDATE ordenes
     SET responsable_id = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND NOT (estado = ANY($3::varchar[]))
     RETURNING ${COLUMNAS}`,
    [id, responsableId, estadosBloqueados]
  );
  return result.rows[0] ?? null;
}

// Bloque 3B: reprogramación de la fecha PROGRAMADA de entrega (`fecha_entrega`; ver comentario de
// V9 — este campo ya representaba "fecha programada/comprometida", distinta de
// `entrega_confirmada_en`, que es la fecha REAL). UPDATE condicional: bloqueado en estados
// terminales (CERRADA/CANCELADA) y una vez que la entrega real ya fue confirmada (no tiene sentido
// reprogramar una entrega que ya ocurrió). El CHECK existente `chk_ordenes_fechas` (fecha_entrega >=
// fecha_inicio) sigue aplicando tal cual — una violación se traduce en el service a un error de
// dominio específico (no se relaja ni se toca el CHECK).
export async function updateFechaEntrega(
  id: string,
  fechaEntrega: string,
  estadosBloqueados: string[]
): Promise<Orden | null> {
  const result = await pool.query<Orden>(
    `UPDATE ordenes
     SET fecha_entrega = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND NOT (estado = ANY($3::varchar[])) AND entrega_confirmada_en IS NULL
     RETURNING ${COLUMNAS}`,
    [id, fechaEntrega, estadosBloqueados]
  );
  return result.rows[0] ?? null;
}

// Bloque 2A (chat técnico): datos mínimos de la orden asociada a una solicitud,
// resueltos por la relación existente solicitudes <- cotizaciones.solicitud_id
// <- ordenes.cotizacion_id. Solo lectura; no se expone nada más que lo que
// necesita la autorización contextual del chat. Una solicitud tiene como
// máximo una orden (UNIQUE cotizacion_id + una sola cotización ACEPTADA).
export interface OrdenContextoChat {
  id: string;
  estado: string;
  responsable_id: string | null;
}

export async function findContextoChatPorSolicitud(solicitudId: string): Promise<OrdenContextoChat | null> {
  const result = await pool.query<OrdenContextoChat>(
    `SELECT o.id, o.estado, o.responsable_id
     FROM ordenes o
     JOIN cotizaciones c ON c.id = o.cotizacion_id
     WHERE c.solicitud_id = $1
     ORDER BY o.creado_en DESC
     LIMIT 1`,
    [solicitudId]
  );
  return result.rows[0] ?? null;
}
