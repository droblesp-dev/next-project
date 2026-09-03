import type { Request, Response } from 'express';
import {
  listarCotizaciones,
  obtenerCotizacion,
  crearCotizacion,
  cambiarEstadoCotizacion,
  SolicitudNoEncontradaError,
  SolicitudNoEnRevisionError,
  CotizacionNoEncontradaError,
  TransicionInvalidaError,
  EstadoInvalidoError,
  YaExisteAceptadaError,
} from '../services/cotizaciones.service.js';

export async function listarController(_req: Request, res: Response): Promise<void> {
  const cotizaciones = await listarCotizaciones();
  res.status(200).json({ cotizaciones });
}

export async function obtenerController(req: Request, res: Response): Promise<void> {
  const cotizacion = await obtenerCotizacion(req.params.id);
  if (!cotizacion) {
    res.status(404).json({ message: 'Cotización no encontrada.' });
    return;
  }
  res.status(200).json({ cotizacion });
}

export async function crearController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { solicitud_id, valor, descripcion } = body;

  if (typeof solicitud_id !== 'string' || !solicitud_id.trim()) {
    res.status(400).json({ message: 'solicitud_id es requerido.' });
    return;
  }

  const valorNum = typeof valor === 'number' ? valor : Number(valor);
  if (valor === undefined || valor === null || valor === '' || Number.isNaN(valorNum) || valorNum < 0) {
    res.status(400).json({ message: 'valor es requerido y debe ser un número mayor o igual a 0.' });
    return;
  }

  if (descripcion !== undefined && descripcion !== null && typeof descripcion !== 'string') {
    res.status(400).json({ message: 'descripcion debe ser texto.' });
    return;
  }

  const creadoPor = req.user?.sub;
  if (!creadoPor) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    const cotizacion = await crearCotizacion({
      solicitudId: solicitud_id,
      valor: valorNum,
      descripcion: typeof descripcion === 'string' ? descripcion : null,
      creadoPor,
    });
    res.status(201).json({ cotizacion });
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

export async function cambiarEstadoController(req: Request, res: Response): Promise<void> {
  const { estado } = (req.body ?? {}) as { estado?: unknown };

  if (typeof estado !== 'string' || !estado.trim()) {
    res.status(400).json({ message: 'estado es requerido.' });
    return;
  }

  try {
    const cotizacion = await cambiarEstadoCotizacion(req.params.id, estado.trim());
    res.status(200).json({ cotizacion });
  } catch (error) {
    if (error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof TransicionInvalidaError) {
      res.status(409).json({ message: 'Transición de estado no permitida.' });
      return;
    }
    if (error instanceof EstadoInvalidoError) {
      res.status(400).json({ message: 'Estado inválido.' });
      return;
    }
    if (error instanceof YaExisteAceptadaError) {
      res.status(409).json({ message: 'Ya existe una cotización ACEPTADA para esta solicitud.' });
      return;
    }
    throw error;
  }
}
