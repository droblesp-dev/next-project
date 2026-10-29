import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('../config/db.js', () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

import { obtenerEsquemaChat, reiniciarCacheEsquemaChat } from './chatEsquema.js';

describe('detección del esquema del chat (R0)', () => {
  beforeEach(() => {
    query.mockReset();
    reiniciarCacheEsquemaChat();
  });

  it('refleja lo que existe en el catálogo', async () => {
    query.mockResolvedValueOnce({ rows: [{ destinatario: true, participantes: true, lecturas: false }] });
    expect(await obtenerEsquemaChat()).toEqual({ destinatario: true, participantes: true, lecturas: false });
  });

  it('falla cerrando: si el catálogo no responde se asume el esquema mínimo (ninguna respuesta de NexIA atribuible)', async () => {
    query.mockRejectedValueOnce(new Error('conexión caída'));
    expect(await obtenerEsquemaChat()).toEqual({ destinatario: false, participantes: false, lecturas: false });
  });

  it('guarda el resultado en caché y no consulta el catálogo en cada mensaje', async () => {
    query.mockResolvedValue({ rows: [{ destinatario: true, participantes: false, lecturas: false }] });
    await obtenerEsquemaChat();
    await obtenerEsquemaChat();
    await obtenerEsquemaChat();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('una columna ausente se interpreta como esquema anterior a V25', async () => {
    query.mockResolvedValueOnce({ rows: [{ destinatario: false, participantes: false, lecturas: false }] });
    expect((await obtenerEsquemaChat()).destinatario).toBe(false);
  });
});
