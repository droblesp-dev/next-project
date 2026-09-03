import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import {
  listarController,
  obtenerController,
  crearController,
  marcarRevisadoController,
} from '../controllers/analisisIa.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const analisisIaRouter = Router();

analisisIaRouter.use(requireAuth, requireRole('ADMIN', 'COMERCIAL'));

analisisIaRouter.get('/', asyncRoute(listarController));
analisisIaRouter.post('/', asyncRoute(crearController));
analisisIaRouter.get('/:id', asyncRoute(obtenerController));
analisisIaRouter.patch('/:id/revisado', asyncRoute(marcarRevisadoController));
