import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware.js';
import { requireResponsableOrden, requireLecturaEvidencias, requireLecturaFichaTecnica } from '../middleware/ordenResponsable.middleware.js';
import {
  listarController,
  obtenerController,
  crearController,
  cambiarEstadoController,
  actualizarAvanceController,
  asignarResponsableController,
  confirmarEntregaController,
  cerrarController,
  cancelarController,
  reprogramarFechaEntregaController,
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

// Bloque 3A: un id mal formado (no UUID) no puede corresponder a ninguna orden/evidencia; se responde
// 404 controlado en lugar de dejar que PostgreSQL falle con "invalid input syntax for type uuid" (500).
// Se ejecuta después de requireAuth (401 sin token) y antes de los handlers de cada ruta con :id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
ordenesRouter.param('id', (_req, res, next, valor: string) => {
  if (!UUID_RE.test(valor)) {
    res.status(404).json({ message: 'Orden no encontrada.' });
    return;
  }
  next();
});
ordenesRouter.param('evidenciaId', (_req, res, next, valor: string) => {
  if (!UUID_RE.test(valor)) {
    res.status(404).json({ message: 'Evidencia no encontrada para esta orden.' });
    return;
  }
  next();
});

ordenesRouter.get('/', requireRole('ADMIN', 'OPERATIVO', 'COMERCIAL'), asyncRoute(listarController));
ordenesRouter.get('/:id', requireRole('ADMIN', 'OPERATIVO', 'COMERCIAL'), asyncRoute(obtenerController));

// E-01: las 4 acciones operativas exigen además ser ADMIN o el OPERATIVO responsable de la orden
// (requireResponsableOrden; orden sin responsable => 403 para OPERATIVO).
ordenesRouter.patch('/:id/estado', requireRole('ADMIN', 'OPERATIVO'), requireResponsableOrden, asyncRoute(cambiarEstadoController));

// Bloque 3B: única vía a CANCELADA (PATCH /:id/estado ya no la admite, ver TRANSICIONES en el
// service) — exclusiva de ADMIN/COMERCIAL. OPERATIVO ya no puede cancelar ni su propia orden.
// Sin requireResponsableOrden: ni ADMIN ni COMERCIAL dependen del responsable de la orden.
ordenesRouter.patch('/:id/cancelar', requireRole('ADMIN', 'COMERCIAL'), asyncRoute(cancelarController));

// Bloque 3B: reprogramar la fecha PROGRAMADA de entrega — exclusiva de ADMIN/COMERCIAL, igual que
// entrega/cierre (bloque económico/comercial). OPERATIVO no reprograma fechas de entrega.
ordenesRouter.patch('/:id/fecha-entrega', requireRole('ADMIN', 'COMERCIAL'), asyncRoute(reprogramarFechaEntregaController));

// Bloque avance/evidencia: endpoint separado del cambio de estado genérico
// (decisión explícita). Exclusivo de ADMIN/OPERATIVO — COMERCIAL no
// reporta avance.
ordenesRouter.patch('/:id/avance', requireRole('ADMIN', 'OPERATIVO'), requireResponsableOrden, asyncRoute(actualizarAvanceController));

// Bloque MVP ficha técnica, decisiones 1-3: COMERCIAL puede crear la
// orden (crearOrden() ya exige por sí sola ACEPTADA + anticipo resuelto,
// D.7 — nada de eso cambia aquí); OPERATIVO sigue sin poder crear.
ordenesRouter.post('/', requireRole('ADMIN', 'COMERCIAL'), asyncRoute(crearController));
ordenesRouter.patch('/:id/responsable', requireRole('ADMIN'), asyncRoute(asignarResponsableController));

// Ficha técnica: lectura abierta a los 3 roles (ADMIN/OPERATIVO/COMERCIAL) por rol, pero
// OPERATIVO-05 acota esa lectura a la propia orden mediante `requireLecturaFichaTecnica` (corrige
// el hallazgo H1 de OPERATIVO-04: antes un OPERATIVO podía leer la ficha técnica de una orden
// ajena, o de una orden sin responsable). COMERCIAL y ADMIN conservan exactamente el mismo acceso
// que antes — solo cambia el caso OPERATIVO. Generarla sigue sin modificar ningún campo de la
// orden en sí (enriquecimiento de solo lectura/consulta), sin cambios en esa parte.
ordenesRouter.get('/:id/ficha-tecnica', requireRole('ADMIN', 'OPERATIVO', 'COMERCIAL'), requireLecturaFichaTecnica, asyncRoute(obtenerFichaController));
// E-01: la generación MANUAL de ficha deja de estar abierta a COMERCIAL. La generación interna
// (creación de orden) llama al service directamente y no pasa por esta ruta.
ordenesRouter.post('/:id/ficha-tecnica', requireRole('ADMIN', 'OPERATIVO'), requireResponsableOrden, asyncRoute(generarFichaController));

// Evidencias: lectura abierta a los 3 roles (ADMIN/OPERATIVO/COMERCIAL), pero OPERATIVO-03 acota
// esa lectura a la propia orden mediante `requireLecturaEvidencias` (corrige el hallazgo H1 de
// OPERATIVA-02: antes un OPERATIVO podía listar/descargar evidencias de una orden ajena). COMERCIAL
// y ADMIN conservan exactamente el mismo acceso que antes — solo cambia el caso OPERATIVO. Subir
// evidencia sigue exclusivo de ADMIN/OPERATIVO responsable (decisión explícita del bloque —
// COMERCIAL no sube evidencia), sin cambios.
ordenesRouter.get('/:id/evidencias', requireRole('ADMIN', 'OPERATIVO', 'COMERCIAL'), requireLecturaEvidencias, asyncRoute(listarEvidenciasController));
// E-01: requireResponsableOrden corre ANTES de multer (que se ejecuta dentro del controller), por lo
// que un usuario no autorizado nunca llega a procesar ni bufferizar el archivo.
ordenesRouter.post('/:id/evidencias', requireRole('ADMIN', 'OPERATIVO'), requireResponsableOrden, asyncRoute(subirEvidenciaController));
// H-B (auditoría post-V9): descarga/visualización del archivo real, mismos roles de lectura que el
// listado. OPERATIVO-03: `requireLecturaEvidencias` corre ANTES de resolver la evidencia y de leer
// el archivo del disco (nunca se llega a `sendFile` sin autorización).
ordenesRouter.get('/:id/evidencias/:evidenciaId', requireRole('ADMIN', 'OPERATIVO', 'COMERCIAL'), requireLecturaEvidencias, asyncRoute(descargarEvidenciaController));

// Bloque saldo/entrega/cierre: exclusivas ADMIN/COMERCIAL — OPERATIVO no
// maneja información económica ni gestiona entrega/cierre (decisión
// explícita). CERRADA deja de ser alcanzable por PATCH /:id/estado.
ordenesRouter.patch('/:id/entrega', requireRole('ADMIN', 'COMERCIAL'), asyncRoute(confirmarEntregaController));
ordenesRouter.patch('/:id/cerrar', requireRole('ADMIN', 'COMERCIAL'), asyncRoute(cerrarController));
