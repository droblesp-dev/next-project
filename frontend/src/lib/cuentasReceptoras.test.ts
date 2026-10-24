import { describe, expect, it } from 'vitest';
import { claveCuentaReceptora } from './cuentasReceptoras';

type Cuenta = { banco: string; numero_cuenta: string };

const clavesDe = (cuentas: Cuenta[]) => cuentas.map((c, i) => claveCuentaReceptora(c, i));

describe('claveCuentaReceptora', () => {
  it('cuentas con banco y número repetidos obtienen claves distintas (caso que provocaba el aviso de React)', () => {
    const cuentas: Cuenta[] = [
      { banco: 'Banco Pichincha', numero_cuenta: '2201234567' },
      { banco: 'Produbanco', numero_cuenta: '999' },
      { banco: 'Banco Pichincha', numero_cuenta: '2201234567' },
      { banco: 'Banco Pichincha', numero_cuenta: '2201234567' },
      { banco: 'Produbanco', numero_cuenta: '999' },
    ];
    const claves = clavesDe(cuentas);
    expect(new Set(claves).size).toBe(cuentas.length);
  });

  it('la misma lista sin duplicados también produce claves únicas', () => {
    const claves = clavesDe([
      { banco: 'Banco A', numero_cuenta: '1' },
      { banco: 'Banco B', numero_cuenta: '1' },
      { banco: 'Banco A', numero_cuenta: '2' },
    ]);
    expect(new Set(claves).size).toBe(3);
  });

  it('la posición forma parte de la clave: cada clave corresponde 1:1 a la posición usada para seleccionar', () => {
    const cuentas: Cuenta[] = Array.from({ length: 5 }, () => ({ banco: 'Banco X', numero_cuenta: '000' }));
    const claves = clavesDe(cuentas);
    claves.forEach((clave, i) => expect(clave.endsWith(`-${i}`)).toBe(true));
  });

  it('no depende de que banco y número sean únicos: una lista grande de cuentas idénticas sigue siendo única', () => {
    const cuentas: Cuenta[] = Array.from({ length: 200 }, () => ({ banco: 'Banco X', numero_cuenta: '000' }));
    expect(new Set(clavesDe(cuentas)).size).toBe(200);
  });

  it('el guion del separador no genera colisiones entre bancos y números que se parecen al concatenarse', () => {
    const claves = clavesDe([
      { banco: 'A-1', numero_cuenta: '2' },
      { banco: 'A', numero_cuenta: '1-2' },
    ]);
    expect(new Set(claves).size).toBe(2);
  });

  it('mantiene el prefijo descriptivo banco-número (útil al depurar)', () => {
    expect(claveCuentaReceptora({ banco: 'Banco Pichincha', numero_cuenta: '2201234567' }, 3)).toBe(
      'Banco Pichincha-2201234567-3'
    );
  });
});

import {
  estadoSelectorCuentas,
  etiquetaCuentaReceptora,
  resumenCuentaReceptora,
  TEXTO_CUENTA_NO_REGISTRADA,
} from './cuentasReceptoras';

describe('selector de cuenta receptora', () => {
  const cuenta = { id: 'c1', banco: 'Banco Pichincha', tipo_cuenta: 'AHORROS', numero_cuenta: '2201234567' };

  it('la etiqueta muestra banco, tipo y número (sin titular)', () => {
    expect(etiquetaCuentaReceptora(cuenta)).toBe('Banco Pichincha · AHORROS · 2201234567');
  });

  it('estado: cargando, error, sin cuentas activas o lista', () => {
    expect(estadoSelectorCuentas(null, true, null)).toBe('cargando');
    expect(estadoSelectorCuentas(null, false, 'fallo')).toBe('error');
    expect(estadoSelectorCuentas([], false, null)).toBe('sin_cuentas');
    expect(estadoSelectorCuentas(null, false, null)).toBe('sin_cuentas');
    expect(estadoSelectorCuentas([cuenta], false, null)).toBe('listo');
  });

  it('la carga tiene prioridad sobre un error anterior, y el error sobre una lista previa', () => {
    expect(estadoSelectorCuentas([cuenta], true, 'viejo')).toBe('cargando');
    expect(estadoSelectorCuentas([cuenta], false, 'fallo')).toBe('error');
  });
});

describe('resumenCuentaReceptora (historial)', () => {
  const sin = {
    banco_cuenta_snapshot: null,
    titular_cuenta_snapshot: null,
    tipo_cuenta_snapshot: null,
    numero_cuenta_snapshot: null,
  };

  it('un registro sin cuenta receptora devuelve null (la interfaz muestra «No registrada»)', () => {
    expect(resumenCuentaReceptora(sin)).toBeNull();
    expect(TEXTO_CUENTA_NO_REGISTRADA).toBe('No registrada');
  });

  it('con snapshot completo devuelve banco, tipo, número y titular copiados', () => {
    expect(
      resumenCuentaReceptora({
        banco_cuenta_snapshot: 'Banco A',
        titular_cuenta_snapshot: 'Titular A',
        tipo_cuenta_snapshot: 'CORRIENTE',
        numero_cuenta_snapshot: '123',
      })
    ).toEqual({ banco: 'Banco A', tipo: 'CORRIENTE', numero: '123', titular: 'Titular A' });
  });

  it('un dato suelto que falte se muestra como «—», sin inventar valores', () => {
    expect(resumenCuentaReceptora({ ...sin, banco_cuenta_snapshot: 'Banco A' })).toEqual({
      banco: 'Banco A',
      tipo: '—',
      numero: '—',
      titular: '—',
    });
  });
});
