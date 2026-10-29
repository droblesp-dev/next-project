import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

// Ejecutor de consultas: el pool o un cliente dentro de una transacción (para comprobar y bloquear en el envío).
type Ejecutor = Pick<Pool | PoolClient, 'query'>;

export type OrigenParticipante = 'PRIMER_MENSAJE' | 'INCORPORADO' | 'RECLAMO';

export interface ParticipanteActivo {
  usuario_id: string;
  nombre: string;
  rol: string;
  origen: OrigenParticipante;
  agregado_en: string;
}

// Un participante cuenta como activo para el chat solo si su fila no está retirada, el usuario está activo y su rol
// vigente es COMERCIAL u OPERATIVO. Si alguien se desactiva o cambia de rol, su fila queda inerte sin perder historia.
const JOIN_VIGENTE = `
  JOIN usuarios u ON u.id = p.usuario_id AND u.activo = TRUE
  JOIN roles r ON r.id = u.rol_id AND r.nombre IN ('COMERCIAL', 'OPERATIVO')`;

// `bloquear` (solo dentro de una transacción): bloquea la fila en modo compartido para que un retiro simultáneo espere.
export async function esParticipanteActivo(
  solicitudId: string,
  usuarioId: string,
  ejecutor: Ejecutor = pool,
  bloquear = false
): Promise<boolean> {
  const result = await ejecutor.query(
    `SELECT 1 FROM solicitud_mensajes_participantes p
     WHERE p.solicitud_id = $1 AND p.usuario_id = $2 AND p.retirado_en IS NULL${bloquear ? ' FOR SHARE' : ''}`,
    [solicitudId, usuarioId]
  );
  return (result.rowCount ?? 0) > 0;
}

// «Huérfano»: no hay ningún COMERCIAL participante vigente en la solicitud.
export async function hayComercialParticipante(solicitudId: string, ejecutor: Ejecutor = pool): Promise<boolean> {
  const result = await ejecutor.query(
    `SELECT 1 FROM solicitud_mensajes_participantes p
     ${JOIN_VIGENTE}
     WHERE p.solicitud_id = $1 AND p.retirado_en IS NULL AND r.nombre = 'COMERCIAL'
     LIMIT 1`,
    [solicitudId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listarActivos(solicitudId: string): Promise<ParticipanteActivo[]> {
  const result = await pool.query<ParticipanteActivo>(
    `SELECT p.usuario_id, u.nombre, r.nombre AS rol, p.origen, p.agregado_en
     FROM solicitud_mensajes_participantes p
     ${JOIN_VIGENTE}
     WHERE p.solicitud_id = $1 AND p.retirado_en IS NULL
     ORDER BY p.agregado_en ASC, p.id ASC`,
    [solicitudId]
  );
  return result.rows;
}

// Idempotente: si ya hay una fila activa del usuario devuelve false y no cambia nada.
export async function insertar(
  data: {
    solicitudId: string;
    usuarioId: string;
    agregadoPor: string;
    origen: OrigenParticipante;
  },
  ejecutor: Ejecutor = pool
): Promise<boolean> {
  const result = await ejecutor.query(
    `INSERT INTO solicitud_mensajes_participantes (solicitud_id, usuario_id, agregado_por, origen)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (solicitud_id, usuario_id) WHERE retirado_en IS NULL DO NOTHING`,
    [data.solicitudId, data.usuarioId, data.agregadoPor, data.origen]
  );
  return (result.rowCount ?? 0) > 0;
}

export type ResultadoRetiro = 'RETIRADO' | 'NO_ERA_PARTICIPANTE' | 'ULTIMO_PARTICIPANTE';

// Retira (sin borrar) a un participante. No permite dejar el hilo sin participantes: las filas activas de la solicitud
// se bloquean mientras se cuenta, de modo que dos retiros simultáneos no puedan vaciar el hilo.
export async function retirar(data: { solicitudId: string; usuarioId: string; retiradoPor: string }): Promise<ResultadoRetiro> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const activos = await client.query<{ usuario_id: string }>(
      `SELECT usuario_id FROM solicitud_mensajes_participantes
       WHERE solicitud_id = $1 AND retirado_en IS NULL FOR UPDATE`,
      [data.solicitudId]
    );
    if (!activos.rows.some((f) => f.usuario_id === data.usuarioId)) {
      await client.query('ROLLBACK');
      return 'NO_ERA_PARTICIPANTE';
    }
    if (activos.rows.length <= 1) {
      await client.query('ROLLBACK');
      return 'ULTIMO_PARTICIPANTE';
    }
    await client.query(
      `UPDATE solicitud_mensajes_participantes
       SET retirado_por = $3, retirado_en = CURRENT_TIMESTAMP
       WHERE solicitud_id = $1 AND usuario_id = $2 AND retirado_en IS NULL`,
      [data.solicitudId, data.usuarioId, data.retiradoPor]
    );
    await client.query('COMMIT');
    return 'RETIRADO';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
