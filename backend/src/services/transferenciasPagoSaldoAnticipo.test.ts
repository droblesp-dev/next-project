import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regla F1: el saldo no se gestiona (registrar, rechazar ni validar) mientras el anticipo esté
// PENDIENTE, RECHAZADO o sin definir (NULL). Pruebas unitarias SIN base de datos: la conexión, los
// repositorios y los servicios colaboradores están simulados; se comprueba que la operación se corta
// ANTES de cualquier escritura y que la transacción termina en ROLLBACK.

const COT_ID = '75f33350-e236-46e4-8072-b1a91ec16462';
const USUARIO_ID = 'bf611e4b-3592-4408-9c64-db487b4c6cf6';
const ADMIN_ID = '0d36d17b-1f70-4da3-9780-dadcc154ae91';

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
const repos = vi.hoisted(() => ({
  findById: vi.fn(),
  reabrirSaldo: vi.fn(),
  lockParaTransferencia: vi.fn(),
  actualizarEstadoAnticipo: vi.fn(),
  validarSaldo: vi.fn(),
  rechazarSaldo: vi.fn(),
  obtenerVigente: vi.fn(),
  marcarNoVigente: vi.fn(),
  crear: vi.fn(),
  cuentaFindById: vi.fn(),
  findByIdWithRol: vi.fn(),
  crearOrdenAutomatica: vi.fn(),
}));

vi.mock('../config/db.js', () => ({ pool: { connect: vi.fn(async () => client), query: vi.fn() } }));
vi.mock('../config/env.js', () => ({
  env: { cotizacionLinkSecret: 'secreto-de-prueba', datosBancarios: {}, corsOrigins: [], frontendUrl: '' },
}));
vi.mock('../repositories/cotizaciones.repository.js', () => ({
  findById: repos.findById,
  reabrirSaldo: repos.reabrirSaldo,
  lockParaTransferencia: repos.lockParaTransferencia,
  actualizarEstadoAnticipo: repos.actualizarEstadoAnticipo,
  validarSaldo: repos.validarSaldo,
  rechazarSaldo: repos.rechazarSaldo,
}));
vi.mock('../repositories/transferenciasPago.repository.js', () => ({
  obtenerVigente: repos.obtenerVigente,
  marcarNoVigente: repos.marcarNoVigente,
  crear: repos.crear,
}));
vi.mock('../repositories/cuentasBancarias.repository.js', () => ({ findById: repos.cuentaFindById }));
vi.mock('../repositories/usuarios.repository.js', () => ({ findByIdWithRol: repos.findByIdWithRol }));
vi.mock('../repositories/comprobantesPagoCliente.repository.js', () => ({ registrar: vi.fn() }));
vi.mock('../repositories/solicitudes.repository.js', () => ({ findById: vi.fn() }));
vi.mock('./cuentasBancarias.service.js', () => ({ listarCuentasActivasPublico: vi.fn() }));
vi.mock('./ordenAutomatica.service.js', () => ({ crearOrdenAutomatica: repos.crearOrdenAutomatica }));
vi.mock('./leads.service.js', () => ({ convertirLeadPorAceptacion: vi.fn() }));
vi.mock('./email.service.js', () => ({ enviarCodigoTemporalCotizacion: vi.fn(), enviarCodigoAccesoRegenerado: vi.fn() }));

import * as cotizacionesService from './cotizaciones.service.js';
import {
  ComprobanteSaldoRequeridoError,
  confirmarAcreditacionDirecta,
  MetodoSaldoInvalidoError,
  MetodoSaldoRequeridoError,
  PagoNoConfirmableError,
  registrarConfirmacionTelefonica,
  registrarGestionPago,
  rechazarPago,
  SaldoRequiereAnticipoValidadoError,
} from './transferenciasPago.service.js';

function bloqueo(sobreescribir: Record<string, unknown> = {}) {
  return {
    estado: 'ACEPTADA',
    estado_anticipo: 'VALIDADO',
    estado_saldo: 'PENDIENTE',
    anticipo_valor: '100.00',
    saldo_pendiente: '100.00',
    comprobante_anticipo: 'a.png',
    comprobante_saldo: null,
    metodo_anticipo: 'TRANSFERENCIA',
    metodo_saldo: null,
    ...sobreescribir,
  };
}

