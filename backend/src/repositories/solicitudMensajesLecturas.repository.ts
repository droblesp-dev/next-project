import { pool } from '../config/db.js';

export interface PendientesSolicitud {
  solicitud_id: string;
  pendientes: number;
}

export interface OpcionesPendientes {
  // Mensajes anteriores a esta fecha no tienen estado de lectura: ni leídos ni pendientes.
  desde: Date;
  // En solicitudes sin orden: true = el acceso sigue abierto a COMERCIAL/OPERATIVO (modo OFF/SOMBRA o sin tabla de
  // participantes); false = solo cuentan los hilos donde el usuario es participante vigente (modo ESTRICTO).
  accesoAbiertoSinOrden: boolean;
}

// Pendientes del usuario por solicitud, en UNA consulta agrupada (sin N+1).
//  - Solo mensajes del ROL CONTRARIO (COMERCIAL cuenta los de OPERATIVO y viceversa): los propios, los de su mismo rol
//    y todas las respuestas de NexIA quedan fuera, de modo que ninguna respuesta privada puede revelarse en un contador.
//  - Solo posteriores a la fecha de corte y al marcador propio del usuario, comparando por (creado_en, id).
//  - Solo en hilos donde el usuario está autorizado AHORA: con orden, COMERCIAL siempre y OPERATIVO si es el
//    responsable vigente; sin orden, según el modo de participantes.
//  - COMERCIAL (C3): además, solo en hilos donde creó una cotización de la solicitud o escribió algún mensaje.
export async function contarPendientes(
  usuarioId: string,
  rolUsuario: 'COMERCIAL' | 'OPERATIVO',
  opciones: OpcionesPendientes
): Promise<PendientesSolicitud[]> {
  const rolContrario = rolUsuario === 'COMERCIAL' ? 'OPERATIVO' : 'COMERCIAL';
  const autorizadoSinOrden = opciones.accesoAbiertoSinOrden
    ? 'TRUE'
    : `EXISTS (
         SELECT 1 FROM solicitud_mensajes_participantes p
         WHERE p.solicitud_id = c.solicitud_id AND p.usuario_id = $1 AND p.retirado_en IS NULL
       )`;

  // C3 (solo COMERCIAL): el contador se enciende únicamente en los hilos donde el usuario CREÓ una cotización de la
  // solicitud o ESCRIBIÓ algún mensaje. No cambia el acceso: COMERCIAL puede abrir cualquier conversación autorizada, solo
  // se evita que cada COMERCIAL vea un contador por todas las órdenes del sistema. OPERATIVO no se ve afectado.
  const propiedadComercial = `(
         EXISTS (SELECT 1 FROM cotizaciones cq WHERE cq.solicitud_id = c.solicitud_id AND cq.creado_por = $1)
         OR EXISTS (SELECT 1 FROM solicitud_mensajes mi WHERE mi.solicitud_id = c.solicitud_id AND mi.autor_id = $1)
       )`;

  const result = await pool.query<PendientesSolicitud>(
    `WITH candidatas AS (
       SELECT m.solicitud_id, COUNT(*)::int AS pendientes
       FROM solicitud_mensajes m
       LEFT JOIN solicitud_mensajes_lecturas l ON l.usuario_id = $1 AND l.solicitud_id = m.solicitud_id
       WHERE m.autor_tipo = $2
         AND m.autor_id IS DISTINCT FROM $1
         AND m.creado_en >= $3
         AND (l.solicitud_id IS NULL OR (m.creado_en, m.id) > (l.ultimo_leido_en, l.ultimo_leido_id))
       GROUP BY m.solicitud_id
     )
     SELECT c.solicitud_id, c.pendientes
     FROM candidatas c
     LEFT JOIN LATERAL (
       SELECT o.id, o.responsable_id
       FROM ordenes o
       JOIN cotizaciones co ON co.id = o.cotizacion_id
       WHERE co.solicitud_id = c.solicitud_id
       ORDER BY o.creado_en DESC
       LIMIT 1
     ) ord ON TRUE
     WHERE ((ord.id IS NOT NULL AND ($4 = 'COMERCIAL' OR ord.responsable_id = $1))
        OR (ord.id IS NULL AND ${autorizadoSinOrden}))
       AND ($4 <> 'COMERCIAL' OR ${propiedadComercial})
     ORDER BY c.solicitud_id`,
    [usuarioId, rolContrario, opciones.desde, rolUsuario]
  );
  return result.rows;
}

// Un usuario solo puede marcar como leído un mensaje que existe en esa solicitud y que puede ver (compartido, o una
// respuesta de NexIA dirigida a él). `destinatarioExiste` decide si las respuestas de NexIA pueden atribuirse.
export async function existeMensajeVisible(
  solicitudId: string,
  mensajeId: string,
  usuarioId: string,
  destinatarioExiste: boolean
): Promise<boolean> {
  const visible = destinatarioExiste ? `(m.autor_tipo <> 'NEXIA' OR m.destinatario_id = $3)` : `m.autor_tipo <> 'NEXIA'`;
  const result = await pool.query(
    `SELECT 1 FROM solicitud_mensajes m WHERE m.id = $1 AND m.solicitud_id = $2 AND ${visible}`,
    destinatarioExiste ? [mensajeId, solicitudId, usuarioId] : [mensajeId, solicitudId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Registra el marcador: solo avanza. Si llega una solicitud con un marcador anterior o igual al guardado (por ejemplo
// dos pestañas del mismo usuario fuera de orden), no se modifica nada. El `creado_en` del marcador se copia en la
// propia sentencia desde el mensaje (sin pasarlo por JavaScript, cuyas fechas pierden los microsegundos de PostgreSQL).
export async function avanzarMarcador(usuarioId: string, solicitudId: string, mensajeId: string): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO solicitud_mensajes_lecturas AS l (usuario_id, solicitud_id, ultimo_leido_id, ultimo_leido_en)
     SELECT $1, m.solicitud_id, m.id, m.creado_en FROM solicitud_mensajes m
     WHERE m.id = $3 AND m.solicitud_id = $2
     ON CONFLICT (usuario_id, solicitud_id) DO UPDATE
       SET ultimo_leido_id = EXCLUDED.ultimo_leido_id,
           ultimo_leido_en = EXCLUDED.ultimo_leido_en,
           actualizado_en  = CURRENT_TIMESTAMP
       WHERE (EXCLUDED.ultimo_leido_en, EXCLUDED.ultimo_leido_id) > (l.ultimo_leido_en, l.ultimo_leido_id)`,
    [usuarioId, solicitudId, mensajeId]
  );
  return (result.rowCount ?? 0) > 0;
}
