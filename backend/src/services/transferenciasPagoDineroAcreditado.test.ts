import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fase 2 — «Dinero acreditado». Pruebas unitarias SIN base de datos (conexión, repositorios y colaboradores
// simulados). Reglas: acreditar un anticipo por TRANSFERENCIA exige el comprobante del cliente y la revisión
// previa de COMERCIAL en TODAS las vías (telefónica y VALIDAR directo); el efectivo conserva su flujo; los datos de
// trazabilidad (observaciones, hora real de la llamada) se validan y se guardan; el seguimiento mantiene el pago
// PENDIENTE y nunca puede ser la primera gestión.

const COT_ID = '75f33350-e236-46e4-8072-b1a91ec16462';
const COMERCIAL_ID = 'bf611e4b-3592-4408-9c64-db487b4c6cf6';
const ADMIN_ID = '0d36d17b-1f70-4da3-9780-dadcc154ae91';

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
const repos = vi.hoisted(() => ({
  findById: vi.fn(),
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
  AnticipoRequiereComprobanteError,
  AnticipoRequiereRevisionError,
  confirmarAcreditacionDirecta,
  DatosDeGestionInvalidosError,
  OBSERVACIONES_MAX,
  PagoNoConfirmableError,
  rechazarPago,
  registrarConfirmacionTelefonica,
  registrarGestionPago,
} from './transferenciasPago.service.js';

function bloqueo(sobreescribir: Record<string, unknown> = {}) {
  return {
    estado: 'ACEPTADA',
    estado_anticipo: 'PENDIENTE',
    estado_saldo: 'PENDIENTE',
    anticipo_valor: '63.25',
    saldo_pendiente: '63.25',
    comprobante_anticipo: 'comprobante.png',
    comprobante_saldo: null,
    metodo_anticipo: 'TRANSFERENCIA',
    metodo_saldo: null,
    ...sobreescribir,
  };
}

const REVISION = {
  id: 'tp-previo',
  estado: 'PENDIENTE',
  importe_declarado: '63.25',
  comprobante_path: 'comprobante.png',
  gestionado_por: COMERCIAL_ID,
  banco_origen: 'Banco del Cliente',
  cuenta_bancaria_id: 'cuenta-1',
  banco_cuenta_snapshot: 'Banco Receptor',
  titular_cuenta_snapshot: 'Titular',
  tipo_cuenta_snapshot: 'AHORROS',
  numero_cuenta_snapshot: '123',
  referencia_bancaria: 'REF-1',
};

const sql = () => client.query.mock.calls.map((llamada) => String(llamada[0]));

function noEscribio() {
  expect(repos.actualizarEstadoAnticipo).not.toHaveBeenCalled();
  expect(repos.marcarNoVigente).not.toHaveBeenCalled();
  expect(repos.crear).not.toHaveBeenCalled();
  expect(repos.crearOrdenAutomatica).not.toHaveBeenCalled();
  expect(sql()).toContain('ROLLBACK');
  expect(sql()).not.toContain('COMMIT');
}

beforeEach(() => {
  vi.clearAllMocks();
  client.query.mockResolvedValue({ rows: [] });
  repos.lockParaTransferencia.mockResolvedValue(bloqueo());
  repos.obtenerVigente.mockResolvedValue(REVISION);
  repos.crear.mockImplementation(async (datos: Record<string, unknown>) => ({ id: 'tp-nuevo', ...datos }));
  repos.findByIdWithRol.mockResolvedValue({ id: ADMIN_ID, activo: true, rol: 'ADMIN' });
  repos.actualizarEstadoAnticipo.mockResolvedValue({ id: COT_ID });
});

const VIAS = [
  [
    'confirmación telefónica de COMERCIAL («Dinero acreditado»)',
    (extra: Record<string, unknown> = {}) =>
      registrarConfirmacionTelefonica({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', verificadorId: ADMIN_ID, registradoPor: COMERCIAL_ID, ...extra }),
  ],
  [
    'VALIDAR directo de ADMIN',
    (extra: Record<string, unknown> = {}) =>
      confirmarAcreditacionDirecta({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', adminId: ADMIN_ID, ...extra }),
  ],
] as const;

describe.each(VIAS)('anticipo por TRANSFERENCIA — %s', (_nombre, ejecutar) => {
  it('sin comprobante del cliente: AnticipoRequiereComprobanteError y no escribe nada', async () => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ comprobante_anticipo: null }));
    await expect(ejecutar()).rejects.toBeInstanceOf(AnticipoRequiereComprobanteError);
    noEscribio();
  });

  it('sin revisión previa de COMERCIAL (sin gestión vigente): AnticipoRequiereRevisionError y no escribe nada', async () => {
    repos.obtenerVigente.mockResolvedValue(null);
    await expect(ejecutar()).rejects.toBeInstanceOf(AnticipoRequiereRevisionError);
    noEscribio();
  });

  it('con la última gestión ya RECHAZADA (no es una revisión pendiente): AnticipoRequiereRevisionError', async () => {
    repos.obtenerVigente.mockResolvedValue({ ...REVISION, estado: 'RECHAZADO' });
    await expect(ejecutar()).rejects.toBeInstanceOf(AnticipoRequiereRevisionError);
    noEscribio();
  });

  it('con comprobante y revisión previa: acredita, guarda quién verificó y quién registró, y crea la orden tras el COMMIT', async () => {
    const creado = await ejecutar();
    expect(repos.actualizarEstadoAnticipo).toHaveBeenCalledWith(COT_ID, 'VALIDADO', ADMIN_ID, client);
    expect(creado).toMatchObject({ estado: 'VALIDADO', verificadoPor: ADMIN_ID });
    expect(sql()).toContain('COMMIT');
    expect(repos.crearOrdenAutomatica).toHaveBeenCalledWith(COT_ID, 'ANTICIPO_VALIDADO');
  });

  it('con el anticipo ya VALIDADO: no se exige revisión; el UPDATE condicional responde PagoNoConfirmableError (conserva el 409 de carrera)', async () => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: 'VALIDADO' }));
    repos.actualizarEstadoAnticipo.mockResolvedValue(null);
    await expect(ejecutar()).rejects.toBeInstanceOf(PagoNoConfirmableError);
  });
});

