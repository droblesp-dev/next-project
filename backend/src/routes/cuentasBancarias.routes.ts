import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { validarFormatoUuid } from '../middleware/uuidParam.middleware.js';
import {
  listarController,
  listarBancosCatalogoController,
  obtenerController,
  crearController,
  editarController,
  cambiarActivoController,
} from '../controllers/cuentasBancarias.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const cuentasBancariasRouter = Router();

// Gestión administrativa de cuentas bancarias — exclusiva de ADMIN
// (PC-2026-01, revisión 3, ya confirmado en esta misma conversación).
// La consulta pública de cuentas activas (Fase D.4 del diseño) no se
// expone todavía por este router ni por ningún otro endpoint público:
// vive como función de servicio (`listarCuentasActivasPublico`) lista
// para conectarse al DTO de `GET /api/cotizaciones/publica/:token` en
// una etapa posterior, evitando crear mientras tanto una superficie
// pública nueva de enumeración de cuentas.
cuentasBancariasRouter.use(requireAuth, requireRole('ADMIN'));

cuentasBancariasRouter.param('id', validarFormatoUuid('Cuenta bancaria no encontrada.'));

cuentasBancariasRouter.get('/', asyncRoute(listarController));
cuentasBancariasRouter.post('/', asyncRoute(crearController));
// PC-2026-01 (Fase B): registrada ANTES de `GET /:id` — de lo contrario
// Express la confundiría con un :id literal "catalogo-bancos" (falla el
// guard de formato UUID, 404 falso). Mismo router, mismas exclusividades
// (ADMIN, heredado del middleware de arriba) — el catálogo de bancos es
// un recurso de apoyo exclusivo de esta pantalla administrativa.
cuentasBancariasRouter.get('/catalogo-bancos', asyncRoute(listarBancosCatalogoController));
cuentasBancariasRouter.get('/:id', asyncRoute(obtenerController));
cuentasBancariasRouter.patch('/:id', asyncRoute(editarController));
cuentasBancariasRouter.patch('/:id/activo', asyncRoute(cambiarActivoController));
