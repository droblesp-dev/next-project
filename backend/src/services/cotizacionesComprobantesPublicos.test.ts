import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRETO = vi.hoisted(() => 'secreto-de-prueba-del-enlace');
const COT_ID = '75f33350-e236-46e4-8072-b1a91ec16462';
const CODIGO = '123456';

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
const repos = vi.hoisted(() => ({
  findById: vi.fn(),
  marcarVencidasSiCorresponde: vi.fn(),
  obtenerHashCodigoAcceso: vi.fn(),
  lockParaTransferencia: vi.fn(),
  guardarComprobante: vi.fn(),
  guardarComprobanteSaldo: vi.fn(),
  // QA-06 (V23): el bloqueo del código de acceso vive en la BD; aquí nunca está bloqueado y no hay fallos que sumar.
  accesoEstaBloqueado: vi.fn(async () => false),
  registrarFalloAcceso: vi.fn(async () => undefined),
  limpiarFallosAcceso: vi.fn(async () => undefined),
  registrarHistorial: vi.fn(),
  obtenerVigente: vi.fn(),
  solicitudFindById: vi.fn(),
  listarCuentas: vi.fn(),
}));

vi.mock('../config/db.js', () => ({ pool: { connect: vi.fn(async () => client), query: vi.fn() } }));
vi.mock('../config/env.js', () => ({
  env: { cotizacionLinkSecret: SECRETO, datosBancarios: {}, corsOrigins: [], frontendUrl: '' },
}));
vi.mock('../repositories/cotizaciones.repository.js', () => ({
  findById: repos.findById,
  marcarVencidasSiCorresponde: repos.marcarVencidasSiCorresponde,
  obtenerHashCodigoAcceso: repos.obtenerHashCodigoAcceso,
  lockParaTransferencia: repos.lockParaTransferencia,
  guardarComprobante: repos.guardarComprobante,
  guardarComprobanteSaldo: repos.guardarComprobanteSaldo,
  accesoEstaBloqueado: repos.accesoEstaBloqueado,
  registrarFalloAcceso: repos.registrarFalloAcceso,
  limpiarFallosAcceso: repos.limpiarFallosAcceso,
}));
vi.mock('../repositories/comprobantesPagoCliente.repository.js', () => ({ registrar: repos.registrarHistorial }));
vi.mock('../repositories/transferenciasPago.repository.js', () => ({ obtenerVigente: repos.obtenerVigente }));
vi.mock('../repositories/solicitudes.repository.js', () => ({ findById: repos.solicitudFindById }));
vi.mock('./cuentasBancarias.service.js', () => ({ listarCuentasActivasPublico: repos.listarCuentas }));
vi.mock('./ordenAutomatica.service.js', () => ({ crearOrdenAutomatica: vi.fn() }));
vi.mock('./leads.service.js', () => ({ convertirLeadPorAceptacion: vi.fn() }));
vi.mock('./email.service.js', () => ({ enviarCodigoTemporalCotizacion: vi.fn(), enviarCodigoAccesoRegenerado: vi.fn() }));

import {
  AccionNoPermitidaError,
  anticipoPermiteSaldo,
  ComprobanteYaRecibidoError,
  EnlaceInvalidoError,
  registrarComprobantePublico,
  registrarComprobanteSaldoPublico,
  SaldoRequiereAnticipoValidadoError,
  validarEnlaceCotizacion,
  verificarCodigoCotizacion,
} from './cotizaciones.service.js';

function crearToken(cotizacionId: string = COT_ID): string {
  return jwt.sign({ cotizacionId, purpose: 'cotizacion_publica' }, SECRETO, { algorithm: 'HS256' });
}

