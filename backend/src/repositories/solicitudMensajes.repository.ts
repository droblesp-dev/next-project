import { pool } from '../config/db.js';
import { obtenerEsquemaChat } from './chatEsquema.js';
import * as participantesRepo from './solicitudMensajesParticipantes.repository.js';

export interface SolicitudMensaje {
  id: string;
  solicitud_id: string;
  autor_id: string | null;
  autor_tipo: string;
  contenido: string;
  creado_en: string;
  // Solo las respuestas de NexIA tienen destinatario (V25). Es NULL en los mensajes de personas y en las respuestas
  // históricas de NexIA, que por eso no son visibles para nadie.
  destinatario_id: string | null;
}

// Texto que queda en `contenido` de una respuesta privada de NexIA. El texto real vive en `contenido_privado`, que solo
// leen las consultas de este módulo para su destinatario: una versión anterior del backend (que lee `contenido`)
// nunca puede mostrar el texto privado, aunque lea la fila. Privacidad por construcción, no por filtro.
export const CONTENIDO_MARCADOR_RESPUESTA_PRIVADA = 'Respuesta privada de NexIA: solo visible para su destinatario.';

// Privacidad (#8): ÚNICA definición de qué mensajes ve un usuario. La usan el listado, el contexto de NexIA y
// (sin usuario) el contexto de la ficha técnica; ninguna otra consulta lee `solicitud_mensajes` para entregar
// contenido. Un mensaje de persona (COMERCIAL/OPERATIVO) es compartido; una respuesta de NexIA solo es visible
// para su destinatario. Sin las columnas de V25 ninguna respuesta de NexIA puede atribuirse: se ocultan todas.
function columnas(privacidad: boolean, alias = 'm'): string {
  const base = ['id', 'solicitud_id', 'autor_id', 'autor_tipo'].map((c) => `${alias}.${c}`).join(', ');
  const contenido = privacidad
    ? `CASE WHEN ${alias}.autor_tipo = 'NEXIA' AND ${alias}.contenido_privado IS NOT NULL THEN ${alias}.contenido_privado ELSE ${alias}.contenido END AS contenido`
    : `${alias}.contenido AS contenido`;
  const destinatario = privacidad ? `${alias}.destinatario_id` : `NULL::uuid AS destinatario_id`;
  return `${base}, ${contenido}, ${alias}.creado_en, ${destinatario}`;
}

// Fragmento SQL de visibilidad para un usuario (parámetro `$n` = id del usuario).
function visiblePara(privacidad: boolean, parametroUsuario: string, alias = 'm'): string {
  return privacidad
    ? `(${alias}.autor_tipo <> 'NEXIA' OR ${alias}.destinatario_id = ${parametroUsuario})`
    : `${alias}.autor_tipo <> 'NEXIA'`;
}

// Mensajes que `usuarioId` puede ver en la solicitud, en orden cronológico estable (creado_en, id).
export async function listarVisiblesPara(solicitudId: string, usuarioId: string): Promise<SolicitudMensaje[]> {
  const { destinatario } = await obtenerEsquemaChat();
  const result = await pool.query<SolicitudMensaje>(
    `SELECT ${columnas(destinatario)} FROM solicitud_mensajes m
     WHERE m.solicitud_id = $1 AND ${visiblePara(destinatario, '$2')}
     ORDER BY m.creado_en ASC, m.id ASC`,
    destinatario ? [solicitudId, usuarioId] : [solicitudId]
  );
  return result.rows;
}

// Mensaje de una respuesta de NexIA. Si el esquema aún no puede guardarla de forma privada (sin las columnas de V25) se
// guarda como antes —oculta para todos por el filtro—; con el esquema completo el texto va a `contenido_privado`.
export async function crearRespuestaNexia(data: {
  solicitudId: string;
  contenido: string;
  destinatarioId: string;
}): Promise<SolicitudMensaje> {
  const { destinatario } = await obtenerEsquemaChat();
  if (destinatario) {
    const result = await pool.query<SolicitudMensaje>(
      `INSERT INTO solicitud_mensajes (id, solicitud_id, autor_id, autor_tipo, contenido, destinatario_id, contenido_privado)
       VALUES (gen_random_uuid(), $1, NULL, 'NEXIA', $2, $3, $4)
       RETURNING ${columnas(true, 'solicitud_mensajes')}`,
      [data.solicitudId, CONTENIDO_MARCADOR_RESPUESTA_PRIVADA, data.destinatarioId, data.contenido]
    );
    return result.rows[0];
  }
  const result = await pool.query<SolicitudMensaje>(
    `INSERT INTO solicitud_mensajes (id, solicitud_id, autor_id, autor_tipo, contenido)
     VALUES (gen_random_uuid(), $1, NULL, 'NEXIA', $2)
     RETURNING ${columnas(false, 'solicitud_mensajes')}`,
    [data.solicitudId, data.contenido]
  );
  return result.rows[0];
}

export interface PoliticaEnvio {
  usuarioId: string;
  rol: 'COMERCIAL' | 'OPERATIVO';
  estadosOrdenSoloLectura: string[];
  // Participantes en solicitudes sin orden: NO (sin tabla o modo OFF), SOMBRA (no deniega) o ESTRICTO (exige participar).
  participantes: 'NO' | 'SOMBRA' | 'ESTRICTO';
}

export type ResultadoEnvio =
  | { ok: true; mensaje: SolicitudMensaje; participanteNuevo: boolean }
  | { ok: false; motivo: 'SIN_ACCESO' | 'SOLO_LECTURA' };

