import { describe, expect, it } from 'vitest';
import {
  formatearCantidad,
  lineaDerivada,
  lineasDesdeDetalle,
  lineasParaEnviar,
  MAX_LINEAS,
  resumirLineas,
  subtotalLineaCentavos,
  validarLineas,
  type LineaFormulario,
} from './lineasCotizacion';

const L = (descripcion: string, cantidad: string, precio: string): LineaFormulario => ({ clave: descripcion, descripcion, cantidad, precio });

describe('líneas de la cotización en el formulario (#4)', () => {
  it('calcula el subtotal exacto con el mismo redondeo del backend (2,675 × 1,00 = 2,68)', () => {
    expect(subtotalLineaCentavos('2.675', '1.00')).toBe(268n);
    expect(subtotalLineaCentavos('2,675', '1,00')).toBe(268n); // coma decimal
    expect(subtotalLineaCentavos('10', '12.50')).toBe(12500n);
    expect(subtotalLineaCentavos('0.001', '0.50')).toBe(0n);
    expect(subtotalLineaCentavos('0', '1')).toBeNull();
    expect(subtotalLineaCentavos('1', '1.234')).toBeNull();
  });

  it('el resumen aplica las reglas vigentes (ejemplo aprobado: 150,00 → IVA 22,50 → total 172,50 → anticipo 86,25)', () => {
    const r = resumirLineas([L('Torneado', '10', '12.50'), L('Acabado', '2.5', '10')], 15, 50);
    expect([r.subtotal, r.iva, r.total, r.anticipo, r.saldo]).toEqual([150, 22.5, 172.5, 86.25, 86.25]);
    expect(r.subtotalesLinea).toEqual(['125.00', '25.00']);
  });

  it('IVA 0 y subtotal 0 (precio 0) son válidos; las líneas inválidas no suman', () => {
    expect(resumirLineas([L('Muestra', '1', '0')], 0, 0)).toMatchObject({ subtotal: 0, iva: 0, total: 0, anticipo: 0, saldo: 0 });
    const r = resumirLineas([L('ok', '1', '5'), L('mala', 'x', '5')], 15, 0);
    expect(r.subtotal).toBe(5);
    expect(r.subtotalesLinea).toEqual(['5.00', null]);
  });

  it('valida igual que el backend: descripción, cantidad > 0 con 3 decimales, precio >= 0 con 2 decimales, 1 a 50 líneas', () => {
    expect(validarLineas([L('ok', '1', '0')])).toEqual([]);
    expect(validarLineas([])[0]).toMatch(/al menos una/);
    expect(validarLineas(Array.from({ length: MAX_LINEAS + 1 }, (_, i) => L(`l${i}`, '1', '1')))[0]).toMatch(/Máximo 50/);
    const e = validarLineas([L('', '0', '-1')]);
    expect(e.some((m) => /descripción/.test(m))).toBe(true);
    expect(e.some((m) => /cantidad/.test(m))).toBe(true);
    expect(e.some((m) => /precio/.test(m))).toBe(true);
    expect(validarLineas([L('x'.repeat(201), '1', '1')])[0]).toMatch(/descripción/);
  });

  it('prepara el cuerpo a enviar con punto decimal y descripciones normalizadas, sin importes calculados', () => {
    expect(lineasParaEnviar([L('  Fresado   CNC ', '2,5', '10,00')])).toEqual([{ descripcion: 'Fresado CNC', cantidad: '2.5', precio_unitario: '10.00' }]);
  });

  it('un borrador histórico sin líneas se muestra con una línea derivada editable (servicio × 1 × valor)', () => {
    const d = lineaDerivada('Torneado industrial', '300.00');
    expect(d).toMatchObject({ descripcion: 'Torneado industrial', cantidad: '1', precio: '300.00' });
    expect(lineaDerivada(null, null)).toMatchObject({ descripcion: 'Servicio solicitado', precio: '' });
  });

  it('convierte las líneas guardadas en líneas editables y formatea cantidades', () => {
    const l = lineasDesdeDetalle([{ descripcion: 'A', cantidad: '2.500', precio_unitario: '10.00', subtotal: '25.00' }]);
    expect(l[0]).toMatchObject({ descripcion: 'A', cantidad: '2.5', precio: '10.00' });
    expect(formatearCantidad('2.500')).toBe('2,5');
    expect(formatearCantidad('10.000')).toBe('10');
    expect(formatearCantidad(null)).toBe('—');
  });
});