function cotizacionBase(sobreescribir: Record<string, unknown> = {}) {
  return {
    id: COT_ID,
    solicitud_id: 'sol-1',
    valor: '1234.50',
    subtotal: '1234.50',
    iva_porcentaje: '15.00',
    iva_valor: '185.18',
    total: '1419.68',
    estado: 'ACEPTADA',
    descripcion: null,
    creado_en: '2026-10-01T00:00:00Z',
    fecha_vigencia: null,
    aceptada_en: '2026-10-02T00:00:00Z',
    rechazada_en: null,
    anticipo_porcentaje: '50.00',
    anticipo_valor: '709.84',
    saldo_pendiente: '709.84',
    metodo_anticipo: 'TRANSFERENCIA',
    estado_anticipo: 'VALIDADO',
    comprobante_recibido: true,
    metodo_saldo: null,
    estado_saldo: 'PENDIENTE',
    saldo_comprobante_recibido: false,
    ...sobreescribir,
  };
}

function bloqueo(sobreescribir: Record<string, unknown> = {}) {
  return {
    estado: 'ACEPTADA',
    estado_anticipo: 'VALIDADO',
    estado_saldo: 'PENDIENTE',
    anticipo_valor: '709.84',
    saldo_pendiente: '709.84',
    comprobante_anticipo: null,
    comprobante_saldo: null,
    metodo_anticipo: 'TRANSFERENCIA',
    metodo_saldo: null,
    ...sobreescribir,
  };
}

function escritura() {
  return { escribir: vi.fn(async () => undefined), deshacer: vi.fn(async () => undefined) };
}

const consultas = () => client.query.mock.calls.map((c) => String(c[0]));

beforeEach(async () => {
  vi.clearAllMocks();
  const hash = await bcrypt.hash(CODIGO, 4);
  repos.marcarVencidasSiCorresponde.mockResolvedValue(undefined);
  repos.obtenerHashCodigoAcceso.mockResolvedValue(hash);
  repos.findById.mockResolvedValue(cotizacionBase());
  repos.lockParaTransferencia.mockResolvedValue(bloqueo());
  repos.guardarComprobante.mockResolvedValue(cotizacionBase());
  repos.guardarComprobanteSaldo.mockResolvedValue(cotizacionBase());
  repos.registrarHistorial.mockResolvedValue({});
  repos.obtenerVigente.mockResolvedValue(null);
  repos.solicitudFindById.mockResolvedValue({ servicio: 'TORNO', descripcion: 'd', cantidad: 1, especificaciones: null });
  repos.listarCuentas.mockResolvedValue([]);
  client.query.mockResolvedValue({ rows: [] });
});

describe('QA-04: comprobante del saldo solo con el anticipo validado', () => {
  it('anticipoPermiteSaldo: solo VALIDADO y NO_APLICA habilitan el saldo', () => {
    expect(anticipoPermiteSaldo('VALIDADO')).toBe(true);
    expect(anticipoPermiteSaldo('NO_APLICA')).toBe(true);
    for (const estado of ['PENDIENTE', 'RECHAZADO', null]) expect(anticipoPermiteSaldo(estado)).toBe(false);
  });

  it.each(['PENDIENTE', 'RECHAZADO'])('el backend rechaza el saldo con el anticipo %s, sin escribir nada', async (estadoAnticipo) => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: estadoAnticipo }));
    const archivo = escritura();

    await expect(registrarComprobanteSaldoPublico(crearToken(), CODIGO, 'x.png', archivo)).rejects.toBeInstanceOf(
      SaldoRequiereAnticipoValidadoError
    );

    expect(repos.guardarComprobanteSaldo).not.toHaveBeenCalled();
    expect(repos.registrarHistorial).not.toHaveBeenCalled();
    expect(archivo.escribir).not.toHaveBeenCalled();
    expect(consultas()).toContain('ROLLBACK');
    expect(consultas()).not.toContain('COMMIT');
  });

  it.each(['VALIDADO', 'NO_APLICA'])('con el anticipo %s la carga del saldo se registra y se escribe el archivo', async (estadoAnticipo) => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: estadoAnticipo }));
    const archivo = escritura();

    await registrarComprobanteSaldoPublico(crearToken(), CODIGO, 'saldo.png', archivo);

    expect(repos.guardarComprobanteSaldo).toHaveBeenCalledWith(COT_ID, 'saldo.png', client);
    expect(repos.registrarHistorial).toHaveBeenCalledWith(
      expect.objectContaining({ cotizacionId: COT_ID, tipoPago: 'SALDO', archivo: 'saldo.png' }),
      client
    );
    expect(archivo.escribir).toHaveBeenCalledTimes(1);
    expect(consultas()).toContain('COMMIT');
  });

  it('si el UPDATE condicional no aplica (cambio concurrente) se rechaza y no se escribe el archivo', async () => {
    repos.guardarComprobanteSaldo.mockResolvedValue(null);
    const archivo = escritura();

    await expect(registrarComprobanteSaldoPublico(crearToken(), CODIGO, 'x.png', archivo)).rejects.toBeInstanceOf(
      AccionNoPermitidaError
    );
    expect(archivo.escribir).not.toHaveBeenCalled();
    expect(repos.registrarHistorial).not.toHaveBeenCalled();
  });

  it('la carga del saldo exige método TRANSFERENCIA (o sin definir) y cotización ACEPTADA', async () => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ metodo_saldo: 'EFECTIVO' }));
    await expect(registrarComprobanteSaldoPublico(crearToken(), CODIGO, 'x.png', escritura())).rejects.toBeInstanceOf(
      AccionNoPermitidaError
    );
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado: 'ENVIADA' }));
    await expect(registrarComprobanteSaldoPublico(crearToken(), CODIGO, 'x.png', escritura())).rejects.toBeInstanceOf(
      AccionNoPermitidaError
    );
  });
});

