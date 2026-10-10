import type { Request, Response, NextFunction } from 'express';

// CORRECCIÓN FASE 4 (hallazgo #1): mismo guard de formato UUID que ya usaban por separado
// ordenes.routes.ts, alertas.routes.ts y solicitudes.routes.ts (cada uno con su propia copia del
// regex y del router.param) — un :id que no es UUID no puede corresponder a ningún registro; se
// responde 404 controlado en lugar de dejar que PostgreSQL falle con "invalid input syntax for
// type uuid" (500, vía el errorHandler genérico de server.ts). Se extrae aquí como una única
// fuente reutilizable para los routers que todavía no tenían este guard (cotizaciones,
// analisis-ia, usuarios, leads) — no se duplica el regex una cuarta vez.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fábrica de un handler para router.param(nombreParametro, ...): cada router sigue decidiendo su
// propio mensaje de "no encontrado" (coincide exactamente con el que ya usan sus controllers para
// un UUID válido pero inexistente, igual que en los 3 routers ya protegidos).
export function validarFormatoUuid(mensajeNoEncontrado: string) {
  return (_req: Request, res: Response, next: NextFunction, valor: string): void => {
    if (!UUID_RE.test(valor)) {
      res.status(404).json({ message: mensajeNoEncontrado });
      return;
    }
    next();
  };
}