function consultasSql(): string[] {
  return client.query.mock.calls.map((llamada) => String(llamada[0]));
}

function noEscribio() {
  expect(repos.validarSaldo).not.toHaveBeenCalled();
  expect(repos.rechazarSaldo).not.toHaveBeenCalled();
  expect(repos.actualizarEstadoAnticipo).not.toHaveBeenCalled();
  expect(repos.obtenerVigente).not.toHaveBeenCalled();
  expect(repos.marcarNoVigente).not.toHaveBeenCalled();
  expect(repos.crear).not.toHaveBeenCalled();
  expect(repos.crearOrdenAutomatica).not.toHaveBeenCalled();
  expect(consultasSql()).toContain('ROLLBACK');
  expect(consultasSql()).not.toContain('COMMIT');
  expect(client.release).toHaveBeenCalledTimes(1);
}

beforeEach(() => {
  vi.clearAllMocks();
  client.query.mockResolvedValue({ rows: [] });
  repos.obtenerVigente.mockResolvedValue(null);
  repos.crear.mockImplementation(async (datos: Record<string, unknown>) => ({ id: 'tp-1', ...datos }));
  repos.findByIdWithRol.mockResolvedValue({ id: ADMIN_ID, activo: true, rol: 'ADMIN' });
  repos.validarSaldo.mockResolvedValue({ id: COT_ID });
  repos.rechazarSaldo.mockResolvedValue({ id: COT_ID });
  repos.actualizarEstadoAnticipo.mockResolvedValue({ id: COT_ID });
});

const ANTICIPOS_QUE_BLOQUEAN: Array<[string, string | null]> = [
  ['PENDIENTE', 'PENDIENTE'],
  ['RECHAZADO', 'RECHAZADO'],
  ['NULL (cotización anterior a D.2)', null],
];

describe.each(ANTICIPOS_QUE_BLOQUEAN)('saldo con anticipo %s: operación bloqueada sin escribir', (_nombre, anticipo) => {
  beforeEach(() => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: anticipo }));
  });

  it('VALIDAR directo de ADMIN (confirmarAcreditacionDirecta) lanza SaldoRequiereAnticipoValidadoError', async () => {
    await expect(
      confirmarAcreditacionDirecta({ cotizacionId: COT_ID, tipoPago: 'SALDO', adminId: ADMIN_ID, metodoSaldo: 'EFECTIVO' })
    ).rejects.toBeInstanceOf(SaldoRequiereAnticipoValidadoError);
    noEscribio();
  });

  it('confirmación telefónica de COMERCIAL (registrarConfirmacionTelefonica) lanza el mismo error', async () => {
    await expect(
      registrarConfirmacionTelefonica({
        cotizacionId: COT_ID,
        tipoPago: 'SALDO',
        verificadorId: ADMIN_ID,
        registradoPor: USUARIO_ID,
        metodoSaldo: 'EFECTIVO',
      })
    ).rejects.toBeInstanceOf(SaldoRequiereAnticipoValidadoError);
    noEscribio();
  });

  it('rechazo de saldo (rechazarPago) lanza el mismo error', async () => {
    await expect(
      rechazarPago({ cotizacionId: COT_ID, tipoPago: 'SALDO', motivoRechazo: 'COMPROBANTE_ILEGIBLE', rechazadoPor: USUARIO_ID })
    ).rejects.toBeInstanceOf(SaldoRequiereAnticipoValidadoError);
    noEscribio();
  });

  it('gestión de saldo (registrarGestionPago) lanza el mismo error', async () => {
    await expect(
      registrarGestionPago({ cotizacionId: COT_ID, tipoPago: 'SALDO', importeDeclarado: 50, gestionadoPor: USUARIO_ID })
    ).rejects.toBeInstanceOf(SaldoRequiereAnticipoValidadoError);
    noEscribio();
  });

  it('el error específico se comprueba antes que el método y el comprobante del saldo', async () => {
    // Sin método ni comprobante, el error esperado es el del anticipo, no MetodoSaldoRequeridoError.
    await expect(
      confirmarAcreditacionDirecta({ cotizacionId: COT_ID, tipoPago: 'SALDO', adminId: ADMIN_ID })
    ).rejects.toBeInstanceOf(SaldoRequiereAnticipoValidadoError);
  });
});

