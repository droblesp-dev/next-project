import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buscarIdsEnServidor } from './busquedaServidor';
import { SesionInvalidaError } from './authClient';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('buscarIdsEnServidor', () => {
  it('consulta /api/busqueda/:entidad con el término codificado y el token', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ids: ['a', 'b', 'a'] }) });

    const ids = await buscarIdsEnServidor('solicitudes', 'SOL-000491 & más', 'tok-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/busqueda\/solicitudes\?q=SOL-000491%20%26%20m%C3%A1s$/);
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('devuelve un conjunto vacío cuando no hay coincidencias', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ids: [] }) });
    expect((await buscarIdsEnServidor('ordenes', 'zzz', 't')).size).toBe(0);
  });

  it('una sesión expirada lanza SesionInvalidaError para cerrar la sesión', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    await expect(buscarIdsEnServidor('cotizaciones', '1', 't')).rejects.toBeInstanceOf(SesionInvalidaError);
  });

  it('otros errores del servidor lanzan un error genérico (la pantalla usa su filtro local)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(buscarIdsEnServidor('alertas', '1', 't')).rejects.toThrow('La búsqueda falló (500).');
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    await expect(buscarIdsEnServidor('usuarios', '1', 't')).rejects.toThrow('403');
  });
});
