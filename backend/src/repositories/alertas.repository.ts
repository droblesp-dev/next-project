import { pool } from '../config/db.js';

export interface Alerta {
  id: string;
  orden_id: string;
  tipo: string;
  condicion: string;
  mensaje: string;
  estado: string;
  creado_en: string;
  leida: boolean;
  leida_en: string | null;
}

const COLUMNAS = 'id, orden_id, tipo, condicion, mensaje, estado, creado_en, leida, leida_en';

// Cálculo bajo demanda (Fase 11, alternativa A autorizada): cada consulta
// evalúa las órdenes reales contra las condiciones y solo inserta las
// alertas que aún no existen. El índice único `ux_alertas_orden_tipo_
// condicion` (ya existente, no se crea ninguno nuevo) es quien impide
// duplicados vía `ON CONFLICT DO NOTHING` — no hay verificación manual
// de existencia previa, la propia base de datos la garantiza.
export async function generarAlertasVencimiento(): Promise<void> {
  await pool.query(
    `INSERT INTO alertas (id, orden_id, tipo, condicion, mensaje)
     SELECT gen_random_uuid(), o.id, 'ENTREGA', 'VENCIDA',
            'Orden ' || o.codigo || ' con fecha de entrega vencida (' || o.fecha_entrega || ').'
     FROM ordenes o
     WHERE o.fecha_entrega IS NOT NULL
       AND o.fecha_entrega < CURRENT_DATE
       AND o.estado NOT IN ('CERRADA', 'CANCELADA')
     ON CONFLICT (orden_id, tipo, condicion) DO NOTHING`
  );

  await pool.query(
    `INSERT INTO alertas (id, orden_id, tipo, condicion, mensaje)
     SELECT gen_random_uuid(), o.id, 'ENTREGA', 'PROXIMA',
            'Orden ' || o.codigo || ' con fecha de entrega próxima (' || o.fecha_entrega || ').'
     FROM ordenes o
     WHERE o.fecha_entrega IS NOT NULL
       AND o.fecha_entrega >= CURRENT_DATE
       AND o.fecha_entrega <= CURRENT_DATE + INTERVAL '3 days'
       AND o.estado NOT IN ('CERRADA', 'CANCELADA')
     ON CONFLICT (orden_id, tipo, condicion) DO NOTHING`
  );
}

// Bloque MVP (ficha técnica): inserción directa (no bajo demanda como
// generarAlertasVencimiento) — se dispara en el momento exacto en que
// NexIA detecta una inconsistencia significativa. Reutiliza el mismo
// índice único `ux_alertas_orden_tipo_condicion` vía ON CONFLICT DO
// NOTHING para no duplicar la alerta si la ficha se regenera. No crea
// ninguna tabla ni columna nueva — `tipo`/`condicion` son VARCHAR libres,
// ya sin CHECK que los restrinja.
export async function crearAlertaFichaTecnica(ordenId: string, mensaje: string): Promise<void> {
  await pool.query(
    `INSERT INTO alertas (id, orden_id, tipo, condicion, mensaje)
     VALUES (gen_random_uuid(), $1, 'FICHA_TECNICA', 'INCONSISTENCIA', $2)
     ON CONFLICT (orden_id, tipo, condicion) DO NOTHING`,
    [ordenId, mensaje]
  );
}

export async function listAll(): Promise<Alerta[]> {
  const result = await pool.query<Alerta>(`SELECT ${COLUMNAS} FROM alertas ORDER BY creado_en DESC`);
  return result.rows;
}

export async function findById(id: string): Promise<Alerta | null> {
  const result = await pool.query<Alerta>(`SELECT ${COLUMNAS} FROM alertas WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function marcarAtendida(id: string): Promise<Alerta | null> {
  const result = await pool.query<Alerta>(
    `UPDATE alertas
     SET leida = true, leida_en = CURRENT_TIMESTAMP, estado = 'ATENDIDA'
     WHERE id = $1
     RETURNING ${COLUMNAS}`,
    [id]
  );
  return result.rows[0] ?? null;
}