describe.each([['VALIDADO'], ['NO_APLICA']])('saldo con anticipo %s: operación permitida', (anticipo) => {
  beforeEach(() => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: anticipo }));
  });

  it('VALIDAR de saldo por EFECTIVO se registra y confirma la transacción', async () => {
    const creado = await confirmarAcreditacionDirecta({
      cotizacionId: COT_ID,
      tipoPago: 'SALDO',
      adminId: ADMIN_ID,
      metodoSaldo: 'EFECTIVO',
    });
    expect(repos.validarSaldo).toHaveBeenCalledWith(COT_ID, ADMIN_ID, 'EFECTIVO', client);
    expect(repos.crear).toHaveBeenCalledTimes(1);
    expect(creado).toMatchObject({ estado: 'VALIDADO', tipoPago: 'SALDO', medioConfirmacion: 'DIRECTO' });
    expect(consultasSql()).toContain('COMMIT');
    // la orden automática solo aplica al anticipo, nunca al saldo
    expect(repos.crearOrdenAutomatica).not.toHaveBeenCalled();
  });

  it('rechazo y gestión de saldo se registran', async () => {
    await rechazarPago({ cotizacionId: COT_ID, tipoPago: 'SALDO', motivoRechazo: 'COMPROBANTE_ILEGIBLE', rechazadoPor: USUARIO_ID });
    expect(repos.rechazarSaldo).toHaveBeenCalledTimes(1);
    await registrarGestionPago({ cotizacionId: COT_ID, tipoPago: 'SALDO', importeDeclarado: 50, gestionadoPor: USUARIO_ID });
    expect(repos.crear).toHaveBeenCalledTimes(2);
  });

  it('si el UPDATE condicional no afecta ninguna fila (carrera) lanza PagoNoConfirmableError y hace ROLLBACK', async () => {
    repos.validarSaldo.mockResolvedValue(null);
    await expect(
      confirmarAcreditacionDirecta({ cotizacionId: COT_ID, tipoPago: 'SALDO', adminId: ADMIN_ID, metodoSaldo: 'EFECTIVO' })
    ).rejects.toBeInstanceOf(PagoNoConfirmableError);
    expect(repos.crear).not.toHaveBeenCalled();
    expect(consultasSql()).toContain('ROLLBACK');
    expect(consultasSql()).not.toContain('COMMIT');
  });
});

describe('errores funcionales del saldo (mismas clases que reconoce el controlador)', () => {
  beforeEach(() => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: 'NO_APLICA' }));
  });

  it('las clases exportadas por transferenciasPago.service son las de cotizaciones.service (sin copias)', () => {
    expect(MetodoSaldoRequeridoError).toBe(cotizacionesService.MetodoSaldoRequeridoError);
    expect(MetodoSaldoInvalidoError).toBe(cotizacionesService.MetodoSaldoInvalidoError);
    expect(ComprobanteSaldoRequeridoError).toBe(cotizacionesService.ComprobanteSaldoRequeridoError);
    expect(SaldoRequiereAnticipoValidadoError).toBe(cotizacionesService.SaldoRequiereAnticipoValidadoError);
  });

  it('VALIDAR sin método lanza la clase compartida MetodoSaldoRequeridoError', async () => {
    const promesa = confirmarAcreditacionDirecta({ cotizacionId: COT_ID, tipoPago: 'SALDO', adminId: ADMIN_ID });
    await expect(promesa).rejects.toBeInstanceOf(cotizacionesService.MetodoSaldoRequeridoError);
    expect(repos.validarSaldo).not.toHaveBeenCalled();
  });

  it('VALIDAR con método inválido lanza la clase compartida MetodoSaldoInvalidoError', async () => {
    const promesa = confirmarAcreditacionDirecta({ cotizacionId: COT_ID, tipoPago: 'SALDO', adminId: ADMIN_ID, metodoSaldo: 'CHEQUE' });
    await expect(promesa).rejects.toBeInstanceOf(cotizacionesService.MetodoSaldoInvalidoError);
  });

  it('VALIDAR por TRANSFERENCIA sin comprobante lanza la clase compartida ComprobanteSaldoRequeridoError', async () => {
    const promesa = confirmarAcreditacionDirecta({
      cotizacionId: COT_ID,
      tipoPago: 'SALDO',
      adminId: ADMIN_ID,
      metodoSaldo: 'TRANSFERENCIA',
    });
    await expect(promesa).rejects.toBeInstanceOf(cotizacionesService.ComprobanteSaldoRequeridoError);
  });
});

