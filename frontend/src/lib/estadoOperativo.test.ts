import { describe, expect, it } from 'vitest';
import { gestionOperativo } from './estadoOperativo';

describe('gestionOperativo (#2)', () => {
  it('PENDIENTE: iniciarla', () => {
    expect(gestionOperativo('PENDIENTE', 0)).toMatchObject({ estado: 'Pendiente', puedeActuar: true });
    expect(gestionOperativo('PENDIENTE', 0).accion).toContain('EN PROCESO');
  });

  it('EN_PROCESO: indica los requisitos de finalizar según el avance', () => {
    expect(gestionOperativo('EN_PROCESO', 40).accion).toMatch(/avance hasta 100.*evidencia.*observación final/);
    expect(gestionOperativo('EN_PROCESO', 100).accion).toMatch(/^Finalizarla/);
    expect(gestionOperativo('EN_PROCESO', 40).puedeActuar).toBe(true);
  });

  it('PAUSADA: reanudarla', () => {
    expect(gestionOperativo('PAUSADA', 50)).toMatchObject({ puedeActuar: true });
    expect(gestionOperativo('PAUSADA', 50).accion).toContain('Reanudarla');
  });

  it('FINALIZADA, CERRADA y CANCELADA: Operativo no tiene acciones', () => {
    for (const e of ['FINALIZADA', 'CERRADA', 'CANCELADA']) {
      expect(gestionOperativo(e, 100).puedeActuar).toBe(false);
    }
    expect(gestionOperativo('FINALIZADA', 100).accion).toContain('Comercial o Administración');
  });

  it('un estado desconocido no inventa acciones', () => {
    expect(gestionOperativo('OTRO_ESTADO', 0)).toMatchObject({ estado: 'OTRO ESTADO', puedeActuar: false });
  });
});
