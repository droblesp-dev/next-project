// #11: número de solicitud (SOL) y de cotización (COT) de origen de una orden. Los entrega el backend en la propia
// orden; es null en registros anteriores a la numeración, y entonces se muestra «—» sin inventar nada.
export const SIN_NUMERO = '—';
export const AYUDA_SIN_NUMERO = 'Registro anterior a la numeración: no tiene número asignado.';

export function referenciaOrigen(codigo: string | null | undefined): string {
  return codigo && codigo.trim() ? codigo.trim() : SIN_NUMERO;
}

export function ayudaReferencia(codigo: string | null | undefined): string | undefined {
  return codigo && codigo.trim() ? undefined : AYUDA_SIN_NUMERO;
}
