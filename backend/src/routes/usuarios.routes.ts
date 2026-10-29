import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { validarFormatoUuid } from '../middleware/uuidParam.middleware.js';
import {
  listarController,
  listarAdminsActivosController,
  listarOperativosActivosController,
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

// PC-2026-01 (continuación — Frontend Secciones C/D): registrada ANTES del
// bloque requireRole('ADMIN') de abajo, con su propio requireRole más
// amplio — COMERCIAL necesita identificar al ADMIN verificador en «Llamada
// a ADMIN» (CONFIRMAR_TELEFONICA) y no tiene acceso al resto de este
// router. Nunca expone email ni el listado completo de usuarios.
usuariosRouter.get('/admins-activos', requireAuth, requireRole('ADMIN', 'COMERCIAL'), asyncRoute(listarAdminsActivosController));

// #7: COMERCIAL necesita ver qué OPERATIVOS activos puede incorporar a una conversación (solo id y nombre).
usuariosRouter.get('/operativos-activos', requireAuth, requireRole('COMERCIAL'), asyncRoute(listarOperativosActivosController));

usuariosRouter.use(requireAuth, requireRole('ADMIN'));

// CORRECCIÓN FASE 4 (hallazgo #1): mismo guard de formato UUID que ya tenían ordenes/alertas/
// solicitudes — ver uuidParam.middleware.ts.
usuariosRouter.param('id', validarFormatoUuid('Usuario no encontrado.'));

usuariosRouter.get('/', asyncRoute(listarController));
usuariosRouter.post('/', asyncRoute(crearController));
usuariosRouter.patch('/:id/activo', asyncRoute(cambiarActivoController));
usuariosRouter.patch('/:id/rol', asyncRoute(cambiarRolController));
