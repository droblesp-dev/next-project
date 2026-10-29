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

// Cálculo bajo demanda (Fase 11, alternativa A autorizada): cada llamada
// evalúa las órdenes reales contra las condiciones y solo inserta las
// alertas que aún no existen. El índice único `ux_alertas_orden_tipo_
// condicion` (ya existente, no se crea ninguno nuevo) es quien impide
// duplicados vía `ON CONFLICT` — no hay verificación manual de existencia
// previa, la propia base de datos la garantiza.
//
// ALERTAS-02 (decisión 8A): ya NO se invoca desde el GET (ver
// alertas.service.ts::listarAlertas) — el único punto de entrada es
// POST /api/alertas/generar (generarController), un proceso explícito e
// interno, sin infraestructura nueva (mismo `pool.query` de siempre).
//
// ALERTAS-02 (corolario técnico de la decisión 6A): antes, `ON CONFLICT DO
// NOTHING` significaba que una alerta ya resuelta como obsoleta
// (`estado = 'CANCELADA'`, ver resolverAlertasEntregaObsoletas) nunca podía
// volver a activarse si la condición real vuelve a aplicarse (ej. se
// reprograma la fecha hacia el pasado otra vez) — el índice único bloquearía
// para siempre cualquier nuevo INSERT para esa (orden_id, tipo, condicion).
// Se cambia a `DO UPDATE ... WHERE alertas.estado = 'CANCELADA'`: solo
// "revive" una alerta que el propio sistema había cancelado por obsoleta: una
// alerta PENDIENTE no se toca (evita reiniciar su creado_en en cada
// generación) y una alerta ATENDIDA (acción humana deliberada) tampoco se
// reabre automáticamente — comportamiento sin cambios respecto al original.
export async function generarAlertasVencimiento(): Promise<void> {
  await pool.query(
    `INSERT INTO alertas (id, orden_id, tipo, condicion, mensaje)
     SELECT gen_random_uuid(), o.id, 'ENTREGA', 'VENCIDA',
            'Orden ' || o.codigo || ' con fecha de entrega vencida (' || o.fecha_entrega || ').'
     FROM ordenes o
     WHERE o.fecha_entrega IS NOT NULL
       AND o.fecha_entrega < CURRENT_DATE
       AND o.estado NOT IN ('CERRADA', 'CANCELADA')
     ON CONFLICT (orden_id, tipo, condicion) DO UPDATE
       SET estado = 'PENDIENTE', mensaje = EXCLUDED.mensaje, creado_en = CURRENT_TIMESTAMP,
           leida = false, leida_en = NULL
       WHERE alertas.estado = 'CANCELADA'`
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
     ON CONFLICT (orden_id, tipo, condicion) DO UPDATE
       SET estado = 'PENDIENTE', mensaje = EXCLUDED.mensaje, creado_en = CURRENT_TIMESTAMP,
           leida = false, leida_en = NULL
       WHERE alertas.estado = 'CANCELADA'`
  );
}

// ALERTAS-02 (decisiones 6A/7A, hallazgo H4): reutiliza el estado `CANCELADA` ya permitido por
// `chk_alertas_estado` desde V0 y nunca usado hasta ahora — ninguna migración, ninguna columna ni
// estado nuevo. Se invoca desde ordenes.service.ts justo después de un cambio real y confirmado en
// la orden (reprogramar fecha, cancelar, cerrar). Solo afecta alertas ENTREGA en PENDIENTE de esa
// orden puntual; nunca toca FICHA_TECNICA (fuera del alcance de 6A/7A) ni una alerta ya ATENDIDA.
//   - Caso A/C (6A): la fecha reprogramada ya no cumple la condición VENCIDA o PROXIMA original.
//   - Caso B (7A): la orden queda CERRADA o CANCELADA (mismo par que ya excluye la generación).
// Preserva historial (UPDATE de estado, nunca DELETE) — puede evaluarse sobre cualquier orden en
// cualquier momento sin efecto si no hay ninguna alerta PENDIENTE que ya no aplique.
export async function resolverAlertasEntregaObsoletas(ordenId: string): Promise<void> {
  await pool.query(
    `UPDATE alertas a
     SET estado = 'CANCELADA'
     FROM ordenes o
     WHERE a.orden_id = o.id
       AND a.orden_id = $1
       AND a.tipo = 'ENTREGA'
       AND a.estado = 'PENDIENTE'
       AND (
         o.estado IN ('CERRADA', 'CANCELADA')
         OR (a.condicion = 'VENCIDA' AND (o.fecha_entrega IS NULL OR o.fecha_entrega >= CURRENT_DATE))
         OR (a.condicion = 'PROXIMA' AND (o.fecha_entrega IS NULL OR o.fecha_entrega < CURRENT_DATE OR o.fecha_entrega > CURRENT_DATE + INTERVAL '3 days'))
       )`,
    [ordenId]
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

// #7: aviso de que una orden fue reasignada a otro OPERATIVO. Reutiliza `alertas` (sin tabla nueva): el nuevo
// responsable la ve por el filtro existente alerta -> orden -> responsable. `condicion` identifica cada evento
// (REASIGNADA-1, REASIGNADA-2…), así reasignar de nuevo, incluso a la misma persona, genera un aviso nuevo; los avisos anteriores aún
// pendientes de esa orden se cancelan para que el siguiente responsable no vea un aviso dirigido a otro. El texto no
// incluye ningún contenido del chat.
export async function crearAlertaReasignacion(ordenId: string, mensaje: string): Promise<void> {
  await pool.query(
    `UPDATE alertas SET estado = 'CANCELADA'
     WHERE orden_id = $1 AND tipo = 'ORDEN_REASIGNADA' AND estado = 'PENDIENTE'`,
    [ordenId]
  );
  await pool.query(
    `INSERT INTO alertas (id, orden_id, tipo, condicion, mensaje)
     SELECT gen_random_uuid(), $1, 'ORDEN_REASIGNADA', 'REASIGNADA-' || (COUNT(*) + 1)::text, $2
     FROM alertas WHERE orden_id = $1 AND tipo = 'ORDEN_REASIGNADA'`,
    [ordenId, mensaje]
  );
}

// ADMIN (decisión 3A): sin ningún filtro, ve todas las alertas del sistema.
export async function listAll(): Promise<Alerta[]> {
  const result = await pool.query<Alerta>(`SELECT ${COLUMNAS} FROM alertas ORDER BY creado_en DESC`);
  return result.rows;
}

// OPERATIVO (decisión 1A): filtro derivado alerta -> orden -> responsable, SIN ninguna columna ni
// tabla nueva (4A) — un simple JOIN. Una alerta de una orden sin responsable (responsable_id IS
// NULL) queda excluida por el propio JOIN con la condición de igualdad (nunca puede coincidir con
// un usuarioId real), sin necesidad de un caso especial.
export async function listPorResponsable(responsableId: string): Promise<Alerta[]> {
  const result = await pool.query<Alerta>(
    `SELECT ${COLUMNAS.split(', ').map((c) => `a.${c}`).join(', ')}
     FROM alertas a
     JOIN ordenes o ON o.id = a.orden_id
     WHERE o.responsable_id = $1
     ORDER BY a.creado_en DESC`,
    [responsableId]
  );
  return result.rows;
}

// COMERCIAL (decisión 2B): filtro por tipo — ver el informe de implementación para la
// justificación de qué tipos se consideran "de su gestión" (ENTREGA, no FICHA_TECNICA).
export async function listPorTipos(tipos: string[]): Promise<Alerta[]> {
  const result = await pool.query<Alerta>(
    `SELECT ${COLUMNAS} FROM alertas WHERE tipo = ANY($1::varchar[]) ORDER BY creado_en DESC`,
    [tipos]
  );
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
