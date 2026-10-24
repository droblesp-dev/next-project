import { pool } from '../config/db.js';
import * as transferenciasRepo from '../repositories/transferenciasPago.repository.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import * as cuentasBancariasRepo from '../repositories/cuentasBancarias.repository.js';
import { findByIdWithRol } from '../repositories/usuarios.repository.js';
import { crearOrdenAutomatica } from './ordenAutomatica.service.js';
import { CotizacionNoEncontradaError } from './cotizaciones.service.js';
import type { TransferenciaPago } from '../repositories/transferenciasPago.repository.js';

// PC-2026-01, Etapa 4: integra transferencias_pago (V13/V14) con el flujo
// existente de anticipo/saldo. Cada función abre su propia transacción
// (BEGIN/COMMIT/ROLLBACK), bloqueando la fila de la cotización con
// `lockParaTransferencia()` (FOR UPDATE) — mismo patrón ya probado en
// `ordenEvidencia.service.ts::agregarEvidencia`. Dentro de esa misma
// transacción se reutilizan, sin duplicar su lógica, las funciones del
// repositorio ya existentes (`actualizarEstadoAnticipo`, `validarSaldo`,
// `rechazarSaldo`, ahora con un parámetro `executor` opcional) para que las
// columnas-caché de `cotizaciones` sigan sincronizadas con el historial
// nuevo. `crearOrdenAutomatica()` se sigue llamando DESPUÉS del COMMIT,
// igual que hoy — nunca dentro de la transacción de pago.

// Una única clase para "cotización inexistente": la misma que el controlador reconoce con
// `instanceof` (antes esta capa definía una propia y el controlador respondía 500).
export { CotizacionNoEncontradaError };
export class TipoPagoInvalidoError extends Error {}
export class CotizacionNoAceptadaError extends Error {}
export class PagoNoGestionableError extends Error {}
export class PagoNoRechazableError extends Error {}
export class PagoNoConfirmableError extends Error {}
export class MotivoRechazoInvalidoError extends Error {}
export class ImporteInvalidoError extends Error {}
export class CuentaBancariaInvalidaError extends Error {}
export class VerificadorInvalidoError extends Error {}
export class MetodoSaldoRequeridoError extends Error {}
export class MetodoSaldoInvalidoError extends Error {}
export class ComprobanteSaldoRequeridoError extends Error {}

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS_PAGO = ['ANTICIPO', 'SALDO'];
const MOTIVOS_RECHAZO = ['COMPROBANTE_INCORRECTO', 'IMPORTE_INCORRECTO', 'COMPROBANTE_ILEGIBLE', 'OTRO'];
const METODOS_SALDO_PERMITIDOS = ['TRANSFERENCIA', 'EFECTIVO'];

function validarTipoPago(tipoPago: string): void {
  if (!TIPOS_PAGO.includes(tipoPago)) {
    throw new TipoPagoInvalidoError(`tipoPago debe ser uno de: ${TIPOS_PAGO.join(', ')}`);
  }
}

export async function obtenerHistorial(cotizacionId: string): Promise<TransferenciaPago[]> {
  const cotizacion = await cotizacionesRepo.findById(cotizacionId);
  if (!cotizacion) {
    throw new CotizacionNoEncontradaError();
  }
  return transferenciasRepo.listarPorCotizacion(cotizacionId);
}

