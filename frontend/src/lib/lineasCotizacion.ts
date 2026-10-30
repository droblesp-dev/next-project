// Líneas de detalle de una cotización (requerimiento 4): lógica del formulario. El BACKEND es la única autoridad de los importes;
// aquí solo se calcula una vista previa con EXACTAMENTE el mismo algoritmo (aritmética entera con BigInt, mitad hacia arriba) para
// que lo que se ve al editar coincida al céntimo con lo que se guarda y se imprime, y se validan los datos antes de enviarlos.
export const MAX_LINEAS = 50;
export const MAX_DESCRIPCION = 200;
const MAX_CANTIDAD_MILESIMAS = 999_999_999_999n;
const MAX_PRECIO_CENTAVOS = 999_999_999_999n;
const MAX_SUBTOTAL_CENTAVOS = 800_000_000_000n;

export interface LineaFormulario {
  // Identificador local (solo para la interfaz; nunca se envía).
  clave: string;
  descripcion: string;
  cantidad: string;
  precio: string;
}

export interface LineaDetalle {
  descripcion: string;
  cantidad: string;
  precio_unitario: string;
  subtotal: string;
}

let contador = 0;
export function nuevaClave(): string {
  contador += 1;
  return `l${Date.now().toString(36)}${contador}`;
}

export function lineaVacia(): LineaFormulario {
  return { clave: nuevaClave(), descripcion: '', cantidad: '1', precio: '' };
}

// Acepta «12», «12.5» y «12,5»; hasta `decimales` decimales; null si no es válido. Devuelve el entero escalado.
function aEntero(texto: string, decimales: number): bigint | null {
  const m = /^(\d{1,12})(?:[.,](\d{1,12}))?$/.exec(texto.trim());
  if (!m) return null;
  const fraccion = m[2] ?? '';
  if (fraccion.length > decimales) return null;
  return BigInt(m[1] + fraccion.padEnd(decimales, '0'));
}

function formatear(entero: bigint, decimales: number): string {
  const t = entero.toString().padStart(decimales + 1, '0');
  return `${t.slice(0, t.length - decimales)}.${t.slice(t.length - decimales)}`;
}

export function subtotalLineaCentavos(cantidad: string, precio: string): bigint | null {
  const c = aEntero(cantidad, 3);
  const p = aEntero(precio, 2);
  if (c === null || p === null || c <= 0n || c > MAX_CANTIDAD_MILESIMAS || p > MAX_PRECIO_CENTAVOS) return null;
  const s = (c * p + 500n) / 1000n;
  return s > MAX_SUBTOTAL_CENTAVOS ? null : s;
}

// Mensajes de validación por línea (vacío si todo es correcto). Los mismos criterios del backend.
export function validarLineas(lineas: LineaFormulario[]): string[] {
  const errores: string[] = [];
  if (lineas.length === 0) errores.push('Agregue al menos una línea de detalle.');
  if (lineas.length > MAX_LINEAS) errores.push(`Máximo ${MAX_LINEAS} líneas por cotización.`);
  lineas.forEach((l, i) => {
    const n = i + 1;
    const desc = l.descripcion.replace(/\s+/g, ' ').trim();
    if (!desc || desc.length > MAX_DESCRIPCION) errores.push(`Línea ${n}: la descripción es obligatoria (hasta ${MAX_DESCRIPCION} caracteres).`);
    const c = aEntero(l.cantidad, 3);
    if (c === null || c <= 0n || c > MAX_CANTIDAD_MILESIMAS) errores.push(`Línea ${n}: la cantidad debe ser mayor que 0 (hasta 3 decimales).`);
    const p = aEntero(l.precio, 2);
    if (p === null || p > MAX_PRECIO_CENTAVOS) errores.push(`Línea ${n}: el precio unitario debe ser 0 o mayor (hasta 2 decimales).`);
    if (c !== null && p !== null && c > 0n && subtotalLineaCentavos(l.cantidad, l.precio) === null) errores.push(`Línea ${n}: el subtotal excede el máximo permitido.`);
  });
  return errores;
}

export interface ResumenLineas {
  subtotal: number;
  iva: number;
  total: number;
  anticipo: number;
  saldo: number;
  subtotalesLinea: Array<string | null>;
}

const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

// Vista previa con las reglas vigentes: IVA global (0 o 15), anticipo (0, 50 o 75). Las líneas inválidas no suman.
export function resumirLineas(lineas: LineaFormulario[], ivaPorcentaje: number, anticipoPorcentaje: number): ResumenLineas {
  let acumulado = 0n;
  const subtotalesLinea = lineas.map((l) => {
    const s = subtotalLineaCentavos(l.cantidad, l.precio);
    if (s === null) return null;
    acumulado += s;
    return formatear(s, 2);
  });
  const subtotal = Number(acumulado) / 100;
  const iva = round2(subtotal * (ivaPorcentaje / 100));
  const total = round2(subtotal + iva);
  const anticipo = round2(total * (anticipoPorcentaje / 100));
  return { subtotal, iva, total, anticipo, saldo: round2(total - anticipo), subtotalesLinea };
}

// Cuerpo `items` del POST/PATCH: textos normalizados con punto decimal; los importes los calcula el backend.
export function lineasParaEnviar(lineas: LineaFormulario[]): Array<{ descripcion: string; cantidad: string; precio_unitario: string }> {
  return lineas.map((l) => ({
    descripcion: l.descripcion.replace(/\s+/g, ' ').trim(),
    cantidad: l.cantidad.trim().replace(',', '.'),
    precio_unitario: l.precio.trim().replace(',', '.'),
  }));
}

// «2.500» -> «2,5»; «10.000» -> «10». Sin dato -> «—».
export function formatearCantidad(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('es-EC', { maximumFractionDigits: 3 });
}

// Líneas del formulario a partir de las guardadas (edición de un borrador con líneas).
export function lineasDesdeDetalle(items: LineaDetalle[]): LineaFormulario[] {
  return items.map((i) => ({ clave: nuevaClave(), descripcion: i.descripcion, cantidad: String(Number(i.cantidad)), precio: i.precio_unitario }));
}

// Borrador histórico SIN líneas: una línea DERIVADA y editable (servicio × 1 × valor actual). No se guarda nada hasta que el usuario
// confirma la edición con líneas.
export function lineaDerivada(servicio: string | null | undefined, valor: string | null | undefined): LineaFormulario {
  const subtotal = valor === null || valor === undefined || valor === '' ? NaN : Number(valor);
  return {
    clave: nuevaClave(),
    descripcion: (servicio ?? '').trim() || 'Servicio solicitado',
    cantidad: '1',
    precio: Number.isFinite(subtotal) ? subtotal.toFixed(2) : '',
  };
}
