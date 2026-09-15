import type { Request, Response } from 'express';
import { obtenerResumen } from '../services/dashboard.service.js';

export async function obtenerController(_req: Request, res: Response): Promise<void> {
  const resumen = await obtenerResumen();
  res.status(200).json({ resumen });
}
