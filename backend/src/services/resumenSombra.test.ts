import { describe, expect, it } from 'vitest';
import { interpretarLinea, resumirSombra } from './resumenSombra.js';

const AHORA = new Date('2026-11-20T12:00:00.000Z');
const evento = (fecha: string, usuario: string, solicitud: string, operacion = 'LEER') =>
  JSON.stringify({ tipo: 'SEGURIDAD', evento: 'CHAT_ACCESO_SOMBRA_DENEGADO', fecha, usuarioId: usuario, solicitudId: solicitud, operacion });

describe('resumen del modo sombra (D4)', () => {
  it('ignora líneas que no son el evento y líneas dañadas', () => {
    expect(interpretarLinea('Error al consultar NexIA: sin clave')).toBeNull();
    expect(interpretarLinea('{"tipo":"SEGURIDAD","evento":"LOGIN_OK","fecha":"2026-11-20T10:00:00Z"}')).toBeNull();
    expect(interpretarLinea('{"tipo":"SEGURIDAD","evento":"CHAT_ACCESO_SOMBRA_DENEGADO","fecha":"no-es-fecha","usuarioId":"u","solicitudId":"s","operacion":"LEER"}')).toBeNull();
    expect(interpretarLinea('{ roto CHAT_ACCESO_SOMBRA_DENEGADO')).toBeNull();
  });

  it('sin eventos en los últimos 7 días la condición se cumple, aunque haya eventos antiguos', () => {
    const r = resumirSombra([evento('2026-11-01T10:00:00.000Z', 'u1', 's1')], { ahora: AHORA });
    expect(r).toMatchObject({ totalEventos: 1, eventosEnVentana: 0, sinExplicarEnVentana: 0, cumpleCondicion: true });
  });

  it('un acceso denegado reciente sin explicar incumple la condición y se agrupa por usuario y solicitud', () => {
    const r = resumirSombra(
      [evento('2026-11-19T10:00:00.000Z', 'u1', 's1', 'LEER'), evento('2026-11-19T10:00:01.000Z', 'u1', 's1', 'MARCAR_LEIDO'), evento('2026-11-20T09:00:00.000Z', 'u2', 's2', 'ESCRIBIR')],
      { ahora: AHORA }
    );
    expect(r.eventosEnVentana).toBe(3);
    expect(r.sinExplicarEnVentana).toBe(2);
    expect(r.cumpleCondicion).toBe(false);
    expect(r.porOperacion).toEqual({ LEER: 1, MARCAR_LEIDO: 1, ESCRIBIR: 1 });
    expect(r.paresEnVentana[0]).toMatchObject({ usuarioId: 'u1', solicitudId: 's1', eventos: 2, operaciones: ['LEER', 'MARCAR_LEIDO'] });
  });

  it('los pares explicados y aceptados no incumplen la condición, pero siguen apareciendo en el detalle', () => {
    const r = resumirSombra([evento('2026-11-19T10:00:00.000Z', 'u1', 's1')], { ahora: AHORA, explicados: new Set(['u1|s1']) });
    expect(r.cumpleCondicion).toBe(true);
    expect(r.paresEnVentana).toHaveLength(1);
    expect(r.paresEnVentana[0].explicado).toBe(true);
  });

  it('la ventana es configurable y no acepta eventos del futuro', () => {
    const lineas = [evento('2026-11-10T10:00:00.000Z', 'u1', 's1'), evento('2026-12-01T10:00:00.000Z', 'u2', 's2')];
    expect(resumirSombra(lineas, { ahora: AHORA, dias: 7 }).eventosEnVentana).toBe(0);
    expect(resumirSombra(lineas, { ahora: AHORA, dias: 14 }).eventosEnVentana).toBe(1);
  });
});
