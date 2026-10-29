import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { buscarController } from '../controllers/busqueda.controller.js';

// Mismo patrón de las demás rutas (Express 4 no captura promesas rechazadas).
function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const busquedaRouter = Router();

// La autorización por rol se aplica por entidad en el servicio (mismos roles que su listado).
busquedaRouter.use(requireAuth);
busquedaRouter.get('/:entidad', asyncRoute(buscarController));
