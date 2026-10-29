import * as participantesRepo from '../repositories/solicitudMensajesParticipantes.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import * as ordenesRepo from '../repositories/ordenes.repository.js';
import { findByIdWithRol } from '../repositories/usuarios.repository.js';
import { obtenerEsquemaChat } from '../repositories/chatEsquema.js';
import { env } from '../config/env.js';
import { registrarEventoSeguridad } from './securityLog.js';
import { SinAccesoChatError, SolicitudNoEncontradaError, type UsuarioChat } from './solicitudMensajes.service.js';

// Gestión de participantes del chat en solicitudes SIN orden (#7). Con orden no hay participantes explícitos: el acceso
// se deriva del responsable de la orden. ADMIN no participa ni gestiona participantes (no accede al chat).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ParticipanteNoValidoError extends Error {}
export class ConversacionDeOrdenError extends Error {}
export class ParticipantesInactivosError extends Error {}
export class HiloConComercialError extends Error {}
export class UltimoParticipanteError extends Error {}

export type RegimenChat = 'ORDEN' | 'PARTICIPANTES' | 'LIBRE';

export interface VistaParticipantes {
  regimen: RegimenChat;
  modo: 'OFF' | 'SOMBRA' | 'ESTRICTO';
  participa: boolean;
  reclamable: boolean;
  puede_gestionar: boolean;
  participantes: Array<{ usuario_id: string; nombre: string; rol: string }>;
  responsable: { id: string; nombre: string } | null;
}

async function contexto(solicitudId: string, usuario: UsuarioChat) {
  if (!UUID_RE.test(solicitudId)) {
    throw new SolicitudNoEncontradaError();
  }
  const solicitud = await solicitudesRepo.findById(solicitudId);
  if (!solicitud) {
    throw new SolicitudNoEncontradaError();
  }
  if (usuario.rol !== 'COMERCIAL' && usuario.rol !== 'OPERATIVO') {
    throw new SinAccesoChatError();
  }
  const orden = await ordenesRepo.findContextoChatPorSolicitud(solicitudId);
  const esquema = await obtenerEsquemaChat();
  const activo = env.chat.participantesModo !== 'OFF' && esquema.participantes;
  return { orden, activo };
}

export async function verParticipantes(solicitudId: string, usuario: UsuarioChat): Promise<VistaParticipantes> {
  const { orden, activo } = await contexto(solicitudId, usuario);
  const modo = env.chat.participantesModo;

  if (orden) {
    if (usuario.rol === 'OPERATIVO' && orden.responsable_id !== usuario.id) {
      throw new SinAccesoChatError();
    }
    const responsable = orden.responsable_id ? await findByIdWithRol(orden.responsable_id) : null;
    return {
      regimen: 'ORDEN',
      modo,
      participa: true,
      reclamable: false,
      puede_gestionar: false,
      participantes: [],
      responsable: responsable ? { id: responsable.id, nombre: responsable.nombre } : null,
    };
  }

  if (!activo) {
    return { regimen: 'LIBRE', modo, participa: true, reclamable: false, puede_gestionar: false, participantes: [], responsable: null };
  }

  const participa = await participantesRepo.esParticipanteActivo(solicitudId, usuario.id);
  if (!participa) {
    // Quien no participa no ve quiénes son los participantes: solo si puede reclamar el hilo.
    const reclamable = usuario.rol === 'COMERCIAL' && !(await participantesRepo.hayComercialParticipante(solicitudId));
    return { regimen: 'PARTICIPANTES', modo, participa: false, reclamable, puede_gestionar: false, participantes: [], responsable: null };
  }
  const lista = await participantesRepo.listarActivos(solicitudId);
  return {
    regimen: 'PARTICIPANTES',
    modo,
    participa: true,
    reclamable: false,
    puede_gestionar: usuario.rol === 'COMERCIAL',
    participantes: lista.map((p) => ({ usuario_id: p.usuario_id, nombre: p.nombre, rol: p.rol })),
    responsable: null,
  };
}

async function exigirGestor(solicitudId: string, actor: UsuarioChat): Promise<void> {
  const { orden, activo } = await contexto(solicitudId, actor);
  if (orden) {
    throw new ConversacionDeOrdenError();
  }
  if (!activo) {
    throw new ParticipantesInactivosError();
  }
  if (actor.rol !== 'COMERCIAL' || !(await participantesRepo.esParticipanteActivo(solicitudId, actor.id))) {
    throw new SinAccesoChatError();
  }
}

export async function incorporarParticipante(solicitudId: string, actor: UsuarioChat, usuarioId: unknown): Promise<{ incorporado: boolean }> {
  await exigirGestor(solicitudId, actor);
  if (typeof usuarioId !== 'string' || !UUID_RE.test(usuarioId)) {
    throw new ParticipanteNoValidoError();
  }
  const destino = await findByIdWithRol(usuarioId);
  if (!destino || !destino.activo || (destino.rol !== 'COMERCIAL' && destino.rol !== 'OPERATIVO')) {
    throw new ParticipanteNoValidoError();
  }
  const incorporado = await participantesRepo.insertar({
    solicitudId,
    usuarioId,
    agregadoPor: actor.id,
    origen: 'INCORPORADO',
  });
  if (incorporado) {
    registrarEventoSeguridad('CHAT_PARTICIPANTE_INCORPORADO', { actorId: actor.id, usuarioId, solicitudId, origen: 'INCORPORADO' });
  }
  return { incorporado };
}

export async function retirarParticipante(solicitudId: string, actor: UsuarioChat, usuarioId: string): Promise<void> {
  await exigirGestor(solicitudId, actor);
  if (!UUID_RE.test(usuarioId)) {
    throw new ParticipanteNoValidoError();
  }
  const resultado = await participantesRepo.retirar({ solicitudId, usuarioId, retiradoPor: actor.id });
  if (resultado === 'NO_ERA_PARTICIPANTE') {
    throw new ParticipanteNoValidoError();
  }
  if (resultado === 'ULTIMO_PARTICIPANTE') {
    throw new UltimoParticipanteError();
  }
  registrarEventoSeguridad('CHAT_PARTICIPANTE_RETIRADO', { actorId: actor.id, usuarioId, solicitudId });
}

// Reclamo: un COMERCIAL puede tomar un hilo sin orden que no tiene ningún COMERCIAL participante vigente. No muestra
// contenido antes de reclamar y no concede acceso a nadie más. Es idempotente para quien ya participa.
export async function reclamarHilo(solicitudId: string, actor: UsuarioChat): Promise<{ reclamado: boolean }> {
  const { orden, activo } = await contexto(solicitudId, actor);
  if (orden) {
    throw new ConversacionDeOrdenError();
  }
  if (!activo) {
    throw new ParticipantesInactivosError();
  }
  if (actor.rol !== 'COMERCIAL') {
    throw new SinAccesoChatError();
  }
  if (await participantesRepo.esParticipanteActivo(solicitudId, actor.id)) {
    return { reclamado: false };
  }
  if (await participantesRepo.hayComercialParticipante(solicitudId)) {
    throw new HiloConComercialError();
  }
  const reclamado = await participantesRepo.insertar({
    solicitudId,
    usuarioId: actor.id,
    agregadoPor: actor.id,
    origen: 'RECLAMO',
  });
  if (reclamado) {
    registrarEventoSeguridad('CHAT_HILO_RECLAMADO', { usuarioId: actor.id, solicitudId });
  }
  return { reclamado };
}
