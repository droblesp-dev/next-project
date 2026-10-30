import { describe, expect, it } from 'vitest';
import { LineasInvalidasError, MAX_DESCRIPCION, MAX_LINEAS, normalizarLineas, subtotalLineaCentavos } from './cotizacionItems.js';

const linea = (descripcion: unknown, cantidad: unknown, precio_unitario: unknown) => ({ descripcion, cantidad, precio_unitario });
const mensajes = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof LineasInvalidasError) return e.detalles;
    throw e;
  }
  return [];
};

describe('líneas de detalle de la cotización: cálculo exacto', () => {
  it('calcula el subtotal de cada línea y la suma de la cotización (ejemplo aprobado: 10 × 12,50 + 2,5 × 10,00 = 150,00)', () => {
    const r = normalizarLineas([linea('Torneado', 10, '12.50'), linea('Acabado', '2.5', 10)]);
    expect(r.lineas).toEqual([
      { orden: 1, descripcion: 'Torneado', cantidad: '10.000', precioUnitario: '12.50', subtotal: '125.00' },
      { orden: 2, descripcion: 'Acabado', cantidad: '2.500', precioUnitario: '10.00', subtotal: '25.00' },
    ]);
    expect(r.subtotal).toBe(150);
    expect(r.subtotalCentavos).toBe(15000n);
  });

  it('redondea la mitad hacia arriba EXACTAMENTE como PostgreSQL (2,675 × 1,00 = 2,68; con coma flotante daría 2,67)', () => {
    expect(subtotalLineaCentavos(2675n, 100n)).toBe(268n);
    expect(normalizarLineas([linea('x', '2.675', '1.00')]).lineas[0].subtotal).toBe('2.68');
    expect(normalizarLineas([linea('x', '1.005', '1')]).lineas[0].subtotal).toBe('1.01');
    expect(normalizarLineas([linea('x', '0.001', '0.50')]).lineas[0].subtotal).toBe('0.00');
    expect(normalizarLineas([linea('x', '0.010', '0.50')]).lineas[0].subtotal).toBe('0.01');
  });

  it('suma los subtotales ya redondeados de cada línea (lo impreso siempre cuadra con el total)', () => {
    const r = normalizarLineas([linea('a', '0.333', '10.00'), linea('b', '0.333', '10.00'), linea('c', '0.334', '10.00')]);
    expect(r.lineas.map((l) => l.subtotal)).toEqual(['3.33', '3.33', '3.34']);
    expect(r.subtotal).toBe(10);
  });

  it('admite cantidades con hasta 3 decimales mayores que 0, precios 0 y subtotal 0', () => {
    const r = normalizarLineas([linea('Muestra sin costo', '1', 0)]);
    expect(r.lineas[0]).toMatchObject({ cantidad: '1.000', precioUnitario: '0.00', subtotal: '0.00' });
    expect(r.subtotal).toBe(0);
  });

  it('rechaza cantidades cero o negativas, con más de 3 decimales o no numéricas, sin redondear en silencio', () => {
    for (const mala of [0, '0', '0.000', -1, '-2', '1.2345', 'abc', '', null, undefined, '1e3', NaN, Infinity]) {
      expect(mensajes(() => normalizarLineas([linea('x', mala, 1)])), `cantidad ${String(mala)}`).toHaveLength(1);
    }
  });

  it('rechaza precios negativos, con más de 2 decimales o no numéricos', () => {
    for (const malo of [-0.01, '-1', '1.234', 'x', '', null, undefined, '1e2']) {
      expect(mensajes(() => normalizarLineas([linea('x', 1, malo)])), `precio ${String(malo)}`).toHaveLength(1);
    }
  });

  it('valida la descripción: obligatoria, normaliza espacios y admite hasta 200 caracteres', () => {
    expect(normalizarLineas([linea('  Fresado   CNC \n pieza  ', 1, 1)]).lineas[0].descripcion).toBe('Fresado CNC pieza');
    expect(normalizarLineas([linea('a'.repeat(MAX_DESCRIPCION), 1, 1)]).lineas).toHaveLength(1);
    for (const mala of ['', '   ', 'a'.repeat(MAX_DESCRIPCION + 1), 5, null, undefined]) {
      expect(mensajes(() => normalizarLineas([linea(mala, 1, 1)]))[0]).toMatch(/descripción/);
    }
  });

  it('exige de 1 a 50 líneas', () => {
    expect(mensajes(() => normalizarLineas([]))[0]).toMatch(/al menos una/);
    expect(mensajes(() => normalizarLineas(undefined))[0]).toMatch(/al menos una/);
    expect(mensajes(() => normalizarLineas('x'))[0]).toMatch(/al menos una/);
    expect(normalizarLineas(Array.from({ length: MAX_LINEAS }, (_, i) => linea(`l${i}`, 1, 1))).lineas).toHaveLength(MAX_LINEAS);
    expect(mensajes(() => normalizarLineas(Array.from({ length: MAX_LINEAS + 1 }, (_, i) => linea(`l${i}`, 1, 1))))[0]).toMatch(/máximo 50/);
  });

  it('informa TODOS los errores con el número de línea', () => {
    const detalles = mensajes(() => normalizarLineas([linea('ok', 1, 1), linea('', 0, -1), 'basura']));
    expect(detalles.some((d) => d.startsWith('Línea 2: la descripción'))).toBe(true);
    expect(detalles.some((d) => d.startsWith('Línea 2: la cantidad'))).toBe(true);
    expect(detalles.some((d) => d.startsWith('Línea 2: el precio'))).toBe(true);
    expect(detalles.some((d) => d.startsWith('Línea 3: formato'))).toBe(true);
    expect(detalles.some((d) => d.startsWith('Línea 1'))).toBe(false);
  });

  it('rechaza importes que no caben en la base de datos (numeric(12,2)) en lugar de truncarlos', () => {
    expect(mensajes(() => normalizarLineas([linea('x', '999999999.999', '9999999999.99')]))[0]).toMatch(/excede/);
    expect(mensajes(() => normalizarLineas([linea('x', 1, '10000000000.00')]))[0]).toMatch(/precio/);
    expect(mensajes(() => normalizarLineas([linea('a', 1, '5000000000.00'), linea('b', 1, '5000000000.00')]))[0]).toMatch(/excede/);
  });

  it('el subtotal exacto alimenta las reglas vigentes de IVA, anticipo y saldo sin cambiarlas (ejemplo: 150,00 → IVA 22,50 → total 172,50)', () => {
    const { subtotal } = normalizarLineas([linea('Torneado', 10, '12.50'), linea('Acabado', '2.5', 10)]);
    const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
    const iva = round2(subtotal * 0.15);
    const total = round2(subtotal + iva);
    expect([subtotal, iva, total, round2(total * 0.5), round2(total - round2(total * 0.5))]).toEqual([150, 22.5, 172.5, 86.25, 86.25]);
  });
});
