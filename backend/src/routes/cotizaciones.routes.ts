import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import {
  listarController,
  obtenerController,
  crearController,
  cambiarEstadoController,
} from '../controllers/cotizaciones.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const cotizacionesRouter = Router();

cotizacionesRouter.use(requireAuth, requireRole('ADMIN', 'COMERCIAL'));

cotizacionesRouter.get('/', asyncRoute(listarController));
cotizacionesRouter.post('/', asyncRoute(crearController));
cotizacionesRouter.get('/:id', asyncRoute(obtenerController));
cotizacionesRouter.patch('/:id/estado', asyncRoute(cambiarEstadoController));
