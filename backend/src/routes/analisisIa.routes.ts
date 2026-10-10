import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { validarFormatoUuid } from '../middleware/uuidParam.middleware.js';
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

// CORRECCIÓN FASE 4 (hallazgo #1): mismo guard de formato UUID que ya tenían ordenes/alertas/
// solicitudes — ver uuidParam.middleware.ts.
analisisIaRouter.param('id', validarFormatoUuid('Análisis no encontrado.'));

analisisIaRouter.get('/', asyncRoute(listarController));
analisisIaRouter.post('/', asyncRoute(crearController));
analisisIaRouter.get('/:id', asyncRoute(obtenerController));
analisisIaRouter.patch('/:id/revisado', asyncRoute(marcarRevisadoController));
