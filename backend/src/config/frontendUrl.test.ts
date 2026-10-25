import { afterEach, describe, expect, it, vi } from 'vitest';

// env.ts lee process.env al importarse: se reimporta con cada valor de FRONTEND_URL.
async function frontendUrlCon(valor: string | undefined): Promise<string> {
  vi.resetModules();
  process.env.JWT_SECRET = 'test';
  process.env.COTIZACION_LINK_SECRET = 'test';
  process.env.LEAD_LINK_SECRET = 'test';
  if (valor === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = valor;
  return (await import('./env.js')).env.frontendUrl;
}

describe('env.frontendUrl', () => {
  afterEach(() => {
    delete process.env.FRONTEND_URL;
  });

  it('devuelve la URL sin barra final', async () => {
    expect(await frontendUrlCon('https://app.example.com/')).toBe('https://app.example.com');
  });

  it('vacío o sin definir cuenta como no definido', async () => {
    expect(await frontendUrlCon('')).toBe('');
    expect(await frontendUrlCon(undefined)).toBe('');
  });

  it('un macro de Azure sin resolver cuenta como no definido', async () => {
    expect(await frontendUrlCon('$(PROD_FRONTEND_URL)')).toBe('');
  });
});
