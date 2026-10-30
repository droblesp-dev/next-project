// Requerimiento 4 (V28): creación y edición de cotizaciones con líneas de detalle — lógica transaccional y reglas financieras, con la
// base de datos simulada (no necesita la migración). La integración con la tabla real está en cotizacionItems.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
const poolMock = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
const cot = vi.hoisted(() => ({ create: vi.fn(), updateCondiciones: vi.fn(), findById: vi.fn() }));
const sol = vi.hoisted(() => ({ findById: vi.fn() }));
const items = vi.hoisted(() => ({ reemplazar: vi.fn(), listarPorCotizacion: vi.fn(), sugerirConceptos: vi.fn() }));
const esquema = vi.hoisted(() => ({ items: true }));

vi.mock('../config/db.js', () => ({ pool: poolMock }));
vi.mock('../config/env.js', () => ({ env: { cotizacionLinkSecret: 'x', datosBancarios: {}, corsOrigins: [], frontendUrl: '' } }));
vi.mock('../repositories/cotizaciones.repository.js', () => cot);
vi.mock('../repositories/solicitudes.repository.js', () => sol);
vi.mock('../repositories/cotizacionItems.repository.js', () => items);
vi.mock('../repositories/cotizacionesEsquema.js', () => ({ obtenerEsquemaCotizaciones: async () => ({ items: esquema.items }) }));
vi.mock('../repositories/comprobantesPagoCliente.repository.js', () => ({}));
vi.mock('../repositories/transferenciasPago.repository.js', () => ({}));
vi.mock('./cuentasBancarias.service.js', () => ({ existeCuentaActiva: vi.fn(), listarCuentasActivasPublico: vi.fn() }));
vi.mock('./ordenAutomatica.service.js', () => ({ crearOrdenAutomatica: vi.fn() }));
vi.mock('./leads.service.js', () => ({ convertirLeadPorAceptacion: vi.fn() }));
vi.mock('./email.service.js', () => ({ enviarCodigoTemporalCotizacion: vi.fn(), enviarCodigoAccesoRegenerado: vi.fn() }));

import {
  CotizacionNoEditableError,
  CotizacionNoEncontradaError,
  crearCotizacion,
  editarCotizacionBorrador,
  LineasInvalidasError,
  LineasNoDisponiblesError,
  LineasRequeridasError,
  LineasYValorError,
  sugerirConceptosUsados,
} from './cotizaciones.service.js';

const LINEAS = [
  { descripcion: 'Torneado', cantidad: '10', precio_unitario: '12.50' },
  { descripcion: 'Acabado', cantidad: '2.5', precio_unitario: '10.00' },
];
const BASE = { solicitudId: 'sol-1', descripcion: 'nota', creadoPor: 'u1' };

function sentencias(): string[] {
  return client.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/).slice(0, 2).join(' '));
}

beforeEach(() => {
  vi.clearAllMocks();
  esquema.items = true;
  poolMock.connect.mockResolvedValue(client);
  sol.findById.mockResolvedValue({ id: 'sol-1', estado: 'EN_REVISION' });
  cot.create.mockImplementation(async (_ejecutor: unknown, datos: Record<string, unknown>) => ({ id: 'cot-1', estado: 'BORRADOR', ...datos }));
  cot.updateCondiciones.mockImplementation(async (id: string, datos: Record<string, unknown>) => ({ id, estado: 'BORRADOR', ...datos }));
  items.reemplazar.mockResolvedValue([]);
  items.listarPorCotizacion.mockResolvedValue([]);
  client.query.mockImplementation(async (sql: string) => {
    if (/FOR UPDATE/.test(sql)) return { rows: [{ estado: 'BORRADOR' }] };
    return { rows: [] };
  });
});

