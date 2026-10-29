import type { Request, Response } from 'express';
import {
  buscarIds,
  esEntidadBusqueda,
  SinAccesoBusquedaError,
} from '../services/busqueda.service.js';
import { LONGITUD_MAXIMA_TERMINO, terminoValido } from '../services/busquedaPatron.js';

// GET /api/busqueda/:entidad?q=término — ids de todas las coincidencias (búsqueda parcial en BD).
export async function buscarController(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  const entidad = req.params.entidad;
  if (!esEntidadBusqueda(entidad)) {
    res.status(404).json({ message: 'Entidad de búsqueda no encontrada.' });
    return;
  }

  const termino = terminoValido(req.query.q);
  if (termino === null) {
    res.status(400).json({ message: `q es requerido y debe tener entre 1 y ${LONGITUD_MAXIMA_TERMINO} caracteres.` });
    return;
  }

  try {
    const ids = await buscarIds(entidad, termino, { sub: req.user.sub, rol: req.user.rol });
    res.status(200).json({ ids });
  } catch (error) {
    if (error instanceof SinAccesoBusquedaError) {
      res.status(403).json({ message: 'No tiene permiso para buscar en esta sección.' });
      return;
    }
    throw error;
  }
}
