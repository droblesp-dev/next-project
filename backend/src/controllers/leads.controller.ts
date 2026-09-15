import type { Request, Response } from 'express';
import {
  listarLeads,
  obtenerLead,
  crearLead,
  actualizarLead,
  asignarComercial,
  registrarSeguimiento,
  listarSeguimientosDeLead,
  LeadNoEncontradoError,
  FuenteInvalidaError,
  ClienteNoEncontradoError,
  SolicitudNoEncontradaError,
  ComercialInvalidoError,
  ClasificacionNoPermitidaError,
  TransicionInvalidaError,
  SinEvidenciaError,
  TipoSeguimientoInvalidoError,
} from '../services/leads.service.js';

const FUENTES_VALIDAS = ['WEB', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'REFERIDO', 'OTRO'];
const TIPOS_SEGUIMIENTO_VALIDOS = ['LLAMADA', 'WHATSAPP', 'EMAIL', 'VISITA', 'OTRO'];

export async function listarController(_req: Request, res: Response): Promise<void> {
  const leads = await listarLeads();
  res.status(200).json({ leads });
}

export async function obtenerController(req: Request, res: Response): Promise<void> {
  const lead = await obtenerLead(req.params.id);
  if (!lead) {
    res.status(404).json({ message: 'Lead no encontrado.' });
    return;
  }
  res.status(200).json({ lead });
}

export async function crearController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { nombre, telefono, email, fuente } = body;

  if (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 150) {
    res.status(400).json({ message: 'nombre es requerido y debe tener un formato válido.' });
    return;
  }
  if (typeof telefono !== 'string' || !telefono.trim() || telefono.length > 30) {
    res.status(400).json({ message: 'telefono es requerido y debe tener un formato válido.' });
    return;
  }
  if (email !== undefined && email !== null && (typeof email !== 'string' || email.length > 150)) {
    res.status(400).json({ message: 'email debe ser texto de hasta 150 caracteres.' });
    return;
  }
  if (typeof fuente !== 'string' || !FUENTES_VALIDAS.includes(fuente)) {
    res.status(400).json({ message: `fuente es requerida y debe ser una de: ${FUENTES_VALIDAS.join(', ')}.` });
    return;
  }

  const lead = await crearLead({
    nombre: nombre.trim(),
    telefono: telefono.trim(),
    email: typeof email === 'string' ? email.trim() : null,
    fuente,
  });
  res.status(201).json({ lead });
}

export async function actualizarController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;

  // Whitelist estricta: ningún campo no reconocido llega al service, y
  // mucho menos al repositorio — nunca se reenvía el body sin filtrar.
  const input: Record<string, unknown> = {};
  if (typeof body.nombre === 'string') input.nombre = body.nombre.trim();
  if (typeof body.telefono === 'string') input.telefono = body.telefono.trim();
  if (body.email === null || typeof body.email === 'string') input.email = body.email;
  if (typeof body.fuente === 'string') input.fuente = body.fuente;
  if (body.observaciones === null || typeof body.observaciones === 'string') input.observaciones = body.observaciones;
  if (body.cliente_id === null || typeof body.cliente_id === 'string') input.cliente_id = body.cliente_id;
  if (body.solicitud_id === null || typeof body.solicitud_id === 'string') input.solicitud_id = body.solicitud_id;
  if (typeof body.clasificacion === 'string') input.clasificacion = body.clasificacion;
  if (typeof body.estado === 'string') input.estado = body.estado;

  try {
    const lead = await actualizarLead(req.params.id, input);
    res.status(200).json({ lead });
  } catch (error) {
    if (error instanceof LeadNoEncontradoError) {
      res.status(404).json({ message: 'Lead no encontrado.' });
      return;
    }
    if (error instanceof FuenteInvalidaError) {
      res.status(400).json({ message: 'fuente inválida.' });
      return;
    }
    if (error instanceof ClienteNoEncontradoError) {
      res.status(404).json({ message: 'Cliente no encontrado.' });
      return;
    }
    if (error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Solicitud no encontrada.' });
      return;
    }
    if (error instanceof ClasificacionNoPermitidaError) {
      res.status(400).json({ message: 'Ese valor de clasificación no puede establecerse manualmente.' });
      return;
    }
    if (error instanceof TransicionInvalidaError) {
      res.status(409).json({ message: 'Transición de estado/clasificación no permitida.' });
      return;
    }
    if (error instanceof SinEvidenciaError) {
      res.status(409).json({ message: 'No existe evidencia real suficiente para esa clasificación.' });
      return;
    }
    throw error;
  }
}

export async function asignarController(req: Request, res: Response): Promise<void> {
  const { comercial_id } = (req.body ?? {}) as { comercial_id?: unknown };

  if (typeof comercial_id !== 'string' || !comercial_id.trim()) {
    res.status(400).json({ message: 'comercial_id es requerido.' });
    return;
  }

  try {
    const lead = await asignarComercial(req.params.id, comercial_id.trim());
    res.status(200).json({ lead });
  } catch (error) {
    if (error instanceof LeadNoEncontradoError) {
      res.status(404).json({ message: 'Lead no encontrado.' });
      return;
    }
    if (error instanceof ComercialInvalidoError) {
      res.status(400).json({ message: 'comercial_id debe corresponder a un usuario con rol COMERCIAL y activo.' });
      return;
    }
    throw error;
  }
}

// Historial real: devuelve todos los registros de lead_seguimientos de
// este lead (0..N), más recientes primero.
export async function listarSeguimientoController(req: Request, res: Response): Promise<void> {
  try {
    const seguimientos = await listarSeguimientosDeLead(req.params.id);
    res.status(200).json({ seguimientos });
  } catch (error) {
    if (error instanceof LeadNoEncontradoError) {
      res.status(404).json({ message: 'Lead no encontrado.' });
      return;
    }
    throw error;
  }
}

// El usuario responsable se obtiene EXCLUSIVAMENTE de req.user.sub (ya
// autenticado por el middleware del router) — el body nunca puede
// establecer quién registró el seguimiento. La fecha la fija PostgreSQL
// (DEFAULT CURRENT_TIMESTAMP en lead_seguimientos), no el cliente.
export async function registrarSeguimientoController(req: Request, res: Response): Promise<void> {
  const comercialId = req.user?.sub;
  if (!comercialId) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const tipo = body.tipo;
  const observacion = body.observacion;

  if (typeof tipo !== 'string' || !TIPOS_SEGUIMIENTO_VALIDOS.includes(tipo)) {
    res.status(400).json({ message: `tipo es requerido y debe ser uno de: ${TIPOS_SEGUIMIENTO_VALIDOS.join(', ')}.` });
    return;
  }
  if (observacion !== undefined && observacion !== null && typeof observacion !== 'string') {
    res.status(400).json({ message: 'observacion debe ser texto.' });
    return;
  }

  try {
    const { lead, seguimiento } = await registrarSeguimiento(req.params.id, comercialId, {
      tipo,
      observacion: typeof observacion === 'string' ? observacion : null,
    });
    res.status(201).json({ lead, seguimiento });
  } catch (error) {
    if (error instanceof LeadNoEncontradoError) {
      res.status(404).json({ message: 'Lead no encontrado.' });
      return;
    }
    if (error instanceof TipoSeguimientoInvalidoError) {
      res.status(400).json({ message: 'tipo inválido.' });
      return;
    }
    throw error;
  }
}
