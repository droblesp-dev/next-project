import { describe, expect, it } from 'vitest';
import {
  DatosCuentaBancariaInvalidosError,
  LIMITES_CUENTA_BANCARIA,
  validarDatosBase,
} from './cuentasBancarias.service.js';

// Fase A — límites de longitud. Prueba unitaria pura: validarDatosBase()
// corre antes de cualquier acceso a PostgreSQL, así que no necesita BD.
function datosValidos() {
  return {
    titular: 'Centro de Mecanizado Industrial',
    tipoCuenta: 'AHORROS',
    numeroCuenta: '1234567890',
    bancoPersonalizadoNombre: 'Banco de Prueba',
  };
}

describe('validarDatosBase — límites de longitud (Fase A)', () => {
  it('los límites son los acordados y nunca superan las columnas de cuentas_bancarias (V14: 200, 50, 100)', () => {
    expect(LIMITES_CUENTA_BANCARIA).toEqual({ titular: 60, numeroCuenta: 20, bancoNombre: 100 });
    expect(LIMITES_CUENTA_BANCARIA.titular).toBeLessThanOrEqual(200);
    expect(LIMITES_CUENTA_BANCARIA.numeroCuenta).toBeLessThanOrEqual(50);
  });

  it('acepta valores exactamente en el límite', () => {
    expect(() =>
      validarDatosBase({
        ...datosValidos(),
        titular: 'T'.repeat(LIMITES_CUENTA_BANCARIA.titular),
        numeroCuenta: '9'.repeat(LIMITES_CUENTA_BANCARIA.numeroCuenta),
        bancoPersonalizadoNombre: 'B'.repeat(LIMITES_CUENTA_BANCARIA.bancoNombre),
      })
    ).not.toThrow();
  });

  it('rechaza un titular de 61 caracteres con DatosCuentaBancariaInvalidosError', () => {
    expect(() => validarDatosBase({ ...datosValidos(), titular: 'T'.repeat(61) })).toThrow(
      DatosCuentaBancariaInvalidosError
    );
  });

  it('rechaza un número de cuenta de 21 caracteres', () => {
    expect(() => validarDatosBase({ ...datosValidos(), numeroCuenta: '9'.repeat(21) })).toThrow(
      DatosCuentaBancariaInvalidosError
    );
  });

  it('rechaza un nombre de banco personalizado de 101 caracteres', () => {
    expect(() => validarDatosBase({ ...datosValidos(), bancoPersonalizadoNombre: 'B'.repeat(101) })).toThrow(
      DatosCuentaBancariaInvalidosError
    );
  });

  it('mide la longitud ya recortada (los espacios sobrantes no cuentan)', () => {
    expect(() =>
      validarDatosBase({ ...datosValidos(), numeroCuenta: `  ${'9'.repeat(20)}  ` })
    ).not.toThrow();
  });

  it('no altera el formato del número de cuenta: acepta letras y símbolos', () => {
    expect(() => validarDatosBase({ ...datosValidos(), numeroCuenta: 'AB-123/45' })).not.toThrow();
  });
});
