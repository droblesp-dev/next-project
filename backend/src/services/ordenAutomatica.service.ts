import { crearOrden, OrdenYaExisteError, OperativoPorDefectoInvalidoError } from './ordenes.service.js';
import { generarFicha } from './fichaTecnica.service.js';
import type { Orden } from '../repositories/ordenes.repository.js';

// Bloque 1.1: creación automática de la orden de una cotización ACEPTADA.
// Reutiliza crearOrden() tal cual (cotización ACEPTADA, anticipo NO_APLICA o
// VALIDADO, OPERATIVO por defecto válido, unicidad por cotizacion_id) — no
// duplica ninguna regla. Se invoca desde dos puntos: la aceptación pública
// (anticipo NO_APLICA) y la validación del anticipo por ADMIN/COMERCIAL.
//
// NUNCA lanza: la aceptación del cliente y la validación del anticipo ya
// están confirmadas cuando esta función corre y no deben revertirse ni
// fallar por un problema al crear la orden. Si no se puede crear (p. ej. no
// hay OPERATIVO por defecto válido), no se crea ninguna orden, el motivo
// queda en el log del servidor y ADMIN/COMERCIAL puede crearla luego desde
// ÓRDENES → NUEVA ORDEN (POST /api/ordenes), que sigue disponible.
export type OrigenOrdenAutomatica = 'ACEPTACION' | 'ANTICIPO_VALIDADO';

export async function crearOrdenAutomatica(
  cotizacionId: string,
  origen: OrigenOrdenAutomatica
): Promise<Orden | null> {
  let orden: Orden;
  try {
    orden = await crearOrden({ cotizacionId, descripcion: null, fechaEntrega: null });
  } catch (error) {
    if (error instanceof OrdenYaExisteError) {
      // Carrera con la creación manual (o reintento): la unicidad de
      // ordenes.cotizacion_id ya impidió el duplicado; no es un fallo.
      console.info(`[orden-automatica] ${origen}: ya existe una orden para la cotización ${cotizacionId}; no se duplica.`);
    } else if (error instanceof OperativoPorDefectoInvalidoError) {
      console.error(
        `[orden-automatica] ${origen}: NO se creó la orden de la cotización ${cotizacionId} — OPERATIVO por defecto inválido (${error.motivo}). La cotización sigue ACEPTADA; ADMIN/COMERCIAL puede crearla manualmente cuando se corrija la configuración.`
      );
    } else {
      console.error(
        `[orden-automatica] ${origen}: NO se creó la orden de la cotización ${cotizacionId} —`,
        error instanceof Error ? error.message : error
      );
    }
    return null;
  }

  // La ficha técnica (Gemini) se genera fuera de la petición: no se espera y
  // cualquier fallo se registra y se ignora, igual que en la creación manual
  // (ordenes.controller.ts), donde tampoco afecta a la orden ya creada. Así la
  // aceptación pública nunca depende de una dependencia externa.
  void generarFicha(orden.id).catch((fichaError: unknown) => {
    console.error(
      '[orden-automatica] No se pudo generar automáticamente la ficha técnica de la orden',
      orden.id,
      '-',
      fichaError instanceof Error ? fichaError.message : fichaError
    );
  });

  return orden;
}
