import { describe, expect, it } from 'vitest';
import { etiquetaMensajesPendientes, hayPendientes, pendientesPorSolicitud, textoContador } from './mensajesPendientes';

describe('contadores de mensajes pendientes (#7)', () => {
  it('convierte la respuesta en un mapa y descarta entradas sin pendientes o inválidas', () => {
    const mapa = pendientesPorSolicitud({
      activo: true,
      total: 3,
      por_solicitud: [
        { solicitud_id: 'a', pendientes: 2 },
        { solicitud_id: 'b', pendientes: 0 },
        { solicitud_id: 'c', pendientes: 1 },
        { solicitud_id: 'd', pendientes: Number.NaN },
      ],
    });
    expect(mapa).toEqual({ a: 2, c: 1 });
  });

  it('con los contadores inactivos o sin respuesta no hay pendientes', () => {
    expect(pendientesPorSolicitud({ activo: false, total: 0, por_solicitud: [] })).toEqual({});
    expect(pendientesPorSolicitud(null)).toEqual({});
    expect(pendientesPorSolicitud(undefined)).toEqual({});
  });

  it('el icono solo se muestra con al menos un pendiente', () => {
    expect(hayPendientes(undefined)).toBe(false);
    expect(hayPendientes(0)).toBe(false);
    expect(hayPendientes(1)).toBe(true);
  });

  it('presenta el contador con tope 99+ y una etiqueta accesible con la cantidad', () => {
    expect(textoContador(7)).toBe('7');
    expect(textoContador(100)).toBe('99+');
    expect(etiquetaMensajesPendientes(1)).toContain('1 mensaje sin leer');
    expect(etiquetaMensajesPendientes(3)).toContain('3 mensajes sin leer');
  });
});
