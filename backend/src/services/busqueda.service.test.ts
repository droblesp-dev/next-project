import { beforeEach, describe, expect, it, vi } from 'vitest';

const repo = vi.hoisted(() => ({
  buscarSolicitudes: vi.fn(),
  buscarCotizaciones: vi.fn(),
  buscarOrdenes: vi.fn(),
  buscarAlertas: vi.fn(),
  buscarLeads: vi.fn(),
  buscarUsuarios: vi.fn(),
}));
const listarAlertas = vi.hoisted(() => vi.fn());
// Líneas de detalle (V28): por defecto la tabla no existe (comportamiento anterior); las pruebas de líneas la «activan».
const esquema = vi.hoisted(() => ({ items: false }));
const itemsRepo = vi.hoisted(() => ({ buscarCotizacionesPorLineas: vi.fn() }));

vi.mock('../repositories/busqueda.repository.js', () => repo);
vi.mock('../repositories/cotizacionesEsquema.js', () => ({ obtenerEsquemaCotizaciones: async () => ({ items: esquema.items }) }));
vi.mock('../repositories/cotizacionItems.repository.js', () => itemsRepo);
vi.mock('./alertas.service.js', () => ({ listarAlertas }));

import { buscarIds, esEntidadBusqueda, SinAccesoBusquedaError } from './busqueda.service.js';

const admin = { sub: 'u-admin', rol: 'ADMIN' };
const comercial = { sub: 'u-com', rol: 'COMERCIAL' };
const operativo = { sub: 'u-op', rol: 'OPERATIVO' };

beforeEach(() => {
  vi.clearAllMocks();
  esquema.items = false;
  itemsRepo.buscarCotizacionesPorLineas.mockResolvedValue([]);
  for (const fn of Object.values(repo)) fn.mockResolvedValue(['id-1', 'id-2']);
});

describe('buscarIds: autorización por entidad', () => {
  it('reconoce solo las entidades buscables', () => {
    for (const e of ['solicitudes', 'cotizaciones', 'ordenes', 'alertas', 'leads', 'usuarios']) {
      expect(esEntidadBusqueda(e)).toBe(true);
    }
    for (const e of ['clientes', 'constructor', '__proto__', 'toString', '']) expect(esEntidadBusqueda(e)).toBe(false);
  });

  it('respeta los mismos roles que el listado de cada entidad', async () => {
    await expect(buscarIds('cotizaciones', '1', operativo)).rejects.toBeInstanceOf(SinAccesoBusquedaError);
    await expect(buscarIds('leads', '1', operativo)).rejects.toBeInstanceOf(SinAccesoBusquedaError);
    await expect(buscarIds('usuarios', '1', comercial)).rejects.toBeInstanceOf(SinAccesoBusquedaError);
    await expect(buscarIds('usuarios', '1', operativo)).rejects.toBeInstanceOf(SinAccesoBusquedaError);
    expect(repo.buscarCotizaciones).not.toHaveBeenCalled();
    expect(repo.buscarUsuarios).not.toHaveBeenCalled();

    await expect(buscarIds('usuarios', '1', admin)).resolves.toEqual(['id-1', 'id-2']);
    await expect(buscarIds('solicitudes', '1', operativo)).resolves.toEqual(['id-1', 'id-2']);
  });

  it('un rol desconocido no puede buscar en ninguna entidad', async () => {
    await expect(buscarIds('solicitudes', '1', { sub: 'x', rol: 'CLIENTE' })).rejects.toBeInstanceOf(SinAccesoBusquedaError);
  });
});

describe('buscarIds: patrones y datos del cliente', () => {
  it('envía al repositorio el patrón parcial y el de números legibles', async () => {
    await buscarIds('solicitudes', 'SOL-000491', comercial);
    expect(repo.buscarSolicitudes).toHaveBeenCalledWith('%sol-000491%', '%sol000491%', true);
  });

  it('un término de un solo dígito se busca como parcial en todos los campos', async () => {
    await buscarIds('cotizaciones', '1', admin);
    expect(repo.buscarCotizaciones).toHaveBeenCalledWith('%1%', '%1%', true);
  });

  it('OPERATIVO no busca por datos del cliente (igual que no puede listar clientes)', async () => {
    await buscarIds('solicitudes', 'juan', operativo);
    await buscarIds('ordenes', 'juan', operativo);
    expect(repo.buscarSolicitudes).toHaveBeenCalledWith('%juan%', '%juan%', false);
    expect(repo.buscarOrdenes).toHaveBeenCalledWith('%juan%', '%juan%', false);
  });

  it('la empresa de los leads solo se consulta para ADMIN', async () => {
    await buscarIds('leads', 'acme', admin);
    await buscarIds('leads', 'acme', comercial);
    expect(repo.buscarLeads).toHaveBeenNthCalledWith(1, '%acme%', '%acme%', true);
    expect(repo.buscarLeads).toHaveBeenNthCalledWith(2, '%acme%', '%acme%', false);
  });
});

describe('buscarIds: alertas', () => {
  it('devuelve solo las alertas que el rol puede ver', async () => {
    repo.buscarAlertas.mockResolvedValue(['a1', 'a2', 'a3']);
    listarAlertas.mockResolvedValue([{ id: 'a2' }, { id: 'a3' }, { id: 'a9' }]);

    await expect(buscarIds('alertas', 'orden', operativo)).resolves.toEqual(['a2', 'a3']);
    expect(listarAlertas).toHaveBeenCalledWith({ sub: 'u-op', rol: 'OPERATIVO' });
  });
});

describe('buscarIds: cotizaciones por descripción de línea (requerimiento 4)', () => {
  it('sin la tabla de líneas se comporta como antes y no consulta las líneas', async () => {
    expect(await buscarIds('cotizaciones', 'torneado', comercial)).toEqual(['id-1', 'id-2']);
    expect(itemsRepo.buscarCotizacionesPorLineas).not.toHaveBeenCalled();
  });

  it('con la tabla de líneas agrega las cotizaciones cuyas líneas coinciden, sin duplicar', async () => {
    esquema.items = true;
    itemsRepo.buscarCotizacionesPorLineas.mockResolvedValue(['id-2', 'id-9']);
    expect(await buscarIds('cotizaciones', 'torneado', comercial)).toEqual(['id-1', 'id-2', 'id-9']);
    expect(itemsRepo.buscarCotizacionesPorLineas).toHaveBeenCalledWith('%torneado%');
  });

  it('la búsqueda en líneas respeta los roles de la entidad (OPERATIVO sigue sin acceso)', async () => {
    esquema.items = true;
    await expect(buscarIds('cotizaciones', 'x', operativo)).rejects.toBeInstanceOf(SinAccesoBusquedaError);
    expect(itemsRepo.buscarCotizacionesPorLineas).not.toHaveBeenCalled();
  });
});
