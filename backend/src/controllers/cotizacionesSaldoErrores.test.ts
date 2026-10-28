import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Los errores funcionales esperados del saldo deben terminar en una respuesta HTTP controlada
// (400/404/409), nunca en un 500. Pruebas unitarias SIN base de datos ni correo: la conexión, los
// repositorios y el correo están simulados, y los servicios de pago se reemplazan por funciones que
// lanzan las clases de error REALES (las exportadas por transferenciasPago.service, que son las de
// cotizaciones.service que reconoce el controlador).

const COT_ID = '75f33350-e236-46e4-8072-b1a91ec16462';

const mocks = vi.hoisted(() => ({
  confirmarDirecta: vi.fn(),
  telefonica: vi.fn(),
  rechazar: vi.fn(),
  gestion: vi.fn(),
  reabrir: vi.fn(),
  obtener: vi.fn(),
}));

vi.mock('../config/db.js', () => ({ pool: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../config/env.js', () => ({
  env: { cotizacionLinkSecret: 'secreto-de-prueba', datosBancarios: {}, corsOrigins: [], frontendUrl: '' },
}));
vi.mock('../config/uploadsComprobantes.js', () => ({
  uploadComprobante: { single: vi.fn() },
  generarNombreComprobante: vi.fn(),
  contenidoComprobanteCoincideConMime: vi.fn(),
  COMPROBANTES_DIR: '/tmp/comprobantes-no-usado',
  COMPROBANTE_MAX_BYTES: 5 * 1024 * 1024,
}));
vi.mock('../repositories/cotizaciones.repository.js', () => ({ obtenerContactoParaCorreo: vi.fn(async () => null) }));
vi.mock('../repositories/transferenciasPago.repository.js', () => ({}));
vi.mock('../repositories/cuentasBancarias.repository.js', () => ({}));
vi.mock('../repositories/usuarios.repository.js', () => ({}));
vi.mock('../repositories/comprobantesPagoCliente.repository.js', () => ({}));
vi.mock('../repositories/solicitudes.repository.js', () => ({}));
vi.mock('../services/cuentasBancarias.service.js', () => ({ listarCuentasActivasPublico: vi.fn(), listarCuentasReceptorasActivas: vi.fn() }));
vi.mock('../services/ordenAutomatica.service.js', () => ({ crearOrdenAutomatica: vi.fn() }));
vi.mock('../services/leads.service.js', () => ({ convertirLeadPorAceptacion: vi.fn() }));
vi.mock('../services/email.service.js', () => ({
  enviarCodigoTemporalCotizacion: vi.fn(),
  enviarCodigoAccesoRegenerado: vi.fn(),
  enviarEnlaceCotizacion: vi.fn(),
  enviarComprobanteRechazado: vi.fn(),
  enviarPagoConfirmado: vi.fn(),
}));
vi.mock('../services/cotizaciones.service.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/cotizaciones.service.js')>();
  return { ...real, reabrirSaldo: mocks.reabrir, obtenerCotizacion: mocks.obtener };
});
vi.mock('../services/transferenciasPago.service.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/transferenciasPago.service.js')>();
  return {
    ...real,
    confirmarAcreditacionDirecta: mocks.confirmarDirecta,
    registrarConfirmacionTelefonica: mocks.telefonica,
    rechazarPago: mocks.rechazar,
    registrarGestionPago: mocks.gestion,
  };
});

import { gestionarSaldoController, reabrirSaldoController } from './cotizaciones.controller.js';
import {
  AccionNoPermitidaError,
  ComprobanteSaldoRequeridoError,
  CotizacionNoEncontradaError,
  MetodoSaldoInvalidoError,
  MetodoSaldoRequeridoError,
  SaldoRequiereAnticipoValidadoError,
} from '../services/cotizaciones.service.js';
import { PagoNoConfirmableError } from '../services/transferenciasPago.service.js';

function respuesta() {
  const res = { statusCode: 0, cuerpo: undefined as unknown, status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation((codigo: number) => {
    res.statusCode = codigo;
    return res;
  });
  res.json.mockImplementation((cuerpo: unknown) => {
    res.cuerpo = cuerpo;
    return res;
  });
  return res;
}

function peticion(rol: string, body: Record<string, unknown>) {
  return { params: { id: COT_ID }, body, user: { sub: 'usuario-1', rol } } as unknown as Request;
}

async function ejecutar(rol: string, body: Record<string, unknown>) {
  const res = respuesta();
  await gestionarSaldoController(peticion(rol, body), res as unknown as Response);
  return res;
}

const ERRORES_FUNCIONALES: Array<[string, () => Error, number]> = [
  ['SaldoRequiereAnticipoValidadoError', () => new SaldoRequiereAnticipoValidadoError(), 409],
  ['MetodoSaldoRequeridoError', () => new MetodoSaldoRequeridoError(), 400],
  ['MetodoSaldoInvalidoError', () => new MetodoSaldoInvalidoError(), 400],
  ['ComprobanteSaldoRequeridoError', () => new ComprobanteSaldoRequeridoError(), 409],
  ['PagoNoConfirmableError', () => new PagoNoConfirmableError(), 409],
  ['AccionNoPermitidaError', () => new AccionNoPermitidaError(), 409],
  ['CotizacionNoEncontradaError', () => new CotizacionNoEncontradaError(), 404],
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.obtener.mockResolvedValue({ id: COT_ID });
});

