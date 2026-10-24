// Presentación de la cantidad de una solicitud. `solicitudes.cantidad` guarda 1 tanto para
// «1 unidad real» como para «el cliente marcó Aún no lo sé»; solo `especificaciones` distingue
// ambos casos (texto armado únicamente por solicitudes.service.ts::crearSolicitud). Aquí solo se
// LEE ese texto para mostrar un guion cuando la cantidad aún no se conoce: no se toca la base de
// datos ni `cantidad_desconocida`. Subcadena estable (no el texto completo) para no depender de la
// puntuación exacta.
export const MARCA_CANTIDAD_DESCONOCIDA = 'el cliente indicó que aún no la conoce';

export const TEXTO_CANTIDAD_DESCONOCIDA = '—';

export function esCantidadDesconocida(especificaciones: string | null | undefined): boolean {
  return Boolean(especificaciones?.includes(MARCA_CANTIDAD_DESCONOCIDA));
}

// Cantidad a mostrar: el número, o un guion si el cliente indicó que todavía no la conoce.
export function formatearCantidad(cantidad: number, especificaciones: string | null | undefined): string {
  return esCantidadDesconocida(especificaciones) ? TEXTO_CANTIDAD_DESCONOCIDA : String(cantidad);
}
