import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fase 2 — «Dinero acreditado» en el controlador: el alias DINERO_ACREDITADO equivale a CONFIRMAR_TELEFONICA, los datos
// de trazabilidad (observaciones, llamadaEn, seguimiento) llegan al servicio, y los errores nuevos responden 400/409
// (nunca 500). Sin base de datos ni correo: servicios simulados, clases de error REALES.

const COT_ID = '75f33350-e236-46e4-8072-b1a91ec16462';
const ADMIN_ID = '0d36d17b-1f70-4da3-9780-dadcc154ae91';

const mocks = vi.hoisted(() => ({
  confirmarDirecta: vi.fn(),
  telefonica: vi.fn(),
  rechazar: vi.fn(),
  gestion: vi.fn(),
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
  return { ...real, obtenerCotizacion: mocks.obtener };
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

import { gestionarAnticipoController, gestionarSaldoController } from './cotizaciones.controller.js';
import { AnticipoRequiereComprobanteError, AnticipoRequiereRevisionError } from '../services/cotizaciones.service.js';
import { DatosDeGestionInvalidosError } from '../services/transferenciasPago.service.js';

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

async function ejecutar(controlador: typeof gestionarAnticipoController, rol: string, body: Record<string, unknown>) {
  const res = respuesta();
  const req = { params: { id: COT_ID }, body, user: { sub: 'usuario-1', rol } } as unknown as Request;
  await controlador(req, res as unknown as Response);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.obtener.mockResolvedValue({ id: COT_ID });
  mocks.telefonica.mockResolvedValue({ id: 'tp-1' });
  mocks.gestion.mockResolvedValue({ id: 'tp-2' });
  mocks.rechazar.mockResolvedValue({ id: 'tp-3' });
  mocks.confirmarDirecta.mockResolvedValue({ id: 'tp-4' });
});

describe.each([
  ['anticipo', gestionarAnticipoController, 'ANTICIPO'],
  ['saldo', gestionarSaldoController, 'SALDO'],
] as const)('PATCH /:id/%s — «Dinero acreditado»', (_nombre, controlador, tipoPago) => {
  it('DINERO_ACREDITADO es un alias de CONFIRMAR_TELEFONICA y pasa verificador, observaciones y hora de la llamada al servicio', async () => {
    const llamada = '2026-10-28T15:30:00.000Z';
    const res = await ejecutar(controlador, 'COMERCIAL', {
      accion: 'DINERO_ACREDITADO', verificadorId: ADMIN_ID, observaciones: 'ADMIN confirmó el ingreso', llamadaEn: llamada, metodo: 'TRANSFERENCIA',
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.telefonica).toHaveBeenCalledTimes(1);
    expect(mocks.telefonica.mock.calls[0][0]).toMatchObject({
      cotizacionId: COT_ID, tipoPago, verificadorId: ADMIN_ID, registradoPor: 'usuario-1',
      observaciones: 'ADMIN confirmó el ingreso', llamadaEn: new Date(llamada), seguimiento: false,
    });
  });

  it('el alias conserva los permisos: solo COMERCIAL puede registrarlo (ADMIN recibe 403 y el servicio no se llama)', async () => {
    const res = await ejecutar(controlador, 'ADMIN', { accion: 'DINERO_ACREDITADO', verificadorId: ADMIN_ID });
    expect(res.statusCode).toBe(403);
    expect(mocks.telefonica).not.toHaveBeenCalled();
  });

  it('sin llamadaEn la hora real queda en null', async () => {
    await ejecutar(controlador, 'COMERCIAL', { accion: 'CONFIRMAR_TELEFONICA', verificadorId: ADMIN_ID, metodo: 'TRANSFERENCIA' });
    expect(mocks.telefonica.mock.calls[0][0]).toMatchObject({ llamadaEn: null, observaciones: null });
  });

  it('GESTIONAR con seguimiento pasa seguimiento y observaciones al servicio', async () => {
    const res = await ejecutar(controlador, 'COMERCIAL', { accion: 'GESTIONAR', importeDeclarado: 10, seguimiento: true, observaciones: 'ADMIN no respondió' });
    expect(res.statusCode).toBe(200);
    expect(mocks.gestion.mock.calls[0][0]).toMatchObject({ seguimiento: true, observaciones: 'ADMIN no respondió' });
  });

  it('RECHAZAR conserva su contrato y admite observaciones', async () => {
    const res = await ejecutar(controlador, 'COMERCIAL', { accion: 'RECHAZAR', motivoRechazo: 'IMPORTE_INCORRECTO', observaciones: 'no coincide' });
    expect(res.statusCode).toBe(200);
    expect(mocks.rechazar.mock.calls[0][0]).toMatchObject({ observaciones: 'no coincide' });
  });

  it.each([
    ['observaciones que no es texto', { observaciones: 123 }],
    ['seguimiento que no es booleano', { seguimiento: 'si' }],
    ['llamadaEn que no es texto', { llamadaEn: 12345 }],
  ])('%s -> 400 y el servicio no se llama', async (_caso, extra) => {
    const res = await ejecutar(controlador, 'COMERCIAL', { accion: 'CONFIRMAR_TELEFONICA', verificadorId: ADMIN_ID, metodo: 'TRANSFERENCIA', ...extra });
    expect(res.statusCode).toBe(400);
    expect(mocks.telefonica).not.toHaveBeenCalled();
  });

  it('errores del servicio: sin comprobante -> 409, sin revisión -> 409, datos inválidos -> 400 (nunca 500)', async () => {
    mocks.telefonica.mockRejectedValueOnce(new AnticipoRequiereComprobanteError());
    const sinComprobante = await ejecutar(controlador, 'COMERCIAL', { accion: 'DINERO_ACREDITADO', verificadorId: ADMIN_ID, metodo: 'TRANSFERENCIA' });
    expect(sinComprobante.statusCode).toBe(409);
    expect(JSON.stringify(sinComprobante.cuerpo)).toMatch(/comprobante/i);

    mocks.telefonica.mockRejectedValueOnce(new AnticipoRequiereRevisionError());
    const sinRevision = await ejecutar(controlador, 'COMERCIAL', { accion: 'DINERO_ACREDITADO', verificadorId: ADMIN_ID, metodo: 'TRANSFERENCIA' });
    expect(sinRevision.statusCode).toBe(409);
    expect(JSON.stringify(sinRevision.cuerpo)).toMatch(/revisi/i);

    mocks.gestion.mockRejectedValueOnce(new DatosDeGestionInvalidosError('observaciones es requerida al registrar un seguimiento.'));
    const invalido = await ejecutar(controlador, 'COMERCIAL', { accion: 'GESTIONAR', importeDeclarado: 10, seguimiento: true });
    expect(invalido.statusCode).toBe(400);
    expect(JSON.stringify(invalido.cuerpo)).toContain('observaciones');
  });

  it('VALIDAR directo de ADMIN también recibe los datos de trazabilidad y los errores nuevos responden 409', async () => {
    mocks.confirmarDirecta.mockRejectedValueOnce(new AnticipoRequiereRevisionError());
    const res = await ejecutar(controlador, 'ADMIN', { accion: 'VALIDAR', metodo: 'EFECTIVO', observaciones: 'directo' });
    expect(res.statusCode).toBe(409);
    expect(mocks.confirmarDirecta.mock.calls[0][0]).toMatchObject({ observaciones: 'directo' });
  });
});
