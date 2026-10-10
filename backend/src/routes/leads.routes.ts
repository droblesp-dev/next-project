import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { validarFormatoUuid } from '../middleware/uuidParam.middleware.js';
import {
  listarController,
  obtenerController,
  crearController,
  actualizarController,
  asignarController,
  listarSeguimientoController,
  registrarSeguimientoController,
  generarEnlaceSolicitudController,
  validarEnlaceSolicitudController,
  crearSolicitudPorEnlaceController,
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

// Enlace de solicitud de un lead TIBIO: rutas públicas (el acceso lo da el
// token firmado, no una sesión) registradas antes del middleware de
// autenticación. GET solo valida; POST crea la solicitud y vincula el lead.
leadsRouter.get('/enlace-solicitud/:token', asyncRoute(validarEnlaceSolicitudController));
leadsRouter.post('/enlace-solicitud/:token/solicitud', asyncRoute(crearSolicitudPorEnlaceController));

// ADMIN y COMERCIAL: acceso total a los leads (decisión aprobada — sin
// filtrar por comercial_id). OPERATIVO bloqueado en este middleware.
leadsRouter.use(requireAuth, requireRole('ADMIN', 'COMERCIAL'));

// CORRECCIÓN FASE 4 (hallazgo #1): mismo guard de formato UUID que ya tenían ordenes/alertas/
// solicitudes — ver uuidParam.middleware.ts. No afecta las rutas públicas de arriba (usan :token).
leadsRouter.param('id', validarFormatoUuid('Lead no encontrado.'));

leadsRouter.get('/', asyncRoute(listarController));
leadsRouter.get('/:id', asyncRoute(obtenerController));
leadsRouter.patch('/:id', asyncRoute(actualizarController));
leadsRouter.get('/:id/seguimientos', asyncRoute(listarSeguimientoController));
leadsRouter.post('/:id/seguimientos', asyncRoute(registrarSeguimientoController));

// Generar enlace de solicitud: ADMIN/COMERCIAL (requireRole del router).
leadsRouter.post('/:id/enlace-solicitud', asyncRoute(generarEnlaceSolicitudController));

// Asignar/reasignar: exclusivo ADMIN (requireRole adicional apilado, mismo
// patrón que ordenes.routes.ts para POST y PATCH .../responsable).
leadsRouter.patch('/:id/asignar', requireRole('ADMIN'), asyncRoute(asignarController));