describe('PATCH /:id/saldo: VALIDAR (ADMIN) responde con códigos controlados', () => {
  it.each(ERRORES_FUNCIONALES)('%s -> %i', async (_nombre, crear, esperado) => {
    mocks.confirmarDirecta.mockRejectedValue(crear());
    const res = await ejecutar('ADMIN', { accion: 'VALIDAR', metodo: 'EFECTIVO' });
    expect(res.statusCode).toBe(esperado);
    expect(res.statusCode).not.toBe(500);
  });

  it('el bloqueo por anticipo explica la causa', async () => {
    mocks.confirmarDirecta.mockRejectedValue(new SaldoRequiereAnticipoValidadoError());
    const res = await ejecutar('ADMIN', { accion: 'VALIDAR', metodo: 'EFECTIVO' });
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.cuerpo)).toContain('anticipo');
  });

  it('un error inesperado NO se disfraza: se propaga al manejador global (único caso de 500)', async () => {
    mocks.confirmarDirecta.mockRejectedValue(new Error('fallo inesperado'));
    await expect(ejecutar('ADMIN', { accion: 'VALIDAR', metodo: 'EFECTIVO' })).rejects.toThrow('fallo inesperado');
  });
});

describe('PATCH /:id/saldo: el resto de operaciones también responde 409 con el anticipo sin resolver', () => {
  it('RECHAZAR (COMERCIAL)', async () => {
    mocks.rechazar.mockRejectedValue(new SaldoRequiereAnticipoValidadoError());
    const res = await ejecutar('COMERCIAL', { accion: 'RECHAZAR', motivoRechazo: 'COMPROBANTE_ILEGIBLE' });
    expect(res.statusCode).toBe(409);
  });

  it('CONFIRMAR_TELEFONICA (COMERCIAL)', async () => {
    mocks.telefonica.mockRejectedValue(new SaldoRequiereAnticipoValidadoError());
    const res = await ejecutar('COMERCIAL', { accion: 'CONFIRMAR_TELEFONICA', verificadorId: 'admin-1', metodo: 'EFECTIVO' });
    expect(res.statusCode).toBe(409);
  });

  it('GESTIONAR (COMERCIAL)', async () => {
    mocks.gestion.mockRejectedValue(new SaldoRequiereAnticipoValidadoError());
    const res = await ejecutar('COMERCIAL', { accion: 'GESTIONAR', importeDeclarado: 50 });
    expect(res.statusCode).toBe(409);
  });
});

describe('PATCH /:id/saldo: los permisos por rol no cambian', () => {
  it('COMERCIAL no puede usar VALIDAR (403) y no llega al servicio', async () => {
    const res = await ejecutar('COMERCIAL', { accion: 'VALIDAR', metodo: 'EFECTIVO' });
    expect(res.statusCode).toBe(403);
    expect(mocks.confirmarDirecta).not.toHaveBeenCalled();
  });

  it('ADMIN no puede usar RECHAZAR ni CONFIRMAR_TELEFONICA (403)', async () => {
    expect((await ejecutar('ADMIN', { accion: 'RECHAZAR', motivoRechazo: 'OTRO' })).statusCode).toBe(403);
    expect((await ejecutar('ADMIN', { accion: 'CONFIRMAR_TELEFONICA', verificadorId: 'admin-1' })).statusCode).toBe(403);
    expect(mocks.rechazar).not.toHaveBeenCalled();
    expect(mocks.telefonica).not.toHaveBeenCalled();
  });
});

describe('PATCH /:id/saldo/reabrir', () => {
  it('con el anticipo sin resolver responde 409 (no 500)', async () => {
    mocks.reabrir.mockRejectedValue(new SaldoRequiereAnticipoValidadoError());
    const res = respuesta();
    await reabrirSaldoController({ params: { id: COT_ID } } as unknown as Request, res as unknown as Response);
    expect(res.statusCode).toBe(409);
    expect(JSON.stringify(res.cuerpo)).toContain('anticipo');
  });
});
