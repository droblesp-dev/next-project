import * as lecturasRepo from '../repositories/solicitudMensajesLecturas.repository.js';
import { obtenerEsquemaChat } from '../repositories/chatEsquema.js';
import { env } from '../config/env.js';
import { resolverContextoChat, SinAccesoChatError, type UsuarioChat } from './solicitudMensajes.service.js';

// Contadores de mensajes pendientes y marcadores de lectura por usuario (#7).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MensajeNoValidoError extends Error {}

export interface ResultadoPendientes {
  // false = contadores inactivos (sin fecha de corte configurada o sin la tabla de lecturas en la base).
  activo: boolean;
  total: number;
  por_solicitud: Array<{ solicitud_id: string; pendientes: number }>;
}

function rolChat(usuario: UsuarioChat): 'COMERCIAL' | 'OPERATIVO' {
  if (usuario.rol !== 'COMERCIAL' && usuario.rol !== 'OPERATIVO') {
    throw new SinAccesoChatError();
  }
  return usuario.rol;
}

async function accesoAbiertoSinOrden(): Promise<boolean> {
  const esquema = await obtenerEsquemaChat();
  return env.chat.participantesModo !== 'ESTRICTO' || !esquema.participantes;
}

export async function obtenerPendientes(usuario: UsuarioChat): Promise<ResultadoPendientes> {
  const rol = rolChat(usuario);
  const esquema = await obtenerEsquemaChat();
  const desde = env.chat.pendientesDesde;
  if (!desde || !esquema.lecturas) {
    return { activo: false, total: 0, por_solicitud: [] };
  }
  const filas = await lecturasRepo.contarPendientes(usuario.id, rol, {
    desde,
    accesoAbiertoSinOrden: await accesoAbiertoSinOrden(),
  });
  const porSolicitud = filas.filter((f) => f.pendientes > 0);
  return { activo: true, total: porSolicitud.reduce((n, f) => n + f.pendientes, 0), por_solicitud: porSolicitud };
}

export interface ResultadoMarcado {
  activo: boolean;
  avanzo: boolean;
  pendientes: number;
}

// Marca como leído hasta `hastaId` (el último mensaje realmente mostrado al usuario). El marcador solo avanza y
// el mensaje debe existir en la solicitud y ser visible para el usuario; la autorización es la misma del chat.
export async function marcarLeido(solicitudId: string, usuario: UsuarioChat, hastaId: unknown): Promise<ResultadoMarcado> {
  rolChat(usuario);
  await resolverContextoChat(solicitudId, usuario, 'MARCAR_LEIDO');
  if (typeof hastaId !== 'string' || !UUID_RE.test(hastaId)) {
    throw new MensajeNoValidoError();
  }
  const esquema = await obtenerEsquemaChat();
  if (!esquema.lecturas || !env.chat.pendientesDesde) {
    return { activo: false, avanzo: false, pendientes: 0 };
  }
  if (!(await lecturasRepo.existeMensajeVisible(solicitudId, hastaId, usuario.id, esquema.destinatario))) {
    throw new MensajeNoValidoError();
  }
  const avanzo = await lecturasRepo.avanzarMarcador(usuario.id, solicitudId, hastaId);
  const { por_solicitud } = await obtenerPendientes(usuario);
  return { activo: true, avanzo, pendientes: por_solicitud.find((f) => f.solicitud_id === solicitudId)?.pendientes ?? 0 };
}
