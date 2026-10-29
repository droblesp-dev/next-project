import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());
vi.mock('../config/db.js', () => ({ pool: { query } }));

import {
  buscarAlertas,
  buscarCotizaciones,
  buscarLeads,
  buscarOrdenes,
  buscarSolicitudes,
  buscarUsuarios,
} from './busqueda.repository.js';

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [{ id: 'a' }, { id: 'b' }] });
});

const sqlEmitido = (): string => query.mock.calls[0][0] as string;
const paramsEmitidos = (): unknown[] => query.mock.calls[0][1] as unknown[];

describe('SQL de la búsqueda parcial', () => {
  it('usa LIKE con parámetros, sin distinguir mayúsculas ni tildes, y devuelve todos los ids', async () => {
    const resultado = await buscarSolicitudes('%1%', '%1%', true);

    expect(resultado).toEqual(['a', 'b']);
    const sql = sqlEmitido();
    expect(sql).toContain("LIKE $1 ESCAPE '\\'");
    expect(sql).toContain('lower(');
    expect(sql).toContain('translate(');
    expect(sql).not.toMatch(/\bLIMIT\b/i);
    expect(paramsEmitidos()).toEqual(['%1%', '%1%']);
  });

  it('compara los números legibles sin guiones ni espacios', async () => {
    await buscarCotizaciones('%sol-000491%', '%sol000491%', true);
    const sql = sqlEmitido();
    expect(sql).toContain("regexp_replace(lower(COALESCE((c.codigo)::text, '')), '[^a-z0-9]', '', 'g') LIKE $2");
    expect(sql).toContain("(s.codigo)::text");
  });

  it('el término nunca se concatena al SQL (solo viaja como parámetro)', async () => {
    const malicioso = "x'; DROP TABLE solicitudes; --";
    await buscarSolicitudes(`%${malicioso}%`, null, true);
    expect(sqlEmitido()).not.toContain('DROP TABLE');
    expect(paramsEmitidos()[0]).toContain('DROP TABLE');
  });

  it('solo envía $2 cuando la consulta compara números legibles', async () => {
    await buscarLeads('%a%', '%a%', true);
    expect(paramsEmitidos()).toEqual(['%a%']);
    query.mockClear();
    await buscarUsuarios('%a%', '%a%');
    expect(paramsEmitidos()).toEqual(['%a%']);
    query.mockClear();
    await buscarOrdenes('%a%', '%a%', true);
    expect(paramsEmitidos()).toEqual(['%a%', '%a%']);
  });

  it('los datos del cliente solo entran en la consulta cuando se permiten', async () => {
    await buscarSolicitudes('%a%', null, false);
    expect(sqlEmitido()).not.toContain('cl.nombre');
    expect(sqlEmitido()).not.toContain('cl.telefono');
    query.mockClear();
    await buscarSolicitudes('%a%', null, true);
    for (const campo of ['cl.nombre', 'cl.empresa', 'cl.email', 'cl.telefono']) expect(sqlEmitido()).toContain(campo);
  });

  it('cada entidad busca también por sus fechas, importes y estados visibles', async () => {
    await buscarCotizaciones('%1%', '%1%', true);
    for (const campo of ['c.total', 'c.valor', 'c.estado_anticipo', 'c.saldo_pendiente', "'DD/MM/YYYY'"]) {
      expect(sqlEmitido()).toContain(campo);
    }
    query.mockClear();
    await buscarAlertas('%1%', '%1%', true);
    expect(sqlEmitido()).toContain('a.mensaje');
    expect(sqlEmitido()).toContain('o.codigo');
  });

  it('la empresa del lead entra solo cuando se permite', async () => {
    await buscarLeads('%a%', null, false);
    expect(sqlEmitido()).not.toContain('cl.empresa');
    query.mockClear();
    await buscarLeads('%a%', null, true);
    expect(sqlEmitido()).toContain('cl.empresa');
  });
});