// Guarda un mensaje de COMERCIAL/OPERATIVO VOLVIENDO A COMPROBAR el acceso dentro de la misma transacción, con las
// filas que lo deciden bloqueadas en modo compartido (usuario, solicitud, orden más reciente y participante). Así:
//   - una reasignación de orden, un cambio de rol, una desactivación, la cancelación de la solicitud o el retiro de un
//     participante que se confirmen antes del bloqueo se ven aquí y el envío se rechaza;
//   - los que llegan durante el envío esperan a que este termine y se aplican después.
// Un usuario que perdió el acceso antes de que su envío tome el bloqueo no puede guardar el mensaje. No se llama a la
// IA dentro de esta transacción.
export async function crearAutorizado(
  data: { solicitudId: string; contenido: string },
  politica: PoliticaEnvio
): Promise<ResultadoEnvio> {
  const { destinatario } = await obtenerEsquemaChat();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const usuario = await client.query<{ activo: boolean; rol: string }>(
      `SELECT u.activo, r.nombre AS rol FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.id = $1 FOR SHARE OF u`,
      [politica.usuarioId]
    );
    if (!usuario.rows[0] || !usuario.rows[0].activo || usuario.rows[0].rol !== politica.rol) {
      await client.query('ROLLBACK');
      return { ok: false, motivo: 'SIN_ACCESO' };
    }

    const solicitud = await client.query<{ estado: string }>(`SELECT estado FROM solicitudes WHERE id = $1 FOR SHARE`, [data.solicitudId]);
    if (!solicitud.rows[0] || solicitud.rows[0].estado === 'CANCELADA') {
      await client.query('ROLLBACK');
      return { ok: false, motivo: 'SOLO_LECTURA' };
    }

    const orden = await client.query<{ estado: string; responsable_id: string | null }>(
      `SELECT o.estado, o.responsable_id FROM ordenes o
       JOIN cotizaciones c ON c.id = o.cotizacion_id
       WHERE c.solicitud_id = $1
       ORDER BY o.creado_en DESC LIMIT 1
       FOR SHARE OF o`,
      [data.solicitudId]
    );

    let participanteNuevo = false;
    if (orden.rows[0]) {
      const o = orden.rows[0];
      if (politica.rol === 'OPERATIVO' && o.responsable_id !== politica.usuarioId) {
        await client.query('ROLLBACK');
        return { ok: false, motivo: 'SIN_ACCESO' };
      }
      if (politica.estadosOrdenSoloLectura.includes(o.estado)) {
        await client.query('ROLLBACK');
        return { ok: false, motivo: 'SOLO_LECTURA' };
      }
    } else if (politica.participantes !== 'NO') {
      const participa = await participantesRepo.esParticipanteActivo(data.solicitudId, politica.usuarioId, client, true);
      if (!participa) {
        // El primer COMERCIAL que escribe en un hilo sin COMERCIAL participante queda como participante.
        const puedeIniciar = politica.rol === 'COMERCIAL' && !(await participantesRepo.hayComercialParticipante(data.solicitudId, client));
        if (puedeIniciar) {
          participanteNuevo = await participantesRepo.insertar(
            { solicitudId: data.solicitudId, usuarioId: politica.usuarioId, agregadoPor: politica.usuarioId, origen: 'PRIMER_MENSAJE' },
            client
          );
        } else if (politica.participantes === 'ESTRICTO') {
          await client.query('ROLLBACK');
          return { ok: false, motivo: 'SIN_ACCESO' };
        }
      }
    }

    const insertado = await client.query<SolicitudMensaje>(
      `INSERT INTO solicitud_mensajes (id, solicitud_id, autor_id, autor_tipo, contenido)
       VALUES (gen_random_uuid(), $1, $2, $3, $4)
       RETURNING ${columnas(destinatario, 'solicitud_mensajes')}`,
      [data.solicitudId, politica.usuarioId, politica.rol, data.contenido]
    );
    await client.query('COMMIT');
    return { ok: true, mensaje: insertado.rows[0], participanteNuevo };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Últimos N mensajes COMPARTIDOS (sin ninguna respuesta de NexIA, histórica o nueva) en orden cronológico. Es el único
// contexto que usa la ficha técnica: no depende de quién la genere (la generación automática no tiene usuario).
export async function obtenerRecientesCompartidos(solicitudId: string, limite: number): Promise<SolicitudMensaje[]> {
  const { destinatario } = await obtenerEsquemaChat();
  const result = await pool.query<SolicitudMensaje>(
    `SELECT * FROM (
       SELECT ${columnas(destinatario)} FROM solicitud_mensajes m
       WHERE m.solicitud_id = $1 AND m.autor_tipo <> 'NEXIA'
       ORDER BY m.creado_en DESC, m.id DESC LIMIT $2
     ) recientes
     ORDER BY recientes.creado_en ASC, recientes.id ASC`,
    [solicitudId, limite]
  );
  return result.rows;
}

// Últimos N mensajes para el contexto de NexIA cuando lo invoca `usuarioId`: los compartidos más SUS propias respuestas
// privadas, nunca las de otros usuarios (ni las históricas sin destinatario).
export async function obtenerRecientesParaUsuario(
  solicitudId: string,
  usuarioId: string,
  limite: number
): Promise<SolicitudMensaje[]> {
  const { destinatario } = await obtenerEsquemaChat();
  const result = await pool.query<SolicitudMensaje>(
    `SELECT * FROM (
       SELECT ${columnas(destinatario)} FROM solicitud_mensajes m
       WHERE m.solicitud_id = $1 AND ${visiblePara(destinatario, '$3')}
       ORDER BY m.creado_en DESC, m.id DESC LIMIT $2
     ) recientes
     ORDER BY recientes.creado_en ASC, recientes.id ASC`,
    destinatario ? [solicitudId, limite, usuarioId] : [solicitudId, limite]
  );
  return result.rows;
}