describe('crear una cotización con líneas de detalle', () => {
  it('calcula el subtotal desde las líneas y deriva IVA, total, anticipo y saldo con las reglas vigentes (ejemplo aprobado)', async () => {
    await crearCotizacion({ ...BASE, lineas: LINEAS, anticipoPorcentaje: 50, metodoAnticipo: 'TRANSFERENCIA' });
    const datos = cot.create.mock.calls[0][1];
    expect(datos).toMatchObject({
      valor: 150,
      subtotal: 150,
      ivaPorcentaje: 15,
      ivaValor: 22.5,
      total: 172.5,
      anticipoPorcentaje: 50,
      anticipoValor: 86.25,
      saldoPendiente: 86.25,
      estadoAnticipo: 'PENDIENTE',
      diasVigencia: 15,
    });
  });

  it('guarda cotización y líneas en UNA transacción, con el mismo cliente, y la confirma al final', async () => {
    await crearCotizacion({ ...BASE, lineas: LINEAS, anticipoPorcentaje: 0 });
    expect(sentencias()).toEqual(['BEGIN', 'COMMIT']);
    expect(cot.create.mock.calls[0][0]).toBe(client);
    expect(items.reemplazar.mock.calls[0][0]).toBe(client);
    expect(items.reemplazar.mock.calls[0][1]).toBe('cot-1');
    expect(items.reemplazar.mock.calls[0][2].map((l: { subtotal: string }) => l.subtotal)).toEqual(['125.00', '25.00']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('si falla al guardar las líneas revierte la transacción: no queda cotización a medias', async () => {
    items.reemplazar.mockRejectedValueOnce(new Error('fallo de la base'));
    await expect(crearCotizacion({ ...BASE, lineas: LINEAS, anticipoPorcentaje: 0 })).rejects.toThrow('fallo de la base');
    expect(sentencias()).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rechaza líneas inválidas ANTES de abrir ninguna transacción', async () => {
    await expect(crearCotizacion({ ...BASE, lineas: [{ descripcion: '', cantidad: 0, precio_unitario: -1 }] })).rejects.toBeInstanceOf(LineasInvalidasError);
    expect(poolMock.connect).not.toHaveBeenCalled();
    expect(cot.create).not.toHaveBeenCalled();
  });

  it('no mezcla valor manual y líneas, y no acepta líneas si la tabla aún no existe', async () => {
    await expect(crearCotizacion({ ...BASE, valor: 100, lineas: LINEAS })).rejects.toBeInstanceOf(LineasYValorError);
    esquema.items = false;
    await expect(crearCotizacion({ ...BASE, lineas: LINEAS })).rejects.toBeInstanceOf(LineasNoDisponiblesError);
    expect(cot.create).not.toHaveBeenCalled();
  });

  it('conserva las reglas existentes: IVA solo 0 o 15 y el método de anticipo según el porcentaje', async () => {
    await expect(crearCotizacion({ ...BASE, lineas: LINEAS, ivaPorcentaje: 12 })).rejects.toThrow();
    await expect(crearCotizacion({ ...BASE, lineas: LINEAS, anticipoPorcentaje: 50 })).rejects.toThrow(); // falta el método
    expect(cot.create).not.toHaveBeenCalled();
    await crearCotizacion({ ...BASE, lineas: [{ descripcion: 'Muestra', cantidad: 1, precio_unitario: 0 }], ivaPorcentaje: 0, anticipoPorcentaje: 0 });
    expect(cot.create.mock.calls[0][1]).toMatchObject({ valor: 0, total: 0, anticipoValor: 0, saldoPendiente: 0, estadoAnticipo: 'NO_APLICA' }); // subtotal 0 permitido
  });

  it('el camino anterior con `valor` no cambia: sin transacción y sin tocar las líneas', async () => {
    await crearCotizacion({ ...BASE, valor: 300, anticipoPorcentaje: 0 });
    expect(poolMock.connect).not.toHaveBeenCalled();
    expect(items.reemplazar).not.toHaveBeenCalled();
    expect(cot.create.mock.calls[0][0]).toBe(poolMock);
    expect(cot.create.mock.calls[0][1]).toMatchObject({ valor: 300, subtotal: 300, ivaValor: 45, total: 345 });
  });

  it('exige que la solicitud exista y esté EN_REVISION como siempre', async () => {
    sol.findById.mockResolvedValueOnce(null);
    await expect(crearCotizacion({ ...BASE, lineas: LINEAS })).rejects.toThrow();
    sol.findById.mockResolvedValueOnce({ id: 'sol-1', estado: 'COTIZADA' });
    await expect(crearCotizacion({ ...BASE, lineas: LINEAS })).rejects.toThrow();
    expect(poolMock.connect).not.toHaveBeenCalled();
  });
});

describe('editar un borrador: bloqueo y validación del estado dentro de la transacción', () => {
  it('bloquea la fila (FOR UPDATE), actualiza importes y líneas en la misma transacción y reinicia la vigencia', async () => {
    const r = await editarCotizacionBorrador('cot-1', { lineas: LINEAS, descripcion: 'nueva nota', anticipoPorcentaje: 0, diasVigencia: 20 });
    expect(sentencias()).toEqual(['BEGIN', 'SELECT estado', 'COMMIT']);
    expect(String(client.query.mock.calls[1][0])).toContain('FOR UPDATE');
    expect(cot.updateCondiciones.mock.calls[0][0]).toBe('cot-1');
    expect(cot.updateCondiciones.mock.calls[0][1]).toMatchObject({ valor: 150, subtotal: 150, total: 172.5, diasVigencia: 20, descripcion: 'nueva nota' });
    expect(cot.updateCondiciones.mock.calls[0][2]).toBe(client);
    expect(items.reemplazar.mock.calls[0][0]).toBe(client);
    expect(r).toMatchObject({ id: 'cot-1', valor: 150 });
  });

  it('si la cotización ya fue ENVIADA (u otro estado) rechaza la edición sin escribir nada', async () => {
    for (const estado of ['ENVIADA', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CANCELADA']) {
      client.query.mockImplementation(async (sql: string) => (/FOR UPDATE/.test(sql) ? { rows: [{ estado }] } : { rows: [] }));
      await expect(editarCotizacionBorrador('cot-1', { lineas: LINEAS, descripcion: null, anticipoPorcentaje: 0 })).rejects.toBeInstanceOf(CotizacionNoEditableError);
    }
    expect(cot.updateCondiciones).not.toHaveBeenCalled();
    expect(items.reemplazar).not.toHaveBeenCalled();
    expect(sentencias().filter((s) => s === 'ROLLBACK')).toHaveLength(5);
  });

  it('una cotización inexistente responde «no encontrada»', async () => {
    client.query.mockImplementation(async (sql: string) => (/FOR UPDATE/.test(sql) ? { rows: [] } : { rows: [] }));
    await expect(editarCotizacionBorrador('x', { lineas: LINEAS, descripcion: null, anticipoPorcentaje: 0 })).rejects.toBeInstanceOf(CotizacionNoEncontradaError);
  });

  it('valida las líneas antes de bloquear nada', async () => {
    await expect(editarCotizacionBorrador('cot-1', { lineas: [], descripcion: null })).rejects.toBeInstanceOf(LineasInvalidasError);
    expect(poolMock.connect).not.toHaveBeenCalled();
  });

  it('si falla al guardar las líneas revierte: los importes y las líneas anteriores se conservan', async () => {
    items.reemplazar.mockRejectedValueOnce(new Error('fallo'));
    await expect(editarCotizacionBorrador('cot-1', { lineas: LINEAS, descripcion: null, anticipoPorcentaje: 0 })).rejects.toThrow('fallo');
    expect(sentencias()).toEqual(['BEGIN', 'SELECT estado', 'ROLLBACK']);
  });

  it('borrador histórico sin líneas: el valor manual sigue funcionando; con líneas ya guardadas exige editar con líneas', async () => {
    const r = await editarCotizacionBorrador('cot-1', { valor: 200, descripcion: null, anticipoPorcentaje: 0 });
    expect(r).toMatchObject({ valor: 200 });
    expect(items.reemplazar).not.toHaveBeenCalled(); // no se guarda ninguna conversión
    items.listarPorCotizacion.mockResolvedValueOnce([{ id: 'i1' }]);
    await expect(editarCotizacionBorrador('cot-1', { valor: 200, descripcion: null, anticipoPorcentaje: 0 })).rejects.toBeInstanceOf(LineasRequeridasError);
  });

  it('con la tabla de líneas inexistente la edición anterior no cambia (UPDATE condicional sin transacción)', async () => {
    esquema.items = false;
    await editarCotizacionBorrador('cot-1', { valor: 120, descripcion: null, anticipoPorcentaje: 0 });
    expect(poolMock.connect).not.toHaveBeenCalled();
    expect(cot.updateCondiciones.mock.calls[0]).toHaveLength(2);
    await expect(editarCotizacionBorrador('cot-1', { lineas: LINEAS, descripcion: null })).rejects.toBeInstanceOf(LineasNoDisponiblesError);
  });

  it('no acepta valor y líneas a la vez', async () => {
    await expect(editarCotizacionBorrador('cot-1', { valor: 5, lineas: LINEAS, descripcion: null })).rejects.toBeInstanceOf(LineasYValorError);
  });
});

describe('buscador de conceptos ya usados', () => {
  it('sin la tabla informa que no está disponible; con menos de 2 caracteres no consulta', async () => {
    esquema.items = false;
    expect(await sugerirConceptosUsados('torn')).toEqual({ disponible: false, sugerencias: [] });
    esquema.items = true;
    expect(await sugerirConceptosUsados('t')).toEqual({ disponible: true, sugerencias: [] });
    expect(await sugerirConceptosUsados(undefined)).toEqual({ disponible: true, sugerencias: [] });
    expect(items.sugerirConceptos).not.toHaveBeenCalled();
  });

  it('busca sin tildes ni mayúsculas, escapa los comodines y limita a 10 resultados', async () => {
    items.sugerirConceptos.mockResolvedValueOnce([{ descripcion: 'Torneado', ultimo_precio_unitario: '12.50', veces_usado: 3, ultima_vez: 'x' }]);
    const r = await sugerirConceptosUsados('  TORNÉADO_100% ');
    // «_» se lee como espacio (igual que la búsqueda global) y «%» se busca literalmente (escapado).
    expect(items.sugerirConceptos).toHaveBeenCalledWith('%torneado 100\\%%', 10);
    expect(r.sugerencias).toHaveLength(1);
  });
});