describe('cargas trazables, sin sobrescribir en silencio', () => {
  it('un segundo comprobante con uno ya en revisión se rechaza (no pisa el anterior)', async () => {
    repos.lockParaTransferencia.mockResolvedValue(
      bloqueo({ estado_anticipo: 'PENDIENTE', comprobante_anticipo: 'anterior.png' })
    );
    await expect(registrarComprobantePublico(crearToken(), CODIGO, 'nuevo.png', escritura())).rejects.toBeInstanceOf(
      ComprobanteYaRecibidoError
    );
    expect(repos.guardarComprobante).not.toHaveBeenCalled();
  });

  it('tras un rechazo del anticipo el cliente puede volver a subir; queda registrada la nueva carga', async () => {
    repos.lockParaTransferencia.mockResolvedValue(
      bloqueo({ estado_anticipo: 'RECHAZADO', comprobante_anticipo: 'rechazado.png' })
    );
    const archivo = escritura();

    await registrarComprobantePublico(crearToken(), CODIGO, 'corregido.png', archivo);

    expect(repos.guardarComprobante).toHaveBeenCalledWith(COT_ID, 'corregido.png', client);
    expect(repos.registrarHistorial).toHaveBeenCalledWith(
      expect.objectContaining({ tipoPago: 'ANTICIPO', archivo: 'corregido.png' }),
      client
    );
  });

  it('tras un rechazo del saldo (anticipo validado) también puede volver a subir', async () => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_saldo: 'RECHAZADO', comprobante_saldo: 'viejo.png' }));
    await registrarComprobanteSaldoPublico(crearToken(), CODIGO, 'nuevo.png', escritura());
    expect(repos.registrarHistorial).toHaveBeenCalledWith(expect.objectContaining({ tipoPago: 'SALDO' }), client);
  });

  it('con el anticipo ya VALIDADO no admite otro comprobante de anticipo', async () => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: 'VALIDADO' }));
    await expect(registrarComprobantePublico(crearToken(), CODIGO, 'x.png', escritura())).rejects.toBeInstanceOf(
      AccionNoPermitidaError
    );
  });

  it('si falla la escritura del archivo se revierte todo y no se confirma', async () => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: 'PENDIENTE' }));
    const archivo = escritura();
    archivo.escribir.mockRejectedValue(new Error('disco lleno'));

    await expect(registrarComprobantePublico(crearToken(), CODIGO, 'x.png', archivo)).rejects.toThrow('disco lleno');
    expect(consultas()).toContain('ROLLBACK');
    expect(consultas()).not.toContain('COMMIT');
    expect(archivo.deshacer).not.toHaveBeenCalled();
  });

  it('si falla el COMMIT se deshace el archivo ya escrito', async () => {
    repos.lockParaTransferencia.mockResolvedValue(bloqueo({ estado_anticipo: 'PENDIENTE' }));
    const archivo = escritura();
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'COMMIT') throw new Error('commit falló');
      return { rows: [] };
    });

    await expect(registrarComprobantePublico(crearToken(), CODIGO, 'x.png', archivo)).rejects.toThrow('commit falló');
    expect(archivo.escribir).toHaveBeenCalledTimes(1);
    expect(archivo.deshacer).toHaveBeenCalledTimes(1);
  });

  it('un código incorrecto no toca la BD ni el disco', async () => {
    const archivo = escritura();
    await expect(registrarComprobantePublico(crearToken(), '000000', 'x.png', archivo)).rejects.toThrow();
    expect(repos.lockParaTransferencia).not.toHaveBeenCalled();
    expect(archivo.escribir).not.toHaveBeenCalled();
  });
});

