// Preparación de los términos de búsqueda parcial (LIKE) que se envían a PostgreSQL.
//
// La búsqueda no distingue mayúsculas ni tildes y encuentra el término en cualquier parte del
// texto («1» encuentra «SOL-000491», un teléfono, un importe o una fecha). Los números legibles
// (SOL-000491, COT-000001, ORD-000319) se comparan además sin guiones ni espacios, por lo que
// «sol000491» o «sol 000491» encuentran lo mismo que «SOL-000491».

export const LONGITUD_MAXIMA_TERMINO = 100;

// Misma tabla de equivalencias que usa el SQL (translate) para que ambos lados coincidan.
export const ORIGEN_ACENTOS = 'áàäâãéèëêíìïîóòöôõúùüûñç';
export const DESTINO_ACENTOS = 'aaaaaeeeeiiiiooooouuuunc';

// Minúsculas, sin tildes y con «_» como espacio (los estados son «EN_REVISION» y se leen «en revisión»).
export function normalizarTermino(termino: string): string {
  return termino
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim();
}

// Escapa los comodines de LIKE para que el término se busque literalmente.
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Patrón para texto libre: «%término%».
export function patronParcial(termino: string): string {
  return `%${escaparLike(normalizarTermino(termino))}%`;
}

// Patrón para números legibles: solo letras y dígitos. null si el término no los tiene (p. ej. «-»),
// en cuyo caso no se compara contra los números.
export function patronCodigo(termino: string): string | null {
  const compacto = normalizarTermino(termino).replace(/[^a-z0-9]/g, '');
  return compacto === '' ? null : `%${compacto}%`;
}

// Valida el término recibido por query string: texto de 1 a LONGITUD_MAXIMA_TERMINO caracteres.
export function terminoValido(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const recortado = valor.trim();
  if (recortado === '' || recortado.length > LONGITUD_MAXIMA_TERMINO) return null;
  return recortado;
}
