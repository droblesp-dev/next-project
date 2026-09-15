import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { verifyToken } from '../services/auth.service.js';
import {
  listarController,
  obtenerController,
  crearController,
  cambiarEstadoController,
} from '../controllers/solicitudes.controller.js';
import {
  listarMensajesController,
  crearMensajeController,
} from '../controllers/solicitudMensajes.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

// POST /api/solicitudes está aprobado para: PÚBLICO + ADMIN + COMERCIAL,
// con OPERATIVO explícitamente rechazado (decisión 2.3/2.6). No es el mismo
// caso que requireAuth (que rechaza la ausencia de token): acá la ausencia
// de token es válida (acceso público), pero si SÍ se envía un token, debe
// ser válido y su rol no puede ser OPERATIVO. No modifica auth.middleware.ts
// de Fase 3 — solo reutiliza verifyToken(), ya exportado desde Fase 3.1.
function publicoOAdminOComercial(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next();
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Token inválido o expirado.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ message: 'Token no proporcionado.' });
    return;
  }

  try {
    const payload = verifyToken(token);
    if (payload.rol === 'OPERATIVO') {
      res.status(403).json({ message: 'No autorizado.' });
      return;
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: 'Token inválido o expirado.' });
  }
}

export const solicitudesRouter = Router();

solicitudesRouter.post('/', publicoOAdminOComercial, asyncRoute(crearController));

// Bloque MVP (chat Comercial<->Operativo): OPERATIVO se agrega
// ÚNICAMENTE a la lectura — nunca a la creación pública ni al cambio de
// estado, que siguen siendo exclusivos de ADMIN/COMERCIAL, sin cambios.
solicitudesRouter.get('/', requireAuth, requireRole('ADMIN', 'COMERCIAL', 'OPERATIVO'), asyncRoute(listarController));
solicitudesRouter.get('/:id', requireAuth, requireRole('ADMIN', 'COMERCIAL', 'OPERATIVO'), asyncRoute(obtenerController));
solicitudesRouter.patch(
  '/:id/estado',
  requireAuth,
  requireRole('ADMIN', 'COMERCIAL'),
  asyncRoute(cambiarEstadoController)
);

// Chat asociado a la solicitud: exclusivo COMERCIAL/OPERATIVO — ADMIN
// deliberadamente excluido (decisión aprobada explícitamente: "ADMIN no
// participa en este chat"), a diferencia de todas las demás rutas del
// proyecto, donde ADMIN siempre tiene acceso total.
solicitudesRouter.get(
  '/:id/mensajes',
  requireAuth,
  requireRole('COMERCIAL', 'OPERATIVO'),
  asyncRoute(listarMensajesController)
);
solicitudesRouter.post(
  '/:id/mensajes',
  requireAuth,
  requireRole('COMERCIAL', 'OPERATIVO'),
  asyncRoute(crearMensajeController)
);
