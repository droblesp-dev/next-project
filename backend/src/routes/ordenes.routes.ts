import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import {
  listarController,
  obtenerController,
  crearController,
  cambiarEstadoController,
  actualizarAvanceController,
  asignarResponsableController,
  confirmarEntregaController,
  cerrarController,
} from '../controllers/ordenes.controller.js';
import {
  obtenerFichaController,
  generarFichaController,
} from '../controllers/fichaTecnica.controller.js';
import {
  listarEvidenciasController,
  subirEvidenciaController,
  descargarEvidenciaController,
} from '../controllers/ordenEvidencia.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const ordenesRouter = Router();

// F-08: autorización separada por ruta (ya no un único requireRole a nivel
// de router) — COMERCIAL se agrega EXCLUSIVAMENTE a las 2 rutas de solo
// lectura. Cambiar estado sigue siendo ADMIN/OPERATIVO; crear y asignar
// responsable siguen siendo exclusivos de ADMIN. Ninguna ruta de escritura
// se abre a COMERCIAL.
ordenesRouter.use(requireAuth);

ordenesRouter.get('/', requireRole('ADMIN', 'OPERATIVO', 'COMERCIAL'), asyncRoute(listarController));
ordenesRouter.get('/:id', requireRole('ADMIN', 'OPERATIVO', 'COMERCIAL'), asyncRoute(obtenerController));

ordenesRouter.patch('/:id/estado', requireRole('ADMIN', 'OPERATIVO'), asyncRoute(cambiarEstadoController));

// Bloque avance/evidencia: endpoint separado del cambio de estado genérico
// (decisión explícita). Exclusivo de ADMIN/OPERATIVO — COMERCIAL no
// reporta avance.
ordenesRouter.patch('/:id/avance', requireRole('ADMIN', 'OPERATIVO'), asyncRoute(actualizarAvanceController));

// Bloque MVP ficha técnica, decisiones 1-3: COMERCIAL puede crear la
// orden (crearOrden() ya exige por sí sola ACEPTADA + anticipo resuelto,
// D.7 — nada de eso cambia aquí); OPERATIVO sigue sin poder crear.
ordenesRouter.post('/', requireRole('ADMIN', 'COMERCIAL'), asyncRoute(crearController));
ordenesRouter.patch('/:id/responsable', requireRole('ADMIN'), asyncRoute(asignarResponsableController));

// Ficha técnica: mismo conjunto de roles que ya pueden leer la orden
// (GET / y GET /:id, arriba) — generarla no modifica ningún campo de la
// orden en sí, es un enriquecimiento de solo lectura/consulta.
ordenesRouter.get('/:id/ficha-tecnica', requireRole('ADMIN', 'OPERATIVO', 'COMERCIAL'), asyncRoute(obtenerFichaController));
ordenesRouter.post('/:id/ficha-tecnica', requireRole('ADMIN', 'OPERATIVO', 'COMERCIAL'), asyncRoute(generarFichaController));

// Evidencias: lectura simétrica a GET /:id (mismos roles); subir evidencia
// es exclusivo de ADMIN/OPERATIVO (decisión explícita del bloque —
// COMERCIAL no sube evidencia).
ordenesRouter.get('/:id/evidencias', requireRole('ADMIN', 'OPERATIVO', 'COMERCIAL'), asyncRoute(listarEvidenciasController));
ordenesRouter.post('/:id/evidencias', requireRole('ADMIN', 'OPERATIVO'), asyncRoute(subirEvidenciaController));
// H-B (auditoría post-V9): descarga/visualización del archivo real, mismos
// roles de lectura que el listado.
ordenesRouter.get('/:id/evidencias/:evidenciaId', requireRole('ADMIN', 'OPERATIVO', 'COMERCIAL'), asyncRoute(descargarEvidenciaController));

// Bloque saldo/entrega/cierre: exclusivas ADMIN/COMERCIAL — OPERATIVO no
// maneja información económica ni gestiona entrega/cierre (decisión
// explícita). CERRADA deja de ser alcanzable por PATCH /:id/estado.
ordenesRouter.patch('/:id/entrega', requireRole('ADMIN', 'COMERCIAL'), asyncRoute(confirmarEntregaController));
ordenesRouter.patch('/:id/cerrar', requireRole('ADMIN', 'COMERCIAL'), asyncRoute(cerrarController));
