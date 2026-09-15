import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import {
  listarController,
  obtenerController,
  crearController,
  cambiarEstadoController,
  generarEnlaceController,
  obtenerPublicaController,
  verificarCodigoController,
  aceptarController,
  rechazarController,
  subirComprobanteController,
  gestionarAnticipoController,
  descargarComprobanteController,
  subirComprobanteSaldoController,
  gestionarSaldoController,
  descargarComprobanteSaldoController,
  reabrirSaldoController,
} from '../controllers/cotizaciones.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const cotizacionesRouter = Router();

// Acceso público del cliente (Fase A — enlace seguro): sin requireAuth,
// registrada antes del middleware de autenticación del router, mismo
// patrón ya usado para POST /api/leads y POST /api/solicitudes. Valida
// exclusivamente mediante el token firmado — nunca acepta un UUID directo.
cotizacionesRouter.get('/publica/:token', asyncRoute(obtenerPublicaController));
cotizacionesRouter.post('/publica/:token/verificar', asyncRoute(verificarCodigoController));
// Fase D.5: el cliente decide desde aquí — ambos exigen token + código
// (nunca alcanza con el JWT solo, ver aceptarCotizacionPublica/
// rechazarCotizacionPublica). PATCH porque cambian el estado de un
// recurso ya existente, mismo verbo que el endpoint interno equivalente.
cotizacionesRouter.patch('/publica/:token/aceptar', asyncRoute(aceptarController));
cotizacionesRouter.patch('/publica/:token/rechazar', asyncRoute(rechazarController));
// Fase D.6: subida real del comprobante de transferencia — también
// pública (token + código), nunca requiere ni acepta un JWT interno. El
// procesamiento multipart ocurre dentro del propio controller.
cotizacionesRouter.post('/publica/:token/comprobante', asyncRoute(subirComprobanteController));
// Bloque saldo/entrega/cierre: mismo patrón público (token + código) que
// el comprobante de anticipo, para el comprobante del SALDO.
cotizacionesRouter.post('/publica/:token/comprobante-saldo', asyncRoute(subirComprobanteSaldoController));

cotizacionesRouter.use(requireAuth, requireRole('ADMIN', 'COMERCIAL'));

cotizacionesRouter.get('/', asyncRoute(listarController));
cotizacionesRouter.post('/', asyncRoute(crearController));
cotizacionesRouter.get('/:id', asyncRoute(obtenerController));
cotizacionesRouter.patch('/:id/estado', asyncRoute(cambiarEstadoController));
cotizacionesRouter.post('/:id/enlace', asyncRoute(generarEnlaceController));
// Fase D.6: exclusivas de ADMIN/COMERCIAL (detrás del middleware de arriba)
// — un cliente no tiene ninguna vía de alcanzarlas, ni siquiera con
// token+código válidos.
cotizacionesRouter.patch('/:id/anticipo', asyncRoute(gestionarAnticipoController));
cotizacionesRouter.get('/:id/comprobante', asyncRoute(descargarComprobanteController));
// Bloque saldo/entrega/cierre: mismas exclusividades (ADMIN/COMERCIAL,
// heredado del middleware de router de arriba) — OPERATIVO nunca alcanza
// este router.
cotizacionesRouter.patch('/:id/saldo', asyncRoute(gestionarSaldoController));
cotizacionesRouter.get('/:id/comprobante-saldo', asyncRoute(descargarComprobanteSaldoController));
// H-E (auditoría post-V9): acción explícita y separada para reabrir un
// saldo RECHAZADO — no se sobrecarga PATCH /:id/saldo con una tercera
// "accion".
cotizacionesRouter.patch('/:id/saldo/reabrir', asyncRoute(reabrirSaldoController));