describe('anticipo en EFECTIVO: flujo propio, sin simular una acreditación bancaria', () => {
  it('no exige comprobante ni revisión previa', async () => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ metodo_anticipo: 'EFECTIVO', comprobante_anticipo: null }));
    repos.obtenerVigente.mockResolvedValue(null);
    await registrarConfirmacionTelefonica({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', verificadorId: ADMIN_ID, registradoPor: COMERCIAL_ID });
    expect(repos.actualizarEstadoAnticipo).toHaveBeenCalledWith(COT_ID, 'VALIDADO', ADMIN_ID, client);
    expect(sql()).toContain('COMMIT');
  });
});

describe('el saldo por TRANSFERENCIA conserva su regla (comprobante del cliente) y no exige la revisión del anticipo', () => {
  it('con el anticipo NO_APLICA y el saldo con comprobante: se acredita sin consultar la revisión del anticipo', async () => {
    repos.lockParaTransferencia.mockResolvedValue(
      bloqueo({ estado_anticipo: 'NO_APLICA', metodo_anticipo: null, metodo_saldo: 'TRANSFERENCIA', comprobante_saldo: 'saldo.png' })
    );
    repos.obtenerVigente.mockResolvedValue(null);
    repos.validarSaldo.mockResolvedValue({ id: COT_ID });
    await confirmarAcreditacionDirecta({ cotizacionId: COT_ID, tipoPago: 'SALDO', adminId: ADMIN_ID });
    expect(repos.validarSaldo).toHaveBeenCalledWith(COT_ID, ADMIN_ID, 'TRANSFERENCIA', client);
  });
});

