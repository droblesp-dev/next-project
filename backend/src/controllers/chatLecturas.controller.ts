import type { Request, Response } from 'express';
import { SinAccesoChatError, SolicitudNoEncontradaError } from '../services/solicitudMensajes.service.js';
import { obtenerPendientes, marcarLeido, MensajeNoValidoError } from '../services/chatLecturas.service.js';

// Contadores y lectura del chat (#7). La autorización real vive en el service.
export async function pendientesController(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }
  try {
    res.status(200).json(await obtenerPendientes({ id: req.user.sub, rol: req.user.rol }));
  } catch (error) {
    if (error instanceof SinAccesoChatError) {
      res.status(403).json({ message: 'No autorizado.' });
      return;
    }
    throw error;
  }
}

export async function marcarLeidoController(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }
  const { hasta_id } = (req.body ?? {}) as { hasta_id?: unknown };
  try {
    res.status(200).json(await marcarLeido(req.params.id, { id: req.user.sub, rol: req.user.rol }, hasta_id));
  } catch (error) {
    if (error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Solicitud no encontrada.' });
      return;
    }
    if (error instanceof SinAccesoChatError) {
      res.status(403).json({ message: 'No autorizado.' });
      return;
    }
    if (error instanceof MensajeNoValidoError) {
      res.status(400).json({ message: 'hasta_id debe ser un mensaje visible de esta conversación.' });
      return;
    }
    throw error;
  }
}
