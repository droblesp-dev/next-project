import { describe, expect, it } from 'vitest';
import {
  etiquetaAccionAcreditacion,
  etiquetaConfirmarAcreditacion,
  evaluarAcreditacion,
  lineaTrazabilidad,
  llamadaAIso,
  puedeRegistrarSeguimiento,
  saldoBloqueadoPorAnticipo,
  textoAclaracionAcreditacion,
  validarObservaciones,
} from './dineroAcreditado';

describe('saldoBloqueadoPorAnticipo', () => {
  it.each([['VALIDADO', false], ['NO_APLICA', false], ['PENDIENTE', true], ['RECHAZADO', true], [null, true], [undefined, true]])(
    'anticipo %s -> bloqueado=%s',
    (estado, esperado) => {
      expect(saldoBloqueadoPorAnticipo(estado as string | null | undefined)).toBe(esperado);
    }
  );
});

describe('etiquetas: «Dinero acreditado» solo para transferencias', () => {
  it('TRANSFERENCIA (y método aún sin definir) usa «DINERO ACREDITADO»', () => {
    expect(etiquetaAccionAcreditacion('TRANSFERENCIA')).toBe('DINERO ACREDITADO');
    expect(etiquetaAccionAcreditacion(null)).toBe('DINERO ACREDITADO');
    expect(etiquetaConfirmarAcreditacion('TRANSFERENCIA')).toBe('CONFIRMAR DINERO ACREDITADO');
  });

  it('EFECTIVO conserva su flujo y no se presenta como acreditación bancaria', () => {
    expect(etiquetaAccionAcreditacion('EFECTIVO')).toBe('EFECTIVO RECIBIDO');
    expect(etiquetaConfirmarAcreditacion('EFECTIVO')).toBe('CONFIRMAR EFECTIVO RECIBIDO');
    expect(textoAclaracionAcreditacion('EFECTIVO')).toMatch(/no es una acreditación bancaria/i);
  });

  it('la aclaración de la transferencia indica que es una confirmación por teléfono, no una verificación automática', () => {
    expect(textoAclaracionAcreditacion('TRANSFERENCIA')).toMatch(/confirmación comunicada por teléfono/i);
    expect(textoAclaracionAcreditacion('TRANSFERENCIA')).toMatch(/no una verificación bancaria automática/i);
  });
});

describe('evaluarAcreditacion', () => {
  const revision = { estado: 'PENDIENTE' };

  it('anticipo por TRANSFERENCIA sin comprobante del cliente: no permitido', () => {
    const r = evaluarAcreditacion({ tipoPago: 'ANTICIPO', metodo: 'TRANSFERENCIA', comprobanteRecibido: false, gestionVigente: revision });
    expect(r.permitido).toBe(false);
    expect(r.motivo).toMatch(/comprobante/i);
  });

  it('anticipo por TRANSFERENCIA con comprobante pero sin revisión previa (o con la última gestión rechazada): no permitido', () => {
    for (const gestionVigente of [null, undefined, { estado: 'RECHAZADO' }, { estado: 'VALIDADO' }]) {
      const r = evaluarAcreditacion({ tipoPago: 'ANTICIPO', metodo: 'TRANSFERENCIA', comprobanteRecibido: true, gestionVigente });
      expect(r.permitido).toBe(false);
      expect(r.motivo).toMatch(/gestión|revisión/i);
    }
  });

  it('anticipo por TRANSFERENCIA con comprobante y revisión previa: permitido', () => {
    expect(evaluarAcreditacion({ tipoPago: 'ANTICIPO', metodo: 'TRANSFERENCIA', comprobanteRecibido: true, gestionVigente: revision })).toEqual({
      permitido: true,
      motivo: null,
    });
  });

  it('anticipo en EFECTIVO: permitido sin comprobante ni revisión', () => {
    expect(evaluarAcreditacion({ tipoPago: 'ANTICIPO', metodo: 'EFECTIVO', comprobanteRecibido: false, gestionVigente: null }).permitido).toBe(true);
  });

  it('saldo por TRANSFERENCIA: exige el comprobante del saldo, pero no la revisión del anticipo', () => {
    expect(evaluarAcreditacion({ tipoPago: 'SALDO', metodo: 'TRANSFERENCIA', comprobanteRecibido: false, gestionVigente: null }).permitido).toBe(false);
    expect(evaluarAcreditacion({ tipoPago: 'SALDO', metodo: 'TRANSFERENCIA', comprobanteRecibido: true, gestionVigente: null }).permitido).toBe(true);
  });
});

describe('puedeRegistrarSeguimiento', () => {
  it('solo con una gestión vigente PENDIENTE', () => {
    expect(puedeRegistrarSeguimiento({ estado: 'PENDIENTE' })).toBe(true);
    expect(puedeRegistrarSeguimiento({ estado: 'RECHAZADO' })).toBe(false);
    expect(puedeRegistrarSeguimiento(null)).toBe(false);
  });
});

describe('llamadaAIso', () => {
  const ahora = new Date('2026-10-28T20:00:00.000Z');

  it('vacío = la hora de la llamada no se conoce (null, sin error)', () => {
    expect(llamadaAIso('', ahora)).toEqual({ iso: null, error: null });
    expect(llamadaAIso('   ', ahora)).toEqual({ iso: null, error: null });
  });

  it('una fecha pasada válida se convierte a ISO 8601', () => {
    const r = llamadaAIso('2026-10-28T10:30', ahora);
    expect(r.error).toBeNull();
    expect(r.iso).toBe(new Date('2026-10-28T10:30').toISOString());
  });

  it('rechaza fechas ilegibles y posteriores al momento actual', () => {
    expect(llamadaAIso('ayer', ahora).error).toMatch(/no son válidas/i);
    expect(llamadaAIso('2026-10-29T10:30', ahora).error).toMatch(/posterior/i);
  });
});

describe('validarObservaciones', () => {
  it('obligatoria (seguimiento): rechaza vacío y solo espacios', () => {
    expect(validarObservaciones('', true)).toMatch(/observación/i);
    expect(validarObservaciones('   ', true)).toMatch(/observación/i);
    expect(validarObservaciones('ADMIN no respondió', true)).toBeNull();
  });

  it('opcional: acepta vacío; en ambos casos limita a 1000 caracteres', () => {
    expect(validarObservaciones('', false)).toBeNull();
    expect(validarObservaciones('x'.repeat(1001), false)).toMatch(/1000/);
    expect(validarObservaciones('x'.repeat(1000), false)).toBeNull();
  });
});

describe('lineaTrazabilidad', () => {
  it('distingue al ADMIN que verificó y al usuario que registró', () => {
    expect(lineaTrazabilidad({ verificado_por_nombre: 'Administrador', registrado_por_nombre: 'Comercial' })).toBe(
      'Verificó (ADMIN): Administrador · Registró: Comercial'
    );
  });

  it('sin verificador (gestión o rechazo) solo muestra quién registró; sin datos devuelve null', () => {
    expect(lineaTrazabilidad({ verificado_por_nombre: null, registrado_por_nombre: 'Comercial' })).toBe('Registró: Comercial');
    expect(lineaTrazabilidad({})).toBeNull();
  });
});