describe('trazabilidad: observaciones y hora real de la llamada (solo cuando se conoce)', () => {
  it('«Dinero acreditado» guarda las observaciones recortadas y la hora de la llamada; el registro lo pone la BD (creado_en)', async () => {
    const llamada = new Date(Date.now() - 60 * 60 * 1000);
    await registrarConfirmacionTelefonica({
      cotizacionId: COT_ID, tipoPago: 'ANTICIPO', verificadorId: ADMIN_ID, registradoPor: COMERCIAL_ID,
      observaciones: '  ADMIN confirmó el ingreso a las 10:05  ', llamadaEn: llamada,
    });
    const datos = repos.crear.mock.calls[0][0];
    expect(datos).toMatchObject({
      estado: 'VALIDADO', medioConfirmacion: 'TELEFONICO', verificadoPor: ADMIN_ID, registradoPor: COMERCIAL_ID,
      observaciones: 'ADMIN confirmó el ingreso a las 10:05', llamadaEn: llamada,
    });
  });

  it('si no se informa la llamada, llamada_en queda en NULL (nunca se sustituye por la hora del registro)', async () => {
    await registrarConfirmacionTelefonica({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', verificadorId: ADMIN_ID, registradoPor: COMERCIAL_ID });
    expect(repos.crear.mock.calls[0][0]).toMatchObject({ observaciones: null, llamadaEn: null });
  });

  it('una llamada posterior al momento actual, una fecha inválida o unas observaciones demasiado largas se rechazan antes de tocar la BD', async () => {
    const base = { cotizacionId: COT_ID, tipoPago: 'ANTICIPO', verificadorId: ADMIN_ID, registradoPor: COMERCIAL_ID };
    await expect(registrarConfirmacionTelefonica({ ...base, llamadaEn: new Date(Date.now() + 60 * 60 * 1000) })).rejects.toBeInstanceOf(DatosDeGestionInvalidosError);
    await expect(registrarConfirmacionTelefonica({ ...base, llamadaEn: new Date('no es una fecha') })).rejects.toBeInstanceOf(DatosDeGestionInvalidosError);
    await expect(registrarConfirmacionTelefonica({ ...base, observaciones: 'x'.repeat(OBSERVACIONES_MAX + 1) })).rejects.toBeInstanceOf(DatosDeGestionInvalidosError);
    expect(repos.lockParaTransferencia).not.toHaveBeenCalled();
  });

  it('el rechazo y la gestión también guardan observaciones y llamada', async () => {
    const llamada = new Date(Date.now() - 1000);
    await rechazarPago({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', motivoRechazo: 'IMPORTE_INCORRECTO', rechazadoPor: COMERCIAL_ID, observaciones: 'no coincide', llamadaEn: llamada });
    expect(repos.crear.mock.calls[0][0]).toMatchObject({ estado: 'RECHAZADO', observaciones: 'no coincide', llamadaEn: llamada });
    await registrarGestionPago({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', importeDeclarado: 63.25, gestionadoPor: COMERCIAL_ID, observaciones: 'revisado' });
    expect(repos.crear.mock.calls[1][0]).toMatchObject({ estado: 'PENDIENTE', observaciones: 'revisado', llamadaEn: null });
  });
});

describe('seguimiento (ADMIN sin respuesta / el dinero todavía no aparece): el pago sigue PENDIENTE', () => {
  it('exige una observación', async () => {
    await expect(
      registrarGestionPago({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', importeDeclarado: 63.25, gestionadoPor: COMERCIAL_ID, seguimiento: true })
    ).rejects.toBeInstanceOf(DatosDeGestionInvalidosError);
    await expect(
      registrarGestionPago({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', importeDeclarado: 63.25, gestionadoPor: COMERCIAL_ID, seguimiento: true, observaciones: '   ' })
    ).rejects.toBeInstanceOf(DatosDeGestionInvalidosError);
    expect(repos.crear).not.toHaveBeenCalled();
  });

  it('nunca puede ser la primera gestión: sin revisión previa responde AnticipoRequiereRevisionError y no escribe', async () => {
    repos.obtenerVigente.mockResolvedValue(null);
    await expect(
      registrarGestionPago({ cotizacionId: COT_ID, tipoPago: 'ANTICIPO', importeDeclarado: 63.25, gestionadoPor: COMERCIAL_ID, seguimiento: true, observaciones: 'ADMIN no respondió' })
    ).rejects.toBeInstanceOf(AnticipoRequiereRevisionError);
    expect(repos.crear).not.toHaveBeenCalled();
    expect(sql()).toContain('ROLLBACK');
  });

  it('crea una fila PENDIENTE vigente con la observación, conserva los datos de la gestión anterior y no cambia el estado del anticipo', async () => {
    await registrarGestionPago({
      cotizacionId: COT_ID, tipoPago: 'ANTICIPO', importeDeclarado: 1, gestionadoPor: COMERCIAL_ID,
      seguimiento: true, observaciones: 'El dinero todavía no aparece',
    });
    expect(repos.marcarNoVigente).toHaveBeenCalledWith('tp-previo', client);
    expect(repos.crear.mock.calls[0][0]).toMatchObject({
      estado: 'PENDIENTE', vigente: true, observaciones: 'El dinero todavía no aparece',
      importeDeclarado: 63.25, bancoOrigen: 'Banco del Cliente', cuentaBancariaId: 'cuenta-1', referenciaBancaria: 'REF-1',
      comprobantePath: 'comprobante.png',
    });
    expect(repos.actualizarEstadoAnticipo).not.toHaveBeenCalled();
    expect(sql()).toContain('COMMIT');
  });
});

describe('errores compartidos (sin clases duplicadas)', () => {
  it('las clases exportadas por transferenciasPago.service son las de cotizaciones.service', () => {
    expect(AnticipoRequiereComprobanteError).toBe(cotizacionesService.AnticipoRequiereComprobanteError);
    expect(AnticipoRequiereRevisionError).toBe(cotizacionesService.AnticipoRequiereRevisionError);
  });
});
