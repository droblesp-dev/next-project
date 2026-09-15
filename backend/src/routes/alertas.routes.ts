import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { listarController, atenderController } from '../controllers/alertas.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const alertasRouter = Router();

// ADMIN y OPERATIVO: mismo esquema de acceso ya usado en ordenes.routes.ts.
// Sin endpoints públicos.
alertasRouter.use(requireAuth, requireRole('ADMIN', 'OPERATIVO'));

alertasRouter.get('/', asyncRoute(listarController));
alertasRouter.patch('/:id/atender', asyncRoute(atenderController));
