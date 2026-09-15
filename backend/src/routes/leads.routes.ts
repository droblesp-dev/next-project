import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import {
  listarController,
  obtenerController,
  crearController,
  actualizarController,
  asignarController,
  listarSeguimientoController,
  registrarSeguimientoController,
} from '../controllers/leads.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const leadsRouter = Router();

// Captación pública (Asistente Comercial) — sin requireAuth, registrada
// antes del middleware de autenticación del router.
leadsRouter.post('/', asyncRoute(crearController));

// ADMIN y COMERCIAL: acceso total a los leads (decisión aprobada — sin
// filtrar por comercial_id). OPERATIVO bloqueado en este middleware.
leadsRouter.use(requireAuth, requireRole('ADMIN', 'COMERCIAL'));

leadsRouter.get('/', asyncRoute(listarController));
leadsRouter.get('/:id', asyncRoute(obtenerController));
leadsRouter.patch('/:id', asyncRoute(actualizarController));
leadsRouter.get('/:id/seguimientos', asyncRoute(listarSeguimientoController));
leadsRouter.post('/:id/seguimientos', asyncRoute(registrarSeguimientoController));

// Asignar/reasignar: exclusivo ADMIN (requireRole adicional apilado, mismo
// patrón que ordenes.routes.ts para POST y PATCH .../responsable).
leadsRouter.patch('/:id/asignar', requireRole('ADMIN'), asyncRoute(asignarController));
