import type { Request, Response } from 'express';
import { listarAlertas, atenderAlerta, AlertaNoEncontradaError, AlertaYaAtendidaError } from '../services/alertas.service.js';

export async function listarController(_req: Request, res: Response): Promise<void> {
  const alertas = await listarAlertas();
  res.status(200).json({ alertas });
}

export async function atenderController(req: Request, res: Response): Promise<void> {
  try {
    const alerta = await atenderAlerta(req.params.id);
    res.status(200).json({ alerta });
  } catch (error) {
    if (error instanceof AlertaNoEncontradaError) {
      res.status(404).json({ message: 'Alerta no encontrada.' });
      return;
    }
    if (error instanceof AlertaYaAtendidaError) {
      res.status(409).json({ message: 'La alerta ya fue atendida.' });
      return;
    }
    throw error;
  }
}
