import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { validarFormatoUuid } from '../middleware/uuidParam.middleware.js';
import {
  listarController,
  crearController,
  cambiarActivoController,
  cambiarRolController,
} from '../controllers/usuarios.controller.js';

// Envuelve un controller async para reenviar cualquier error a next(),
// ya que Express 4 no captura automáticamente promesas rechazadas.
function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const usuariosRouter = Router();

usuariosRouter.use(requireAuth, requireRole('ADMIN'));

// CORRECCIÓN FASE 4 (hallazgo #1): mismo guard de formato UUID que ya tenían ordenes/alertas/
// solicitudes — ver uuidParam.middleware.ts.
usuariosRouter.param('id', validarFormatoUuid('Usuario no encontrado.'));

usuariosRouter.get('/', asyncRoute(listarController));
usuariosRouter.post('/', asyncRoute(crearController));
usuariosRouter.patch('/:id/activo', asyncRoute(cambiarActivoController));
usuariosRouter.patch('/:id/rol', asyncRoute(cambiarRolController));
