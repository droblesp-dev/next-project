import type { Request, Response, NextFunction } from 'express';
import { findById } from '../repositories/ordenes.repository.js';

// E-01: control de ejecución por responsable. Se coloca DESPUÉS de
// requireAuth/requireRole en las rutas que ejecutan acciones operativas sobre
// una orden (estado, avance, evidencias, ficha técnica manual) y ANTES de
// cualquier procesamiento del cuerpo (p. ej. multer en evidencias).
//
//   ADMIN     -> permitido en cualquier orden.
//   OPERATIVO -> solo si ordenes.responsable_id === req.user.sub. Una orden de
//                otro OPERATIVO o sin responsable (NULL) -> 403.
//   otros     -> 403 (defensa en profundidad; requireRole ya los filtra).
//
// Orden inexistente: se conserva el 404 que ya devolvían los controllers.
// Un id que no es UUID no puede corresponder a ninguna orden: se deja pasar
// para que el flujo existente responda exactamente como antes (no se ejecuta
// ninguna acción porque no hay orden).
//
// Las llamadas internas a los services (creación automática/manual de orden
// -> generarFicha) no pasan por este middleware, así que no se ven afectadas.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ALERTAS-02 (decisión 5A): regla de autorización pura, extraída para poder reutilizarla desde
// otro módulo cuyo recurso en la URL no es directamente la orden (alertas.service.ts::atenderAlerta,
// donde primero hay que resolver alerta -> orden). Mismo criterio exacto que este middleware ya
// aplicaba, sin duplicar la lógica: ADMIN siempre; OPERATIVO solo si es el responsable_id actual de
// la orden (una orden sin responsable, o de otro OPERATIVO, no autoriza).
export function esResponsableOAdmin(usuario: { sub: string; rol: string }, orden: { responsable_id: string | null }): boolean {
  if (usuario.rol === 'ADMIN') {
    return true;
  }
  if (usuario.rol !== 'OPERATIVO') {
    return false;
  }
  return orden.responsable_id !== null && orden.responsable_id === usuario.sub;
}

export async function requireResponsableOrden(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'No autenticado.' });
      return;
    }

    if (req.user.rol === 'ADMIN') {
      next();
      return;
    }

    if (req.user.rol !== 'OPERATIVO') {
      res.status(403).json({ message: 'No autorizado.' });
      return;
    }

    if (!UUID_RE.test(req.params.id)) {
      next();
      return;
    }

    const orden = await findById(req.params.id);
    if (!orden) {
      res.status(404).json({ message: 'Orden no encontrada.' });
      return;
    }

    if (!esResponsableOAdmin(req.user, orden)) {
      res.status(403).json({ message: 'No autorizado: la orden no está asignada a este usuario.' });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

// OPERATIVO-03 (corrige el hallazgo H1 de OPERATIVA-02): autorización específica para LEER
// evidencias (listar y descargar) — distinta de `requireResponsableOrden` porque aquí COMERCIAL sí
// debe conservar acceso (a diferencia de las 4 acciones de ejecución de E-01, donde COMERCIAL
// nunca participa). Por eso no se reutiliza `requireResponsableOrden` tal cual: bloquearía a
// COMERCIAL. Se reutiliza en cambio `esResponsableOAdmin` para la parte que sí es idéntica a E-01
// (ADMIN siempre; OPERATIVO solo si es el responsable_id actual; sin responsable -> no autoriza).
//
//   ADMIN     -> permitido siempre.
//   COMERCIAL -> permitido siempre (mantiene su lectura general de órdenes, sin cambios).
//   OPERATIVO -> solo si ordenes.responsable_id === req.user.sub. Una orden de otro OPERATIVO o
//                sin responsable (NULL) -> 403.
//   otros     -> 403 (defensa en profundidad; requireRole ya los filtra).
//
// Mismo criterio que requireResponsableOrden para orden inexistente / id no-UUID (ver comentarios
// arriba). Se coloca en la ruta ANTES del controller, por lo que ninguna consulta de evidencias ni
// lectura de archivo en disco ocurre para un usuario no autorizado.
export async function requireLecturaEvidencias(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'No autenticado.' });
      return;
    }

    if (req.user.rol === 'ADMIN' || req.user.rol === 'COMERCIAL') {
      next();
      return;
    }

    if (req.user.rol !== 'OPERATIVO') {
      res.status(403).json({ message: 'No autorizado.' });
      return;
    }

    if (!UUID_RE.test(req.params.id)) {
      next();
      return;
    }

    const orden = await findById(req.params.id);
    if (!orden) {
      res.status(404).json({ message: 'Orden no encontrada.' });
      return;
    }

    if (!esResponsableOAdmin(req.user, orden)) {
      res.status(403).json({ message: 'No autorizado: las evidencias de esta orden no están disponibles para este usuario.' });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

// OPERATIVO-05 (corrige el hallazgo H1 de OPERATIVO-04): la lectura de la ficha técnica
// (GET /:id/ficha-tecnica) necesita EXACTAMENTE la misma regla que ya aplicamos a la lectura de
// evidencias en OPERATIVO-03 — ADMIN y COMERCIAL siempre; OPERATIVO solo si es el responsable_id
// actual de la orden; sin responsable o de otro OPERATIVO -> 403. Por eso no se crea una función
// nueva ni se reutiliza `requireResponsableOrden` (que bloquearía a COMERCIAL): se reutiliza la
// implementación de `requireLecturaEvidencias` tal cual, mediante un alias con nombre propio, para
// que la ruta de ficha técnica se lea con claridad sobre qué protege sin duplicar ninguna lógica.
export const requireLecturaFichaTecnica = requireLecturaEvidencias;
