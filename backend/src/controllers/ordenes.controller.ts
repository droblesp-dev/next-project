import type { Request, Response } from 'express';
import {
  listarOrdenes,
  obtenerOrden,
  crearOrden,
  cambiarEstadoOrden,
  asignarResponsable,
  CotizacionNoEncontradaError,
  CotizacionNoAceptadaError,
  OrdenYaExisteError,
  OrdenNoEncontradaError,
  TransicionInvalidaError,
  EstadoInvalidoError,
  ResponsableInvalidoError,
} from '../services/ordenes.service.js';

export async function listarController(_req: Request, res: Response): Promise<void> {
  const ordenes = await listarOrdenes();
  res.status(200).json({ ordenes });
}

export async function obtenerController(req: Request, res: Response): Promise<void> {
  const orden = await obtenerOrden(req.params.id);
  if (!orden) {
    res.status(404).json({ message: 'Orden no encontrada.' });
    return;
  }
  res.status(200).json({ orden });
}

export async function crearController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { cotizacion_id, descripcion } = body;

  if (typeof cotizacion_id !== 'string' || !cotizacion_id.trim()) {
    res.status(400).json({ message: 'cotizacion_id es requerido.' });
    return;
  }

  if (descripcion !== undefined && descripcion !== null && typeof descripcion !== 'string') {
    res.status(400).json({ message: 'descripcion debe ser texto.' });
    return;
  }

  try {
    const orden = await crearOrden({
      cotizacionId: cotizacion_id,
      descripcion: typeof descripcion === 'string' ? descripcion : null,
    });
    res.status(201).json({ orden });
  } catch (error) {
    if (error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof CotizacionNoAceptadaError) {
      res.status(409).json({ message: 'La cotización no está en estado ACEPTADA.' });
      return;
    }
    if (error instanceof OrdenYaExisteError) {
      res.status(409).json({ message: 'Ya existe una orden para esta cotización.' });
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
    const orden = await cambiarEstadoOrden(req.params.id, estado.trim());
    res.status(200).json({ orden });
  } catch (error) {
    if (error instanceof OrdenNoEncontradaError) {
      res.status(404).json({ message: 'Orden no encontrada.' });
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
    throw error;
  }
}

export async function asignarResponsableController(req: Request, res: Response): Promise<void> {
  const { responsable_id } = (req.body ?? {}) as { responsable_id?: unknown };

  if (typeof responsable_id !== 'string' || !responsable_id.trim()) {
    res.status(400).json({ message: 'responsable_id es requerido.' });
    return;
  }

  try {
    const orden = await asignarResponsable(req.params.id, responsable_id.trim());
    res.status(200).json({ orden });
  } catch (error) {
    if (error instanceof OrdenNoEncontradaError) {
      res.status(404).json({ message: 'Orden no encontrada.' });
      return;
    }
    if (error instanceof ResponsableInvalidoError) {
      res.status(400).json({ message: 'responsable_id debe corresponder a un usuario con rol OPERATIVO y activo.' });
      return;
    }
    throw error;
  }
}
