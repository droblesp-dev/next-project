import type { Request, Response } from 'express';
import {
  listarAnalisis,
  obtenerAnalisis,
  generarAnalisis,
  marcarRevisado,
  SolicitudNoEncontradaError,
  SolicitudNoEnRevisionError,
  AnalisisNoEncontradoError,
  AnalisisNoCompletadoError,
} from '../services/analisisIa.service.js';

export async function listarController(req: Request, res: Response): Promise<void> {
  const solicitudId = typeof req.query.solicitud_id === 'string' ? req.query.solicitud_id : undefined;
  const analisis = await listarAnalisis(solicitudId);
  res.status(200).json({ analisis });
}

export async function obtenerController(req: Request, res: Response): Promise<void> {
  const analisis = await obtenerAnalisis(req.params.id);
  if (!analisis) {
    res.status(404).json({ message: 'Análisis no encontrado.' });
    return;
  }
  res.status(200).json({ analisis });
}

export async function crearController(req: Request, res: Response): Promise<void> {
  const { solicitud_id } = (req.body ?? {}) as { solicitud_id?: unknown };

  if (typeof solicitud_id !== 'string' || !solicitud_id.trim()) {
    res.status(400).json({ message: 'solicitud_id es requerido.' });
    return;
  }

  try {
    const analisis = await generarAnalisis(solicitud_id.trim());
    res.status(201).json({ analisis });
  } catch (error) {
    if (error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Solicitud no encontrada.' });
      return;
    }
    if (error instanceof SolicitudNoEnRevisionError) {
      res.status(409).json({ message: 'La solicitud no está en estado EN_REVISION.' });
      return;
    }
    throw error;
  }
}

export async function marcarRevisadoController(req: Request, res: Response): Promise<void> {
  const revisadoPor = req.user?.sub;
  if (!revisadoPor) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    const analisis = await marcarRevisado(req.params.id, revisadoPor);
    res.status(200).json({ analisis });
  } catch (error) {
    if (error instanceof AnalisisNoEncontradoError) {
      res.status(404).json({ message: 'Análisis no encontrado.' });
      return;
    }
    if (error instanceof AnalisisNoCompletadoError) {
      res.status(409).json({ message: 'Solo un análisis COMPLETADO puede marcarse como revisado.' });
      return;
    }
    throw error;
  }
}
