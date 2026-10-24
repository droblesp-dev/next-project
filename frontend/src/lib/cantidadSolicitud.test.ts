import { describe, expect, it } from 'vitest';
import {
  esCantidadDesconocida,
  formatearCantidad,
  MARCA_CANTIDAD_DESCONOCIDA,
  TEXTO_CANTIDAD_DESCONOCIDA,
} from './cantidadSolicitud';

const desconocida = `Cantidad: ${MARCA_CANTIDAD_DESCONOCIDA}.`;

describe('formatearCantidad', () => {
  it('muestra un guion cuando el cliente indicó que aún no conoce la cantidad (antes «1 (a confirmar)»)', () => {
    expect(formatearCantidad(1, desconocida)).toBe('—');
    expect(formatearCantidad(1, `Detalle previo. ${desconocida} Más texto.`)).toBe('—');
    expect(TEXTO_CANTIDAD_DESCONOCIDA).toBe('—');
  });

  it('no vuelve a mostrar «(a confirmar)» en ningún caso', () => {
    expect(formatearCantidad(1, desconocida)).not.toMatch(/confirmar/i);
    expect(formatearCantidad(5, 'otro texto')).not.toMatch(/confirmar/i);
  });

  it('con una cantidad real muestra el número, incluido 1', () => {
    expect(formatearCantidad(1, null)).toBe('1');
    expect(formatearCantidad(1, 'Necesito piezas de acero.')).toBe('1');
    expect(formatearCantidad(250, undefined)).toBe('250');
    expect(formatearCantidad(12, '')).toBe('12');
  });
});

describe('esCantidadDesconocida', () => {
  it('detecta la marca solo cuando está en las especificaciones', () => {
    expect(esCantidadDesconocida(desconocida)).toBe(true);
    expect(esCantidadDesconocida('Cantidad: 3 unidades')).toBe(false);
    expect(esCantidadDesconocida(null)).toBe(false);
    expect(esCantidadDesconocida(undefined)).toBe(false);
  });
});
