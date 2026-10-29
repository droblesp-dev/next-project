import { describe, expect, it } from 'vitest';
import { AYUDA_SIN_NUMERO, ayudaReferencia, referenciaOrigen, SIN_NUMERO } from './referenciasOrden';

describe('referencias de origen de una orden (#11)', () => {
  it('muestra el número tal cual cuando existe', () => {
    expect(referenciaOrigen('COT-000003')).toBe('COT-000003');
    expect(referenciaOrigen(' SOL-000493 ')).toBe('SOL-000493');
    expect(ayudaReferencia('COT-000003')).toBeUndefined();
  });

  it.each([null, undefined, '', '   '])('sin número (%j) muestra «—» y explica el motivo, sin inventar nada', (valor) => {
    expect(referenciaOrigen(valor)).toBe(SIN_NUMERO);
    expect(ayudaReferencia(valor)).toBe(AYUDA_SIN_NUMERO);
  });
});
