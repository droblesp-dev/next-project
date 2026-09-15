import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { obtenerController } from '../controllers/dashboard.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const dashboardRouter = Router();

// Exclusivo ADMIN (decisión definitiva de Fase 12). Reutiliza el mismo
// middleware de autenticación/autorización ya existente — no se crea
// ningún mecanismo de RBAC nuevo.
dashboardRouter.use(requireAuth, requireRole('ADMIN'));

dashboardRouter.get('/', asyncRoute(obtenerController));
