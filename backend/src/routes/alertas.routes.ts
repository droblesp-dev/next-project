import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { listarController, generarController, atenderController } from '../controllers/alertas.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const alertasRouter = Router();

// Sin endpoints públicos.
alertasRouter.use(requireAuth);

// ALERTAS-02 (hallazgo H2): mismo guardia de formato ya usado en ordenes.routes.ts desde el Bloque
// 3A — un :id que no es UUID no puede corresponder a ninguna alerta; se responde 404 controlado en
// lugar de dejar que PostgreSQL falle con "invalid input syntax for type uuid" (500). Se ejecuta
// después de requireAuth (401 primero) y antes de cualquier handler con :id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
alertasRouter.param('id', (_req, res, next, valor: string) => {
  if (!UUID_RE.test(valor)) {
    res.status(404).json({ message: 'Alerta no encontrada.' });
    return;
  }
  next();
});

// ALERTAS-02 (decisiones 1A/2B/3A): la consulta se abre a los 3 roles — la visibilidad real
// (todas / solo responsable / solo tipo ENTREGA) la decide el service según el rol, nunca aquí.
alertasRouter.get('/', requireRole('ADMIN', 'COMERCIAL', 'OPERATIVO'), asyncRoute(listarController));

// ALERTAS-02 (decisión 8A): proceso explícito de generación, separado de la consulta. Mismos 3
// roles que pueden consultar — cualquiera de ellos puede refrescar el listado antes de leerlo;
// idempotente (ON CONFLICT), sin infraestructura nueva.
alertasRouter.post('/generar', requireRole('ADMIN', 'COMERCIAL', 'OPERATIVO'), asyncRoute(generarController));

// ALERTAS-02 (decisión 5A): "atender" sigue siendo exclusivo de ADMIN/OPERATIVO (COMERCIAL nunca
// llega aquí); la autorización fina por responsable_id vive en el service (atenderAlerta).
alertasRouter.patch('/:id/atender', requireRole('ADMIN', 'OPERATIVO'), asyncRoute(atenderController));
