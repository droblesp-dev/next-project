import type { Request, Response } from 'express';
import {
  listarSolicitudes,
  obtenerSolicitud,
  crearSolicitud,
  cambiarEstadoSolicitud,
  SolicitudNoEncontradaError,
  TransicionInvalidaError,
  EstadoInvalidoError,
} from '../services/solicitudes.service.js';

export async function listarController(_req: Request, res: Response): Promise<void> {
  const solicitudes = await listarSolicitudes();
  res.status(200).json({ solicitudes });
}

export async function obtenerController(req: Request, res: Response): Promise<void> {
  const solicitud = await obtenerSolicitud(req.params.id);
  if (!solicitud) {
    res.status(404).json({ message: 'Solicitud no encontrada.' });
    return;
  }
  res.status(200).json({ solicitud });
}

export async function crearController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { nombre, empresa, email, telefono, servicio, descripcion, cantidad, fecha_requerida } = body;

  if (
    typeof nombre !== 'string' || !nombre.trim() || nombre.length > 150 ||
    typeof email !== 'string' || !email.trim() || !email.includes('@') || email.length > 150 ||
    typeof telefono !== 'string' || !telefono.trim() || telefono.length > 30 ||
    typeof servicio !== 'string' || !servicio.trim() || servicio.length > 150 ||
    typeof descripcion !== 'string' || !descripcion.trim()
  ) {
    res.status(400).json({
      message: 'nombre, email, telefono, servicio y descripcion son requeridos y deben tener un formato/longitud válidos.',
    });
    return;
  }

  if (empresa !== undefined && empresa !== null && (typeof empresa !== 'string' || empresa.length > 150)) {
    res.status(400).json({ message: 'empresa debe ser texto de hasta 150 caracteres.' });
    return;
  }

  const cantidadNum = typeof cantidad === 'number' ? cantidad : Number(cantidad);
  if (cantidad === undefined || cantidad === null || cantidad === '' || !Number.isInteger(cantidadNum) || cantidadNum <= 0) {
    res.status(400).json({ message: 'cantidad es requerida y debe ser un número entero mayor que 0.' });
    return;
  }

  let fechaRequerida: string | null = null;
  if (fecha_requerida !== undefined && fecha_requerida !== null && fecha_requerida !== '') {
    if (typeof fecha_requerida !== 'string' || Number.isNaN(Date.parse(fecha_requerida))) {
      res.status(400).json({ message: 'fecha_requerida no es una fecha válida.' });
      return;
    }
    fechaRequerida = fecha_requerida;
  }

  const solicitud = await crearSolicitud({
    nombre,
    empresa: typeof empresa === 'string' ? empresa : null,
    email,
    telefono,
    servicio,
    descripcion,
    cantidad: cantidadNum,
    fechaRequerida,
  });

  res.status(201).json({ solicitud });
}

export async function cambiarEstadoController(req: Request, res: Response): Promise<void> {
  const { estado } = (req.body ?? {}) as { estado?: unknown };

  if (typeof estado !== 'string' || !estado.trim()) {
    res.status(400).json({ message: 'estado es requerido.' });
    return;
  }

  try {
    const solicitud = await cambiarEstadoSolicitud(req.params.id, estado.trim());
    res.status(200).json({ solicitud });
  } catch (error) {
    if (error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Solicitud no encontrada.' });
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
