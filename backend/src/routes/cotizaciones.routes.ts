import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { validarFormatoUuid } from '../middleware/uuidParam.middleware.js';
import {
  listarController,
  obtenerController,
  crearController,
  editarController,
  cambiarEstadoController,
  generarEnlaceController,
  obtenerPublicaController,
  verificarCodigoController,
  solicitarRecuperacionCodigoController,
  verificarRecuperacionCodigoController,
  aceptarController,
  rechazarController,
  subirComprobanteController,
  gestionarAnticipoController,
  descargarComprobanteController,
  subirComprobanteSaldoController,
  gestionarSaldoController,
  descargarComprobanteSaldoController,
  reabrirSaldoController,
  historialTransferenciasController,
  listarCuentasReceptorasController,
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
// "Implementación Fase 1: Recuperación segura del código de cotización"
// (autorización explícita): el cliente conserva el enlace (token), pero
// perdió el código de 6 dígitos. Paso A (solicitar OTP) y Paso B+C
// (verificar OTP + regenerar código) — ambos públicos, token en la ruta,
// nunca aceptan un correo alternativo ni requieren el código de acceso
// que precisamente se perdió.
cotizacionesRouter.post('/publica/:token/recuperar-codigo/solicitar', asyncRoute(solicitarRecuperacionCodigoController));
cotizacionesRouter.post('/publica/:token/recuperar-codigo/verificar', asyncRoute(verificarRecuperacionCodigoController));
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

// CORRECCIÓN FASE 4 (hallazgo #1): mismo guard de formato UUID que ya tenían ordenes/alertas/
// solicitudes — un :id que no es UUID no puede corresponder a ninguna cotización; se responde 404
// controlado en lugar de dejar que PostgreSQL falle con "invalid input syntax for type uuid" (500).
// No afecta a las rutas públicas de arriba (usan :token, nunca :id). Se ejecuta después de
// requireAuth/requireRole (401/403 primero) y antes de cualquier handler con :id.
cotizacionesRouter.param('id', validarFormatoUuid('Cotización no encontrada.'));

cotizacionesRouter.get('/', asyncRoute(listarController));
// PC-2026-01: cuentas receptoras activas para elegir al gestionar un pago. Debe
// registrarse ANTES de GET /:id (si no, 'cuentas-receptoras' se interpretaría como
// un :id y el guard de formato UUID respondería 404). Mismos roles del router
// (ADMIN/COMERCIAL); solo lectura.
cotizacionesRouter.get('/cuentas-receptoras', asyncRoute(listarCuentasReceptorasController));
cotizacionesRouter.post('/', asyncRoute(crearController));
cotizacionesRouter.get('/:id', asyncRoute(obtenerController));
// Edición de condiciones comerciales — EXCLUSIVA de BORRADOR (autorización
// explícita — "IMPLEMENTACIÓN AUTORIZADA — EDICIÓN DE COTIZACIONES
// BORRADOR"). Mismos roles que el resto del bloque interno (ADMIN/COMERCIAL,
// heredado del middleware de arriba) — la corrección de permisos de ADMIN
// queda fuera de este bloque, sin tocar aquí.
cotizacionesRouter.patch('/:id', asyncRoute(editarController));
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
// PC-2026-01, Etapa 4: historial de transferencias_pago (ambos tipos,
// vigentes y no vigentes) — mismas exclusividades (ADMIN/COMERCIAL) que el
// resto de este router; la separación de permisos ADMIN/COMERCIAL dentro
// de cada acción de /:id/anticipo y /:id/saldo (VALIDAR/RECHAZAR/
// CONFIRMAR_TELEFONICA) se verifica dentro del controller, no aquí.
cotizacionesRouter.get('/:id/transferencias', asyncRoute(historialTransferenciasController));