// COMERCIAL o ADMIN: registra/actualiza la gestión documental de un pago
// (revisión del comprobante, banco de origen, referencia, importe) — nunca
// cambia `estado_anticipo`/`estado_saldo` de `cotizaciones` (permanece
// PENDIENTE), solo crea el nuevo registro vigente en el historial. El banco
// de origen se registra tal como lo informa COMERCIAL; ya NO se bloquea
// cuando difiere del de un intento anterior (se retiró la autorización de
// excepción). Registrar un pago nunca equivale a confirmar su acreditación:
// eso lo sigue confirmando ADMIN.
export async function registrarGestionPago(input: {
  cotizacionId: string;
  tipoPago: string;
  importeDeclarado: number;
  bancoOrigen?: string | null;
  referenciaBancaria?: string | null;
  cuentaBancariaId?: string | null;
  comprobantePath?: string | null;
  gestionadoPor: string;
}): Promise<TransferenciaPago> {
  validarTipoPago(input.tipoPago);
  if (!(input.importeDeclarado > 0)) {
    throw new ImporteInvalidoError('importeDeclarado debe ser mayor que cero.');
  }
  // Un identificador que ni siquiera tiene formato UUID no puede corresponder a ninguna
  // cuenta: se rechaza con el mismo error que una cuenta inexistente (400), en lugar de
  // dejar que PostgreSQL falle con "invalid input syntax for type uuid" (500).
  if (input.cuentaBancariaId && !FORMATO_UUID.test(input.cuentaBancariaId)) {
    throw new CuentaBancariaInvalidaError();
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cotizacion = await cotizacionesRepo.lockParaTransferencia(input.cotizacionId, client);
    if (!cotizacion) {
      throw new CotizacionNoEncontradaError();
    }
    if (cotizacion.estado !== 'ACEPTADA') {
      throw new CotizacionNoAceptadaError();
    }

    let snapshot: {
      banco: string;
      titular: string;
      tipoCuenta: string;
      numeroCuenta: string;
    } | null = null;
    if (input.cuentaBancariaId) {
      const cuenta = await cuentasBancariasRepo.findById(input.cuentaBancariaId);
      // Una cuenta inexistente o desactivada no puede recibir un pago nuevo (el selector ya
      // solo ofrece activas; esto lo garantiza también ante una llamada directa). Los pagos
      // ya registrados conservan su copia y no se revalidan.
      if (!cuenta || !cuenta.activo) {
        throw new CuentaBancariaInvalidaError();
      }
      snapshot = {
        banco: cuenta.banco,
        titular: cuenta.titular,
        tipoCuenta: cuenta.tipo_cuenta,
        numeroCuenta: cuenta.numero_cuenta,
      };
    }

    const vigenteAnterior = await transferenciasRepo.obtenerVigente(input.cotizacionId, input.tipoPago, client);
    if (vigenteAnterior) {
      await transferenciasRepo.marcarNoVigente(vigenteAnterior.id, client);
    }

    const creado = await transferenciasRepo.crear(
      {
        cotizacionId: input.cotizacionId,
        tipoPago: input.tipoPago,
        importeDeclarado: input.importeDeclarado,
        comprobantePath: input.comprobantePath ?? vigenteAnterior?.comprobante_path ?? null,
        estado: 'PENDIENTE',
        gestionadoPor: input.gestionadoPor,
        registradoPor: input.gestionadoPor,
        vigente: true,
        bancoOrigen: input.bancoOrigen ?? null,
        cuentaBancariaId: input.cuentaBancariaId ?? null,
        bancoCuentaSnapshot: snapshot?.banco ?? null,
        titularCuentaSnapshot: snapshot?.titular ?? null,
        tipoCuentaSnapshot: snapshot?.tipoCuenta ?? null,
        numeroCuentaSnapshot: snapshot?.numeroCuenta ?? null,
        referenciaBancaria: input.referenciaBancaria ?? null,
      },
      client
    );

    await client.query('COMMIT');
    return creado;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Exclusivo COMERCIAL (verificado por el controller antes de llamar aquí,
// vía req.user.rol — nunca confiado desde el cliente). Rechazo documental:
// nunca implica que se verificó un ingreso bancario.
export async function rechazarPago(input: {
  cotizacionId: string;
  tipoPago: string;
  motivoRechazo: string;
  motivoRechazoDetalle?: string | null;
  rechazadoPor: string;
}): Promise<TransferenciaPago> {
  validarTipoPago(input.tipoPago);
  if (!MOTIVOS_RECHAZO.includes(input.motivoRechazo)) {
    throw new MotivoRechazoInvalidoError(`motivoRechazo debe ser uno de: ${MOTIVOS_RECHAZO.join(', ')}`);
  }
  if (input.motivoRechazo === 'OTRO' && !input.motivoRechazoDetalle?.trim()) {
    throw new MotivoRechazoInvalidoError('motivoRechazoDetalle es requerido cuando motivoRechazo es OTRO.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cotizacion = await cotizacionesRepo.lockParaTransferencia(input.cotizacionId, client);
    if (!cotizacion) {
      throw new CotizacionNoEncontradaError();
    }

    const actualizada =
      input.tipoPago === 'ANTICIPO'
        ? await cotizacionesRepo.actualizarEstadoAnticipo(input.cotizacionId, 'RECHAZADO', input.rechazadoPor, client)
        : await cotizacionesRepo.rechazarSaldo(input.cotizacionId, input.rechazadoPor, client);

    if (!actualizada) {
      throw new PagoNoRechazableError();
    }

    const vigenteAnterior = await transferenciasRepo.obtenerVigente(input.cotizacionId, input.tipoPago, client);
    if (vigenteAnterior) {
      await transferenciasRepo.marcarNoVigente(vigenteAnterior.id, client);
    }

    const importeFallback =
      input.tipoPago === 'ANTICIPO' ? cotizacion.anticipo_valor : cotizacion.saldo_pendiente;
    const comprobanteFallback =
      input.tipoPago === 'ANTICIPO' ? cotizacion.comprobante_anticipo : cotizacion.comprobante_saldo;

    const creado = await transferenciasRepo.crear(
      {
        cotizacionId: input.cotizacionId,
        tipoPago: input.tipoPago,
        importeDeclarado: Number(vigenteAnterior?.importe_declarado ?? importeFallback ?? 0),
        comprobantePath: vigenteAnterior?.comprobante_path ?? comprobanteFallback ?? null,
        estado: 'RECHAZADO',
        gestionadoPor: input.rechazadoPor,
        registradoPor: input.rechazadoPor,
        vigente: true,
        bancoOrigen: vigenteAnterior?.banco_origen ?? null,
        motivoRechazo: input.motivoRechazo,
        motivoRechazoDetalle: input.motivoRechazo === 'OTRO' ? (input.motivoRechazoDetalle ?? null) : null,
      },
      client
    );

    await client.query('COMMIT');
    return creado;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

// Exclusivo ADMIN (verificado por el controller): confirma directamente
// que el dinero ya ingresó. `verificado_por` y `registrado_por` son el
// mismo usuario — es quien ejecuta la verificación.
export async function confirmarAcreditacionDirecta(input: {
  cotizacionId: string;
  tipoPago: string;
  adminId: string;
  metodoSaldo?: string;
}): Promise<TransferenciaPago> {
  return confirmarAcreditacion({
    cotizacionId: input.cotizacionId,
    tipoPago: input.tipoPago,
    verificadoPor: input.adminId,
    registradoPor: input.adminId,
    medioConfirmacion: 'DIRECTO',
    metodoSaldo: input.metodoSaldo,
  });
}

// Exclusivo COMERCIAL (verificado por el controller): registra que un
// ADMIN confirmó telefónicamente el ingreso. `verificadorId` debe
// corresponder a un usuario real con rol ADMIN y activo en este momento —
// se verifica contra la base de datos, nunca se confía en un valor libre
// del cliente. `registrado_por` es el COMERCIAL que ejecuta la acción,
// distinto de `verificado_por`.
export async function registrarConfirmacionTelefonica(input: {
  cotizacionId: string;
  tipoPago: string;
  verificadorId: string;
  registradoPor: string;
  metodoSaldo?: string;
}): Promise<TransferenciaPago> {
  const verificador = await findByIdWithRol(input.verificadorId);
  if (!verificador || !verificador.activo || verificador.rol !== 'ADMIN') {
    throw new VerificadorInvalidoError('El usuario identificado como verificador debe ser un ADMIN activo.');
  }

  return confirmarAcreditacion({
    cotizacionId: input.cotizacionId,
    tipoPago: input.tipoPago,
    verificadoPor: verificador.id,
    registradoPor: input.registradoPor,
    medioConfirmacion: 'TELEFONICO',
    metodoSaldo: input.metodoSaldo,
  });
}

async function confirmarAcreditacion(input: {
  cotizacionId: string;
  tipoPago: string;
  verificadoPor: string;
  registradoPor: string;
  medioConfirmacion: 'DIRECTO' | 'TELEFONICO';
  metodoSaldo?: string;
}): Promise<TransferenciaPago> {
  validarTipoPago(input.tipoPago);

  const client = await pool.connect();
  let creado: TransferenciaPago;
  try {
    await client.query('BEGIN');

    const cotizacion = await cotizacionesRepo.lockParaTransferencia(input.cotizacionId, client);
    if (!cotizacion) {
      throw new CotizacionNoEncontradaError();
    }

    let actualizada;
    if (input.tipoPago === 'ANTICIPO') {
      actualizada = await cotizacionesRepo.actualizarEstadoAnticipo(input.cotizacionId, 'VALIDADO', input.verificadoPor, client);
    } else {
      // Misma lógica ya usada hoy en gestionarSaldo() (cotizaciones.service.ts),
      // reimplementada aquí porque esa función no participa de esta transacción.
      const metodoEfectivo = cotizacion.metodo_saldo ?? input.metodoSaldo ?? null;
      if (!metodoEfectivo) {
        throw new MetodoSaldoRequeridoError();
      }
      if (!METODOS_SALDO_PERMITIDOS.includes(metodoEfectivo)) {
        throw new MetodoSaldoInvalidoError();
      }
      if (cotizacion.metodo_saldo && input.metodoSaldo && input.metodoSaldo !== cotizacion.metodo_saldo) {
        throw new MetodoSaldoInvalidoError();
      }
      if (metodoEfectivo === 'TRANSFERENCIA' && !cotizacion.comprobante_saldo) {
        throw new ComprobanteSaldoRequeridoError();
      }
      actualizada = await cotizacionesRepo.validarSaldo(input.cotizacionId, input.verificadoPor, metodoEfectivo, client);
    }

    if (!actualizada) {
      throw new PagoNoConfirmableError();
    }

    const vigenteAnterior = await transferenciasRepo.obtenerVigente(input.cotizacionId, input.tipoPago, client);
    if (vigenteAnterior) {
      await transferenciasRepo.marcarNoVigente(vigenteAnterior.id, client);
    }

    const importeFallback =
      input.tipoPago === 'ANTICIPO' ? cotizacion.anticipo_valor : cotizacion.saldo_pendiente;
    const comprobanteFallback =
      input.tipoPago === 'ANTICIPO' ? cotizacion.comprobante_anticipo : cotizacion.comprobante_saldo;

    creado = await transferenciasRepo.crear(
      {
        cotizacionId: input.cotizacionId,
        tipoPago: input.tipoPago,
        importeDeclarado: Number(vigenteAnterior?.importe_declarado ?? importeFallback ?? 0),
        comprobantePath: vigenteAnterior?.comprobante_path ?? comprobanteFallback ?? null,
        estado: 'VALIDADO',
        gestionadoPor: vigenteAnterior?.gestionado_por ?? input.registradoPor,
        verificadoPor: input.verificadoPor,
        registradoPor: input.registradoPor,
        medioConfirmacion: input.medioConfirmacion,
        vigente: true,
        bancoOrigen: vigenteAnterior?.banco_origen ?? null,
        cuentaBancariaId: vigenteAnterior?.cuenta_bancaria_id ?? null,
        bancoCuentaSnapshot: vigenteAnterior?.banco_cuenta_snapshot ?? null,
        titularCuentaSnapshot: vigenteAnterior?.titular_cuenta_snapshot ?? null,
        tipoCuentaSnapshot: vigenteAnterior?.tipo_cuenta_snapshot ?? null,
        numeroCuentaSnapshot: vigenteAnterior?.numero_cuenta_snapshot ?? null,
        referenciaBancaria: vigenteAnterior?.referencia_bancaria ?? null,
      },
      client
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  // crearOrdenAutomatica() NUNCA se llama dentro de la transacción de pago
  // — mismo criterio ya usado hoy en gestionarAnticipo() — y solo aplica a
  // ANTICIPO, nunca a SALDO (el disparador de SALDO no existe hoy y esta
  // tarea no lo introduce).
  if (input.tipoPago === 'ANTICIPO') {
    await crearOrdenAutomatica(input.cotizacionId, 'ANTICIPO_VALIDADO');
  }

  return creado;
}
