import { beforeEach, describe, expect, it } from 'vitest';
import {
  LimiteLoginError,
  LOGIN_MAX_FALLOS_CUENTA,
  LOGIN_MAX_FALLOS_IP,
  LOGIN_VENTANA_MS,
  registrarLoginExitoso,
  registrarLoginFallido,
  reiniciarLimitesLogin,
  verificarLoginPermitido,
} from './loginRateLimit.service.js';

describe('límite de intentos de login', () => {
  beforeEach(() => reiniciarLimitesLogin());

  it('permite intentos por debajo del máximo y bloquea al alcanzarlo', () => {
    for (let i = 0; i < LOGIN_MAX_FALLOS_CUENTA; i++) {
      expect(() => verificarLoginPermitido('1.1.1.1', 'a@x.com', 1000)).not.toThrow();
      registrarLoginFallido('1.1.1.1', 'a@x.com', 1000);
    }
    expect(() => verificarLoginPermitido('1.1.1.1', 'a@x.com', 1000)).toThrow(LimiteLoginError);
  });

  it('el bloqueo de una cuenta no afecta a otra IP ni a otro correo', () => {
    for (let i = 0; i < LOGIN_MAX_FALLOS_CUENTA; i++) registrarLoginFallido('1.1.1.1', 'a@x.com', 1000);
    expect(() => verificarLoginPermitido('2.2.2.2', 'a@x.com', 1000)).not.toThrow();
    expect(() => verificarLoginPermitido('1.1.1.1', 'b@x.com', 1000)).not.toThrow();
  });

  it('normaliza mayúsculas y espacios del correo', () => {
    for (let i = 0; i < LOGIN_MAX_FALLOS_CUENTA; i++) registrarLoginFallido('1.1.1.1', ' A@X.com ', 1000);
    expect(() => verificarLoginPermitido('1.1.1.1', 'a@x.com', 1000)).toThrow(LimiteLoginError);
  });

  it('el bloqueo expira al terminar la ventana y informa la espera', () => {
    for (let i = 0; i < LOGIN_MAX_FALLOS_CUENTA; i++) registrarLoginFallido('1.1.1.1', 'a@x.com', 1000);
    try {
      verificarLoginPermitido('1.1.1.1', 'a@x.com', 1000);
    } catch (e) {
      expect((e as LimiteLoginError).reintentarEnSegundos).toBe(Math.ceil(LOGIN_VENTANA_MS / 1000));
    }
    expect(() => verificarLoginPermitido('1.1.1.1', 'a@x.com', 1000 + LOGIN_VENTANA_MS + 1)).not.toThrow();
  });

  it('un login correcto limpia el contador de esa cuenta', () => {
    for (let i = 0; i < LOGIN_MAX_FALLOS_CUENTA - 1; i++) registrarLoginFallido('1.1.1.1', 'a@x.com', 1000);
    registrarLoginExitoso('1.1.1.1', 'a@x.com');
    registrarLoginFallido('1.1.1.1', 'a@x.com', 1000);
    expect(() => verificarLoginPermitido('1.1.1.1', 'a@x.com', 1000)).not.toThrow();
  });

  it('bloquea una IP que barre muchos correos distintos', () => {
    for (let i = 0; i < LOGIN_MAX_FALLOS_IP; i++) registrarLoginFallido('9.9.9.9', `u${i}@x.com`, 1000);
    expect(() => verificarLoginPermitido('9.9.9.9', 'nuevo@x.com', 1000)).toThrow(LimiteLoginError);
  });
});
