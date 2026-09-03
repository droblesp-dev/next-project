import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { listarController, crearController } from '../controllers/clientes.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const clientesRouter = Router();

clientesRouter.use(requireAuth, requireRole('ADMIN', 'COMERCIAL'));

clientesRouter.get('/', asyncRoute(listarController));
clientesRouter.post('/', asyncRoute(crearController));
