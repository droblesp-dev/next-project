import type { Request, Response } from 'express';
import { SinAccesoChatError, SolicitudNoEncontradaError } from '../services/solicitudMensajes.service.js';
import {
  verParticipantes,
  incorporarParticipante,
  retirarParticipante,
  reclamarHilo,
  ParticipanteNoValidoError,
  ConversacionDeOrdenError,
  ParticipantesInactivosError,
  HiloConComercialError,
  UltimoParticipanteError,
} from '../services/chatParticipantes.service.js';

// Participantes del chat (#7). La autorización real vive en el service; aquí solo se traducen los errores.
function responderError(error: unknown, res: Response): boolean {
  if (error instanceof SolicitudNoEncontradaError) {
    res.status(404).json({ message: 'Solicitud no encontrada.' });
    return true;
  }
  if (error instanceof SinAccesoChatError) {
    res.status(403).json({ message: 'No autorizado.' });
    return true;
  }
  if (error instanceof ParticipanteNoValidoError) {
    res.status(400).json({ message: 'El usuario no es válido o no participa en esta conversación.' });
    return true;
  }
  if (error instanceof ConversacionDeOrdenError) {
    res.status(409).json({ message: 'La conversación de una solicitud con orden se rige por el responsable de la orden.' });
    return true;
  }
  if (error instanceof ParticipantesInactivosError) {
    res.status(409).json({ message: 'La gestión de participantes no está activa.' });
    return true;
  }
  if (error instanceof HiloConComercialError) {
    res.status(403).json({ message: 'La conversación ya tiene un COMERCIAL participante: solicita que te incorporen.' });
    return true;
  }
  if (error instanceof UltimoParticipanteError) {
    res.status(409).json({ message: 'No se puede retirar al último participante de la conversación.' });
    return true;
  }
  return false;
}

export async function verParticipantesController(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }
  try {
    res.status(200).json(await verParticipantes(req.params.id, { id: req.user.sub, rol: req.user.rol }));
  } catch (error) {
    if (!responderError(error, res)) throw error;
  }
}

export async function incorporarParticipanteController(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }
  const { usuario_id } = (req.body ?? {}) as { usuario_id?: unknown };
  try {
    const r = await incorporarParticipante(req.params.id, { id: req.user.sub, rol: req.user.rol }, usuario_id);
    res.status(r.incorporado ? 201 : 200).json(r);
  } catch (error) {
    if (!responderError(error, res)) throw error;
  }
}

export async function retirarParticipanteController(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }
  try {
    await retirarParticipante(req.params.id, { id: req.user.sub, rol: req.user.rol }, req.params.usuarioId);
    res.status(200).json({ retirado: true });
  } catch (error) {
    if (!responderError(error, res)) throw error;
  }
}

export async function reclamarHiloController(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }
  try {
    const r = await reclamarHilo(req.params.id, { id: req.user.sub, rol: req.user.rol });
    res.status(r.reclamado ? 201 : 200).json(r);
  } catch (error) {
    if (!responderError(error, res)) throw error;
  }
}
