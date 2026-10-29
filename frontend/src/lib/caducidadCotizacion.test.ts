import { describe, expect, it } from 'vitest';
import {
  avisoCaducidad,
  ETIQUETA_CADUCIDAD,
  explicacionEstadoSinAcciones,
  MENSAJE_CLIENTE_COTIZACION_VENCIDA,
  notaVencimientoAutomatico,
} from './caducidadCotizacion';

describe('caducidad de cotizaciones (#4/#5)', () => {
  it('la etiqueta es «Fecha de caducidad» y el mensaje al cliente indica consultar al asesor', () => {
    expect(ETIQUETA_CADUCIDAD).toBe('Fecha de caducidad');
    expect(MENSAJE_CLIENTE_COTIZACION_VENCIDA).toContain('caducó');
    expect(MENSAJE_CLIENTE_COTIZACION_VENCIDA).toContain('asesor');
  });

  it('solo una cotización VENCIDA muestra el aviso de caducidad', () => {
    const ahora = new Date('2026-10-29T12:00:00.000Z');
    expect(avisoCaducidad('VENCIDA', '2026-10-01T10:00:00.000Z', ahora)).toMatch(/caducó el .*asesor comercial/);
    // fecha futura (dada de baja antes de tiempo): no se cita como fecha de caducidad ya ocurrida
    expect(avisoCaducidad('VENCIDA', '2026-11-13T10:00:00.000Z', ahora)).toBe('Esta cotización caducó. El cliente debe consultar con su asesor comercial.');
    expect(avisoCaducidad('VENCIDA', null)).toBe('Esta cotización caducó. El cliente debe consultar con su asesor comercial.');
    for (const estado of ['BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'CANCELADA']) {
      expect(avisoCaducidad(estado, '2026-10-01T10:00:00.000Z')).toBeNull();
    }
  });

  it('explica por qué VENCIDA y CANCELADA no admiten acciones', () => {
    expect(explicacionEstadoSinAcciones('VENCIDA')).toContain('automáticamente');
    expect(explicacionEstadoSinAcciones('CANCELADA')).toContain('cancelada');
    expect(explicacionEstadoSinAcciones('ACEPTADA')).toBe('Este estado no admite más transiciones.');
  });

  it('solo una cotización ENVIADA recuerda que vence automáticamente', () => {
    expect(notaVencimientoAutomatico('ENVIADA')).toContain('automáticamente');
    expect(notaVencimientoAutomatico('BORRADOR')).toBeNull();
    expect(notaVencimientoAutomatico('VENCIDA')).toBeNull();
  });
});
