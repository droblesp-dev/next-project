import { describe, expect, it } from 'vitest';
import { advertenciaCorreoReal } from './advertenciaCorreo.js';
import { env } from './env.js';

describe('advertenciaCorreoReal', () => {
  const real = { brevoApiKey: 'clave-secreta-de-prueba', nextProjectEmail: 'no-reply@example.com', brevoSandbox: false };

  it('avisa cuando el envío real está activo, sin imprimir la clave', () => {
    const msg = advertenciaCorreoReal(real);
    expect(msg).toContain('REALES');
    expect(msg).not.toContain('clave-secreta-de-prueba');
  });

  it.each([
    ['sandbox activo', { ...real, brevoSandbox: true }],
    ['sin clave', { ...real, brevoApiKey: '' }],
    ['sin remitente', { ...real, nextProjectEmail: '' }],
  ])('no avisa con %s', (_n, cfg) => {
    expect(advertenciaCorreoReal(cfg)).toBeNull();
  });
});

describe('salvaguarda de pruebas contra correos reales', () => {
  it('bajo Vitest la clave de Brevo se ignora y el sandbox queda activo, aunque el .env tenga clave real', () => {
    expect(process.env.VITEST).toBe('true');
    expect(env.brevoApiKey).toBe('');
    expect(env.brevoSandbox).toBe(true);
    expect(advertenciaCorreoReal(env)).toBeNull();
  });
});
