import type { Request, Response } from 'express';
import {
  obtenerFicha,
  generarFicha,
  OrdenNoEncontradaError,
  FichaYaExisteError,
  GeneracionFallidaError,
} from '../services/fichaTecnica.service.js';

export async function obtenerFichaController(req: Request, res: Response): Promise<void> {
  try {
    const ficha = await obtenerFicha(req.params.id);
    if (!ficha) {
      res.status(404).json({ message: 'Esta orden todavía no tiene una ficha técnica generada.' });
      return;
    }
    res.status(200).json({ ficha });
  } catch (error) {
    if (error instanceof OrdenNoEncontradaError) {
      res.status(404).json({ message: 'Orden no encontrada.' });
      return;
    }
    throw error;
  }
}

// Generación manual (decisión 17): solo tiene efecto útil cuando no existe
// ficha todavía (tras un fallo de la generación automática). No es un
// sistema de reintentos — es la misma función que la generación
// automática, invocada explícitamente.
export async function generarFichaController(req: Request, res: Response): Promise<void> {
  try {
    const ficha = await generarFicha(req.params.id);
    res.status(201).json({ ficha });
  } catch (error) {
    if (error instanceof OrdenNoEncontradaError) {
      res.status(404).json({ message: 'Orden no encontrada.' });
      return;
    }
    if (error instanceof FichaYaExisteError) {
      res.status(409).json({ message: 'Esta orden ya tiene una ficha técnica generada.' });
      return;
    }
    if (error instanceof GeneracionFallidaError) {
      res.status(502).json({ message: 'No se pudo generar la ficha técnica en este momento. Intente nuevamente.' });
      return;
    }
    throw error;
  }
}