describe('QA-14: identificador inválido dentro de un token firmado', () => {
  it('se trata como enlace inválido y nunca llega a consultar la BD', async () => {
    await expect(validarEnlaceCotizacion(crearToken('no-es-uuid'))).rejects.toBeInstanceOf(EnlaceInvalidoError);
    expect(repos.findById).not.toHaveBeenCalled();
  });
});

describe('DTO público', () => {
  it('incluye el desglose oficial del backend y habilita el saldo según el anticipo', async () => {
    const { cotizacion } = { cotizacion: await verificarCodigoCotizacion(crearToken(), CODIGO) };
    expect(cotizacion).toMatchObject({
      valor: '1234.50',
      subtotal: '1234.50',
      iva_porcentaje: '15.00',
      iva_valor: '185.18',
      total: '1419.68',
      saldo_habilitado: true,
      rechazo_anticipo: null,
      rechazo_saldo: null,
    });
  });

  it('con el anticipo pendiente el saldo no está habilitado', async () => {
    repos.findById.mockResolvedValue(cotizacionBase({ estado_anticipo: 'PENDIENTE' }));
    expect((await verificarCodigoCotizacion(crearToken(), CODIGO)).saldo_habilitado).toBe(false);
  });

  it('expone el motivo del rechazo vigente solo mientras el pago siga RECHAZADO', async () => {
    repos.findById.mockResolvedValue(cotizacionBase({ estado_anticipo: 'RECHAZADO' }));
    repos.obtenerVigente.mockResolvedValue({
      estado: 'RECHAZADO',
      motivo_rechazo: 'IMPORTE_INCORRECTO',
      motivo_rechazo_detalle: null,
      creado_en: '2026-10-03T00:00:00Z',
    });

    const dto = await verificarCodigoCotizacion(crearToken(), CODIGO);

    expect(dto.rechazo_anticipo).toEqual({ motivo: 'IMPORTE_INCORRECTO', detalle: null, fecha: '2026-10-03T00:00:00Z' });
    expect(dto.rechazo_saldo).toBeNull();
    expect(repos.obtenerVigente).toHaveBeenCalledWith(COT_ID, 'ANTICIPO');
  });

  it('entrega las cuentas bancarias cuando la cotización está ACEPTADA aunque el saldo no tenga método', async () => {
    repos.findById.mockResolvedValue(cotizacionBase({ metodo_anticipo: 'EFECTIVO', metodo_saldo: null }));
    repos.listarCuentas.mockResolvedValue([{ banco: 'Banco X' }]);
    expect((await verificarCodigoCotizacion(crearToken(), CODIGO)).cuentas_bancarias_activas).toHaveLength(1);
  });

  it('no entrega cuentas antes de aceptar si no hay transferencia definida', async () => {
    repos.findById.mockResolvedValue(
      cotizacionBase({ estado: 'ENVIADA', metodo_anticipo: 'EFECTIVO', metodo_saldo: null, estado_anticipo: 'PENDIENTE' })
    );
    expect((await verificarCodigoCotizacion(crearToken(), CODIGO)).cuentas_bancarias_activas).toEqual([]);
    expect(repos.listarCuentas).not.toHaveBeenCalled();
  });
});
