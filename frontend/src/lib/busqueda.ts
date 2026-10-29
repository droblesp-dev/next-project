// Ayudas de búsqueda compartidas por los listados de la sección privada (solicitudes, cotizaciones,
// órdenes, alertas, leads). Los números legibles (SOL-000491, COT-000001, ORD-…) se buscan sin
// distinguir mayúsculas, guiones ni espacios: «sol-000491», «SOL 000491», «sol000491» y «491»
// encuentran lo mismo.

// Minúsculas y sin tildes, para que «cotizacion» encuentre «Cotización».
export function normalizarTexto(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Solo letras y dígitos: «SOL-000491» -> «sol000491».
export function compactarCodigo(texto: string): string {
  return normalizarTexto(texto).replace(/[^a-z0-9]/g, '');
}

// El término (ya recortado) aparece dentro del texto, sin distinguir mayúsculas ni tildes.
export function coincideTexto(termino: string, texto: string | null | undefined): boolean {
  if (!texto) return false;
  return normalizarTexto(texto).includes(normalizarTexto(termino));
}

// El término aparece dentro de un número legible, tolerando guiones y espacios. Un término sin
// letras ni dígitos (por ejemplo «-») no coincide con nada.
// «sol493» / «cot 3» / «ord327» (prefijo + número sin ceros) se leen como el número completo de 6 dígitos, igual que
// en el servidor (busquedaPatron.ts).
function completarNumeroCodigo(compacto: string): string {
  const m = /^(sol|cot|ord)([1-9]\d{0,4})$/.exec(compacto);
  return m ? `${m[1]}${m[2].padStart(6, '0')}` : compacto;
}

export function coincideCodigo(termino: string, codigo: string | null | undefined): boolean {
  if (!codigo) return false;
  const buscado = completarNumeroCodigo(compactarCodigo(termino));
  return buscado !== '' && compactarCodigo(codigo).includes(buscado);
}

// Atajo: coincide si el término está en alguno de los textos o de los números legibles.
export function coincideBusqueda(
  termino: string,
  textos: (string | null | undefined)[],
  codigos: (string | null | undefined)[] = []
): boolean {
  return textos.some((t) => coincideTexto(termino, t)) || codigos.some((c) => coincideCodigo(termino, c));
}
