import type { Request, Response } from 'express';
import {
  listarAlertas,
  generarAlertas,
  atenderAlerta,
  AlertaNoEncontradaError,
  AlertaYaAtendidaError,
  SinAccesoAlertaError,
} from '../services/alertas.service.js';

// ALERTAS-02 (decisiones 1A/2B/3A): la visibilidad depende del rol autenticado — nunca se lista sin
// req.user (la ruta ya exige requireAuth+requireRole antes de llegar aquí).
export async function listarController(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }
  const alertas = await listarAlertas({ sub: req.user.sub, rol: req.user.rol });
  res.status(200).json({ alertas });
}

// ALERTAS-02 (decisión 8A): proceso explícito y separado de la consulta — no modifica nada más allá
// de la propia tabla `alertas`; no requiere ni devuelve ningún dato de negocio.
export async function generarController(_req: Request, res: Response): Promise<void> {
  await generarAlertas();
  res.status(204).end();
}

export async function atenderController(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }
  try {
    const alerta = await atenderAlerta(req.params.id, { sub: req.user.sub, rol: req.user.rol });
    res.status(200).json({ alerta });
  } catch (error) {
    if (error instanceof AlertaNoEncontradaError) {
      res.status(404).json({ message: 'Alerta no encontrada.' });
      return;
    }
    // ALERTAS-02 (hallazgo H1): antes de la disponibilidad (409/200), se resuelve la autorización.
    if (error instanceof SinAccesoAlertaError) {
      res.status(403).json({ message: 'No autorizado: esta alerta no corresponde a una orden asignada a este usuario.' });
      return;
    }
    if (error instanceof AlertaYaAtendidaError) {
      res.status(409).json({ message: 'La alerta ya fue atendida.' });
      return;
    }
    throw error;
  }
}
