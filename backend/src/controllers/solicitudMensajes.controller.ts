import type { Request, Response } from 'express';
import {
  listarMensajes,
  crearMensaje,
  SolicitudNoEncontradaError,
  ContenidoInvalidoError,
} from '../services/solicitudMensajes.service.js';

export async function listarMensajesController(req: Request, res: Response): Promise<void> {
  try {
    const mensajes = await listarMensajes(req.params.id);
    res.status(200).json({ mensajes });
  } catch (error) {
    if (error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Solicitud no encontrada.' });
      return;
    }
    throw error;
  }
}

// `autor_id`/`autor_tipo` provienen exclusivamente de `req.user` (JWT) —
// nunca del body. La ruta ya exige requireRole('COMERCIAL','OPERATIVO'),
// por lo que `req.user.rol` solo puede ser uno de esos dos valores aquí.
export async function crearMensajeController(req: Request, res: Response): Promise<void> {
  const { contenido } = (req.body ?? {}) as { contenido?: unknown };

  if (typeof contenido !== 'string' || !contenido.trim()) {
    res.status(400).json({ message: 'contenido es requerido.' });
    return;
  }

  const autorId = req.user?.sub;
  const autorTipo = req.user?.rol as 'COMERCIAL' | 'OPERATIVO' | undefined;
  if (!autorId || !autorTipo) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    const resultado = await crearMensaje(req.params.id, autorId, autorTipo, contenido);
    res.status(201).json({ mensaje: resultado.mensaje, respuesta_nexia: resultado.respuestaNexia });
  } catch (error) {
    if (error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Solicitud no encontrada.' });
      return;
    }
    if (error instanceof ContenidoInvalidoError) {
      res.status(400).json({ message: 'contenido no puede estar vacío.' });
      return;
    }
    throw error;
  }
}
