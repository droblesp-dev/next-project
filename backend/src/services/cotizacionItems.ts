// Líneas de detalle de una cotización (requerimiento 4, alternativa A). Módulo PURO: valida y calcula las líneas con aritmética
// entera exacta (BigInt), sin coma flotante, para que el subtotal de cada línea coincida SIEMPRE con la restricción de la base
// de datos (`subtotal = round(cantidad * precio_unitario, 2)`, redondeo de PostgreSQL: mitad hacia arriba en números positivos).
// Con coma flotante, por ejemplo, 2,675 × 1,00 daría 2,67 en JavaScript y 2,68 en PostgreSQL.
//
// Reglas (decisiones aprobadas): de 1 a 50 líneas; descripción de 1 a 200 caracteres; cantidad mayor que 0 con hasta 3 decimales;
// precio unitario mayor o igual que 0 con hasta 2 decimales (se permite 0); subtotal de la cotización = suma de los subtotales de
// línea ya redondeados (se permite 0). Nada se redondea en silencio: un valor con más decimales de los permitidos se rechaza.

export const MAX_LINEAS = 50;
export const MAX_DESCRIPCION = 200;
// numeric(12,3) y numeric(12,2): 9 y 10 dígitos enteros.
const MAX_CANTIDAD_MILESIMAS = 999_999_999_999n;
const MAX_PRECIO_CENTAVOS = 999_999_999_999n;
// El subtotal máximo deja margen para que IVA (15 %) y total sigan cabiendo en numeric(12,2).
const MAX_SUBTOTAL_CENTAVOS = 800_000_000_000n;

export class LineasInvalidasError extends Error {
  constructor(public readonly detalles: string[]) {
    super(detalles.join(' '));
  }
}

export interface LineaCalculada {
  orden: number;
  descripcion: string;
  // Cadenas decimales exactas, tal como se guardan (NUMERIC): cantidad con 3 decimales, importes con 2.
  cantidad: string;
  precioUnitario: string;
  subtotal: string;
}

export interface ResultadoLineas {
  lineas: LineaCalculada[];
  subtotalCentavos: bigint;
  // Subtotal de la cotización como número con 2 decimales exactos (centavos / 100), listo para las reglas vigentes de IVA.
  subtotal: number;
}

function aTextoDecimal(valor: unknown): string | null {
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return null;
    const texto = String(valor);
    return /e/i.test(texto) ? null : texto; // notación científica: se rechaza
  }
  if (typeof valor === 'string') return valor.trim();
  return null;
}

// «12.5» -> 12500n (milésimas) con hasta `decimales` decimales; null si no es válido.
function aEnteroEscalado(texto: string | null, decimales: number): bigint | null {
  if (texto === null) return null;
  const m = /^(\d{1,12})(?:\.(\d{1,12}))?$/.exec(texto);
  if (!m) return null;
  const fraccion = m[2] ?? '';
  if (fraccion.length > decimales) return null;
  return BigInt(m[1] + fraccion.padEnd(decimales, '0'));
}

function formatear(entero: bigint, decimales: number): string {
  const texto = entero.toString().padStart(decimales + 1, '0');
  return `${texto.slice(0, texto.length - decimales)}.${texto.slice(texto.length - decimales)}`;
}

export function normalizarDescripcion(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpia = valor.replace(/\s+/g, ' ').trim();
  return limpia && limpia.length <= MAX_DESCRIPCION ? limpia : null;
}

// Producto exacto en milésimas × centavos (unidades de 10⁻⁵) -> centavos, redondeando la mitad hacia arriba (valores positivos).
export function subtotalLineaCentavos(cantidadMilesimas: bigint, precioCentavos: bigint): bigint {
  return (cantidadMilesimas * precioCentavos + 500n) / 1000n;
}

export function normalizarLineas(entrada: unknown): ResultadoLineas {
  if (!Array.isArray(entrada) || entrada.length === 0) {
    throw new LineasInvalidasError(['La cotización necesita al menos una línea de detalle.']);
  }
  if (entrada.length > MAX_LINEAS) {
    throw new LineasInvalidasError([`La cotización admite como máximo ${MAX_LINEAS} líneas.`]);
  }

  const errores: string[] = [];
  const lineas: LineaCalculada[] = [];
  let total = 0n;

  entrada.forEach((bruta, i) => {
    const n = i + 1;
    if (bruta === null || typeof bruta !== 'object' || Array.isArray(bruta)) {
      errores.push(`Línea ${n}: formato inválido.`);
      return;
    }
    const { descripcion, cantidad, precio_unitario } = bruta as Record<string, unknown>;
    const desc = normalizarDescripcion(descripcion);
    if (desc === null) errores.push(`Línea ${n}: la descripción es obligatoria y admite hasta ${MAX_DESCRIPCION} caracteres.`);

    const cant = aEnteroEscalado(aTextoDecimal(cantidad), 3);
    if (cant === null || cant <= 0n || cant > MAX_CANTIDAD_MILESIMAS) {
      errores.push(`Línea ${n}: la cantidad debe ser un número mayor que 0 con hasta 3 decimales.`);
    }
    const precio = aEnteroEscalado(aTextoDecimal(precio_unitario), 2);
    if (precio === null || precio > MAX_PRECIO_CENTAVOS) {
      errores.push(`Línea ${n}: el precio unitario debe ser un número mayor o igual que 0 con hasta 2 decimales.`);
    }
    if (desc === null || cant === null || cant <= 0n || cant > MAX_CANTIDAD_MILESIMAS || precio === null || precio > MAX_PRECIO_CENTAVOS) return;

    const subtotal = subtotalLineaCentavos(cant, precio);
    if (subtotal > MAX_SUBTOTAL_CENTAVOS) {
      errores.push(`Línea ${n}: el subtotal de la línea excede el máximo permitido.`);
      return;
    }
    total += subtotal;
    lineas.push({ orden: n, descripcion: desc, cantidad: formatear(cant, 3), precioUnitario: formatear(precio, 2), subtotal: formatear(subtotal, 2) });
  });

  if (errores.length === 0 && total > MAX_SUBTOTAL_CENTAVOS) {
    errores.push('El subtotal de la cotización excede el máximo permitido.');
  }
  if (errores.length > 0) {
    throw new LineasInvalidasError(errores);
  }
  return { lineas, subtotalCentavos: total, subtotal: Number(total) / 100 };
}