describe('el anticipo no cambia su comportamiento', () => {
  it('confirmar el anticipo PENDIENTE sigue funcionando y crea la orden automática después del COMMIT', async () => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: 'PENDIENTE' }));
    // Anticipo por TRANSFERENCIA: acreditarlo exige la revisión previa de COMERCIAL (gestión vigente PENDIENTE);
    // el bloqueo ya trae el comprobante del cliente.
    repos.obtenerVigente.mockResolvedValue({ estado: 'PENDIENTE', importe_declarado: '100.00' });
    await confirmarAcreditacionDirecta({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', adminId: ADMIN_ID });
    expect(repos.actualizarEstadoAnticipo).toHaveBeenCalledWith(COT_ID, 'VALIDADO', ADMIN_ID, client);
    expect(consultasSql()).toContain('COMMIT');
    expect(repos.crearOrdenAutomatica).toHaveBeenCalledWith(COT_ID, 'ANTICIPO_VALIDADO');
  });

  it('rechazar el anticipo PENDIENTE sigue funcionando', async () => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: 'PENDIENTE' }));
    await rechazarPago({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', motivoRechazo: 'IMPORTE_INCORRECTO', rechazadoPor: USUARIO_ID });
    expect(repos.actualizarEstadoAnticipo).toHaveBeenCalledWith(COT_ID, 'RECHAZADO', USUARIO_ID, client);
  });

  it('registrar la gestión del anticipo PENDIENTE sigue funcionando', async () => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: 'PENDIENTE' }));
    await registrarGestionPago({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', importeDeclarado: 50, gestionadoPor: USUARIO_ID });
    expect(repos.crear).toHaveBeenCalledTimes(1);
  });
});

describe('reabrirSaldo (cotizaciones.service)', () => {
  it('con el saldo RECHAZADO y el anticipo sin resolver informa SaldoRequiereAnticipoValidadoError', async () => {
    repos.reabrirSaldo.mockResolvedValue(null);
    repos.findById.mockResolvedValue({ id: COT_ID, estado_saldo: 'RECHAZADO', estado_anticipo: 'PENDIENTE' });
    await expect(cotizacionesService.reabrirSaldo(COT_ID)).rejects.toBeInstanceOf(
      cotizacionesService.SaldoRequiereAnticipoValidadoError
    );
  });

  it('con el anticipo VALIDADO y el saldo que no está RECHAZADO conserva SaldoNoRechazadoError', async () => {
    repos.reabrirSaldo.mockResolvedValue(null);
    repos.findById.mockResolvedValue({ id: COT_ID, estado_saldo: 'PENDIENTE', estado_anticipo: 'VALIDADO' });
    await expect(cotizacionesService.reabrirSaldo(COT_ID)).rejects.toBeInstanceOf(cotizacionesService.SaldoNoRechazadoError);
  });

  it('cotización inexistente conserva CotizacionNoEncontradaError', async () => {
    repos.reabrirSaldo.mockResolvedValue(null);
    repos.findById.mockResolvedValue(null);
    await expect(cotizacionesService.reabrirSaldo(COT_ID)).rejects.toBeInstanceOf(
      cotizacionesService.CotizacionNoEncontradaError
    );
  });

  it('con el saldo RECHAZADO y el anticipo VALIDADO el UPDATE aplica y devuelve la cotización', async () => {
    repos.reabrirSaldo.mockResolvedValue({ id: COT_ID, estado_saldo: 'PENDIENTE' });
    await expect(cotizacionesService.reabrirSaldo(COT_ID)).resolves.toMatchObject({ id: COT_ID });
  });
});
