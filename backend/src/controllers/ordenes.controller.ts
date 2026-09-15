import type { Request, Response } from 'express';
import {
  listarOrdenes,
  obtenerOrden,
  crearOrden,
  cambiarEstadoOrden,
  actualizarAvance,
  asignarResponsable,
  confirmarEntregaOrden,
  cerrarOrden,
  CotizacionNoEncontradaError,
  CotizacionNoAceptadaError,
  AnticipoNoConfirmadoError,
  OrdenYaExisteError,
  OrdenNoEncontradaError,
  TransicionInvalidaError,
  EstadoInvalidoError,
  ResponsableInvalidoError,
  FechaEntregaInvalidaError,
  AvanceInvalidoError,
  AvanceNoModificableError,
  AvanceIncompletoError,
  EvidenciaFaltanteError,
  ObservacionFaltanteError,
  OrdenNoFinalizadaError,
  SaldoNoValidadoError,
  EntregaNoConfirmadaError,
  EntregaEstadoInvalidoError,
} from '../services/ordenes.service.js';
import { generarFicha } from '../services/fichaTecnica.service.js';

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
  const { cotizacion_id, descripcion, fecha_entrega } = body;

  if (typeof cotizacion_id !== 'string' || !cotizacion_id.trim()) {
    res.status(400).json({ message: 'cotizacion_id es requerido.' });
    return;
  }

  if (descripcion !== undefined && descripcion !== null && typeof descripcion !== 'string') {
    res.status(400).json({ message: 'descripcion debe ser texto.' });
    return;
  }

  if (fecha_entrega !== undefined && fecha_entrega !== null && typeof fecha_entrega !== 'string') {
    res.status(400).json({ message: 'fecha_entrega debe ser texto en formato YYYY-MM-DD.' });
    return;
  }

  try {
    const orden = await crearOrden({
      cotizacionId: cotizacion_id,
      descripcion: typeof descripcion === 'string' ? descripcion : null,
      fechaEntrega: typeof fecha_entrega === 'string' ? fecha_entrega : null,
    });

    // Decisión 4/16: la orden ya quedó persistida en la línea anterior.
    // Generar la ficha técnica es un paso posterior — cualquier fallo aquí
    // (Gemini caído, timeout, sin API key) se registra y se ignora: NUNCA
    // debe afectar la respuesta de creación, que ya fue exitosa. Si falla,
    // no queda ninguna fila en `fichas_tecnicas` — el botón "Generar ficha
    // técnica" (endpoint manual) permite intentarlo de nuevo después.
    try {
      await generarFicha(orden.id);
    } catch (fichaError) {
      console.error(
        'No se pudo generar automáticamente la ficha técnica de la orden',
        orden.id,
        '-',
        fichaError instanceof Error ? fichaError.message : fichaError
      );
    }

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
    if (error instanceof AnticipoNoConfirmadoError) {
      res.status(409).json({
        message: 'El anticipo de esta cotización debe ser validado por Comercial antes de crear la orden.',
      });
      return;
    }
    if (error instanceof OrdenYaExisteError) {
      res.status(409).json({ message: 'Ya existe una orden para esta cotización.' });
      return;
    }
    if (error instanceof FechaEntregaInvalidaError) {
      res.status(400).json({ message: 'fecha_entrega debe ser una fecha válida en formato YYYY-MM-DD.' });
      return;
    }
    throw error;
  }
}

export async function cambiarEstadoController(req: Request, res: Response): Promise<void> {
  const { estado, observaciones } = (req.body ?? {}) as { estado?: unknown; observaciones?: unknown };

  if (typeof estado !== 'string' || !estado.trim()) {
    res.status(400).json({ message: 'estado es requerido.' });
    return;
  }

  if (observaciones !== undefined && observaciones !== null && typeof observaciones !== 'string') {
    res.status(400).json({ message: 'observaciones debe ser texto.' });
    return;
  }

  try {
    const orden = await cambiarEstadoOrden(
      req.params.id,
      estado.trim(),
      typeof observaciones === 'string' ? observaciones : undefined
    );
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
    if (error instanceof AvanceIncompletoError) {
      res.status(409).json({ message: 'No se puede finalizar: el avance debe ser 100% primero.' });
      return;
    }
    if (error instanceof EvidenciaFaltanteError) {
      res.status(409).json({ message: 'No se puede finalizar: se requiere al menos 1 evidencia (foto o PDF).' });
      return;
    }
    if (error instanceof ObservacionFaltanteError) {
      res.status(409).json({ message: 'No se puede finalizar: se requiere una observación final.' });
      return;
    }
    throw error;
  }
}

export async function actualizarAvanceController(req: Request, res: Response): Promise<void> {
  const { avance } = (req.body ?? {}) as { avance?: unknown };

  if (typeof avance !== 'number' || !Number.isFinite(avance)) {
    res.status(400).json({ message: 'avance es requerido y debe ser numérico.' });
    return;
  }

  try {
    const orden = await actualizarAvance(req.params.id, avance);
    res.status(200).json({ orden });
  } catch (error) {
    if (error instanceof OrdenNoEncontradaError) {
      res.status(404).json({ message: 'Orden no encontrada.' });
      return;
    }
    if (error instanceof AvanceInvalidoError) {
      res.status(400).json({ message: 'avance debe ser un entero entre 0 y 100.' });
      return;
    }
    if (error instanceof AvanceNoModificableError) {
      res.status(409).json({ message: 'No se puede modificar el avance de una orden en este estado.' });
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

// Bloque saldo/entrega/cierre. Exclusivo ADMIN/COMERCIAL (routes).
export async function confirmarEntregaController(req: Request, res: Response): Promise<void> {
  try {
    const orden = await confirmarEntregaOrden(req.params.id);
    res.status(200).json({ orden });
  } catch (error) {
    if (error instanceof OrdenNoEncontradaError) {
      res.status(404).json({ message: 'Orden no encontrada.' });
      return;
    }
    if (error instanceof EntregaEstadoInvalidoError) {
      res.status(409).json({ message: 'Solo se puede confirmar la entrega de una orden que esté FINALIZADA.' });
      return;
    }
    throw error;
  }
}

// Bloque saldo/entrega/cierre. Única vía a CERRADA (ver cerrarOrden) —
// PATCH /:id/estado ya no acepta este destino. Exclusivo ADMIN/COMERCIAL.
export async function cerrarController(req: Request, res: Response): Promise<void> {
  try {
    const orden = await cerrarOrden(req.params.id);
    res.status(200).json({ orden });
  } catch (error) {
    if (error instanceof OrdenNoEncontradaError || error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Orden o cotización asociada no encontrada.' });
      return;
    }
    if (error instanceof OrdenNoFinalizadaError) {
      res.status(409).json({ message: 'Solo se puede cerrar una orden que esté FINALIZADA.' });
      return;
    }
    if (error instanceof SaldoNoValidadoError) {
      res.status(409).json({ message: 'No se puede cerrar: el saldo de la cotización asociada debe estar VALIDADO.' });
      return;
    }
    if (error instanceof EntregaNoConfirmadaError) {
      res.status(409).json({ message: 'No se puede cerrar: la entrega debe estar confirmada.' });
      return;
    }
    throw error;
  }
}
