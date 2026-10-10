import type { Request, Response } from 'express';
import {
  listarMensajes,
  crearMensaje,
  SolicitudNoEncontradaError,
  ContenidoInvalidoError,
  SinAccesoChatError,
  ChatSoloLecturaError,
} from '../services/solicitudMensajes.service.js';
import { LimiteNexiaError, NEXIA_MAX_INVOCACIONES } from '../services/nexiaRateLimit.service.js';

// Bloque 2A: la autorización contextual (orden asociada, responsable, estados de
// solo lectura) vive en el service. Para acceso horizontal no autorizado se
// responde 403 con un mensaje genérico (sin revelar el responsable ni la orden).
export async function listarMensajesController(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    // `mensajes` se conserva tal cual (compatibilidad); `modo` (Bloque 2B.1) es ayuda de UX.
    const { mensajes, modo } = await listarMensajes(req.params.id, { id: req.user.sub, rol: req.user.rol });
    res.status(200).json({ mensajes, modo });
  } catch (error) {
    if (error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Solicitud no encontrada.' });
      return;
    }
    if (error instanceof SinAccesoChatError) {
      res.status(403).json({ message: 'No autorizado.' });
      return;
    }
    throw error;
  }
}

// `autor_id`/`autor_tipo` provienen exclusivamente de `req.user` (JWT) —
// nunca del body. La ruta ya exige requireRole('COMERCIAL','OPERATIVO'): ADMIN
// solo puede leer (403 al escribir).
export async function crearMensajeController(req: Request, res: Response): Promise<void> {
  const { contenido } = (req.body ?? {}) as { contenido?: unknown };

  if (!req.user) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    const resultado = await crearMensaje(req.params.id, { id: req.user.sub, rol: req.user.rol }, contenido);
    res.status(201).json({ mensaje: resultado.mensaje, respuesta_nexia: resultado.respuestaNexia });
  } catch (error) {
    if (error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Solicitud no encontrada.' });
      return;
    }
    if (error instanceof SinAccesoChatError) {
      res.status(403).json({ message: 'No autorizado.' });
      return;
    }
    if (error instanceof ChatSoloLecturaError) {
      res.status(409).json({
        message: 'La conversación está en modo solo lectura (solicitud cancelada u orden finalizada, cerrada o cancelada).',
      });
      return;
    }
    if (error instanceof ContenidoInvalidoError) {
      res.status(400).json({ message: error.message });
      return;
    }
    if (error instanceof LimiteNexiaError) {
      res.setHeader('Retry-After', String(error.reintentarEnSegundos));
      res.status(429).json({
        message: `Se alcanzó temporalmente el límite de invocaciones de NexIA (${NEXIA_MAX_INVOCACIONES} por minuto). Intente nuevamente en ${error.reintentarEnSegundos} segundos.`,
      });
      return;
    }
    throw error;
  }
}
