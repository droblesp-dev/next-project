import { pool } from '../config/db.js';

export interface SolicitudMensaje {
  id: string;
  solicitud_id: string;
  autor_id: string | null;
  autor_tipo: string;
  contenido: string;
  creado_en: string;
}

const COLUMNAS = 'id, solicitud_id, autor_id, autor_tipo, contenido, creado_en';

export async function listarPorSolicitud(solicitudId: string): Promise<SolicitudMensaje[]> {
  const result = await pool.query<SolicitudMensaje>(
    `SELECT ${COLUMNAS} FROM solicitud_mensajes WHERE solicitud_id = $1 ORDER BY creado_en ASC`,
    [solicitudId]
  );
  return result.rows;
}

export async function crear(data: {
  solicitudId: string;
  autorId: string | null;
  autorTipo: string;
  contenido: string;
}): Promise<SolicitudMensaje> {
  const result = await pool.query<SolicitudMensaje>(
    `INSERT INTO solicitud_mensajes (id, solicitud_id, autor_id, autor_tipo, contenido)
     VALUES (gen_random_uuid(), $1, $2, $3, $4)
     RETURNING ${COLUMNAS}`,
    [data.solicitudId, data.autorId, data.autorTipo, data.contenido]
  );
  return result.rows[0];
}

// Últimos N mensajes en orden cronológico ascendente — único punto de
// lectura usado para construir el contexto que se envía a NexIA. Nunca
// se usa para servir la lista completa al frontend (eso es
// listarPorSolicitud, sin límite).
export async function obtenerRecientes(solicitudId: string, limite: number): Promise<SolicitudMensaje[]> {
  const result = await pool.query<SolicitudMensaje>(
    `SELECT ${COLUMNAS} FROM (
       SELECT ${COLUMNAS} FROM solicitud_mensajes WHERE solicitud_id = $1 ORDER BY creado_en DESC LIMIT $2
     ) recientes
     ORDER BY creado_en ASC`,
    [solicitudId, limite]
  );
  return result.rows;
}
