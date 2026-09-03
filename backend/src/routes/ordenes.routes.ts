import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import {
  listarController,
  obtenerController,
  crearController,
  cambiarEstadoController,
  asignarResponsableController,
} from '../controllers/ordenes.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const ordenesRouter = Router();

// ADMIN y OPERATIVO tienen acceso general (listar/detalle/cambiar estado).
// Crear y asignar responsable quedan restringidos a ADMIN mediante un
// requireRole adicional sobre esas dos rutas puntuales.
ordenesRouter.use(requireAuth, requireRole('ADMIN', 'OPERATIVO'));

ordenesRouter.get('/', asyncRoute(listarController));
ordenesRouter.get('/:id', asyncRoute(obtenerController));
ordenesRouter.patch('/:id/estado', asyncRoute(cambiarEstadoController));

ordenesRouter.post('/', requireRole('ADMIN'), asyncRoute(crearController));
ordenesRouter.patch('/:id/responsable', requireRole('ADMIN'), asyncRoute(asignarResponsableController));
