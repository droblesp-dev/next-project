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
import { pendientesController, marcarLeidoController } from '../controllers/chatLecturas.controller.js';
import {
  verParticipantesController,
  incorporarParticipanteController,
  retirarParticipanteController,
  reclamarHiloController,
} from '../controllers/chatParticipantes.controller.js';

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

// OPERATIVO-08 (corrige H1/H2 de OPERATIVO-07): mismo guardia de formato UUID ya usado en
// ordenes.routes.ts y alertas.routes.ts — un :id que no es UUID no puede corresponder a ninguna
// solicitud; se responde 404 controlado en lugar de dejar que PostgreSQL falle con "invalid input
// syntax for type uuid" (500). `router.param` protege por nombre de parámetro, no por ruta: cubre
// también `/:id/mensajes` y `/:id/mensajes` (POST), pero sin cambiar su comportamiento observable —
// ambas ya devolvían exactamente el mismo 404 `{"message":"Solicitud no encontrada."}` para un UUID
// inválido, vía la validación propia de `resolverContextoChat` (solicitudMensajes.service.ts), que
// no se toca ni se elimina.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
solicitudesRouter.param('id', (_req, res, next, valor: string) => {
  if (!UUID_RE.test(valor)) {
    res.status(404).json({ message: 'Solicitud no encontrada.' });
    return;
  }
  next();
});

// `:usuarioId` (retirar participante) debe ser un UUID; si no, no puede corresponder a ningún usuario.
solicitudesRouter.param('usuarioId', (_req, res, next, valor: string) => {
  if (!UUID_RE.test(valor)) {
    res.status(400).json({ message: 'El usuario no es válido o no participa en esta conversación.' });
    return;
  }
  next();
});

solicitudesRouter.post('/', publicoOAdminOComercial, asyncRoute(crearController));

// Contadores de mensajes pendientes del usuario (#7). `/mensajes/pendientes` tiene dos segmentos, así que no choca con
// `/:id` ni con `/:id/mensajes`; se declara antes de las rutas `/:id` por claridad.
solicitudesRouter.get('/mensajes/pendientes', requireAuth, requireRole('COMERCIAL', 'OPERATIVO'), asyncRoute(pendientesController));

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

// Chat asociado a la solicitud. #7: el chat es exclusivo de COMERCIAL y OPERATIVO; ADMIN no lo consulta ni por
// lectura (403). La autorización contextual (orden asociada, responsable, solo lectura por estado) y la
// privacidad por mensaje (respuestas de NexIA solo para su destinatario) se aplican en el service/repositorio.
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

// Participantes del chat (#7): quién participa en una solicitud sin orden. Solo COMERCIAL y OPERATIVO (ADMIN 403).
// Incorporar, retirar y reclamar son exclusivos de COMERCIAL; la autorización contextual se aplica en el service.
solicitudesRouter.get('/:id/participantes', requireAuth, requireRole('COMERCIAL', 'OPERATIVO'), asyncRoute(verParticipantesController));
solicitudesRouter.post('/:id/participantes', requireAuth, requireRole('COMERCIAL'), asyncRoute(incorporarParticipanteController));
solicitudesRouter.post('/:id/participantes/reclamar', requireAuth, requireRole('COMERCIAL'), asyncRoute(reclamarHiloController));
solicitudesRouter.delete('/:id/participantes/:usuarioId', requireAuth, requireRole('COMERCIAL'), asyncRoute(retirarParticipanteController));

// Marcador de lectura por usuario (#7): hasta qué mensaje ha leído. Solo COMERCIAL y OPERATIVO autorizados al hilo.
solicitudesRouter.post('/:id/mensajes/leidos', requireAuth, requireRole('COMERCIAL', 'OPERATIVO'), asyncRoute(marcarLeidoController));
