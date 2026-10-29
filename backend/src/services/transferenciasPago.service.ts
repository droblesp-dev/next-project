import { pool } from '../config/db.js';
import * as transferenciasRepo from '../repositories/transferenciasPago.repository.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import * as cuentasBancariasRepo from '../repositories/cuentasBancarias.repository.js';
import { findByIdWithRol } from '../repositories/usuarios.repository.js';
import { crearOrdenAutomatica } from './ordenAutomatica.service.js';
import {
  AnticipoRequiereComprobanteError,
  AnticipoRequiereRevisionError,
  anticipoPermiteSaldo,
  ComprobanteSaldoRequeridoError,
  CotizacionNoEncontradaError,
  MetodoSaldoInvalidoError,
  MetodoSaldoRequeridoError,
  SaldoRequiereAnticipoValidadoError,
} from './cotizaciones.service.js';
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

// Una única clase por error funcional: la misma que el controlador reconoce con `instanceof`.
// Antes esta capa definía copias propias (CotizacionNoEncontradaError, MetodoSaldoRequeridoError,
// MetodoSaldoInvalidoError, ComprobanteSaldoRequeridoError) que el controlador no reconocía y que
// terminaban como HTTP 500; ahora se importan de `cotizaciones.service` y se re-exportan.
export {
  AnticipoRequiereComprobanteError,
  AnticipoRequiereRevisionError,
  ComprobanteSaldoRequeridoError,
  CotizacionNoEncontradaError,
  MetodoSaldoInvalidoError,
  MetodoSaldoRequeridoError,
  SaldoRequiereAnticipoValidadoError,
};
// Datos opcionales de la gestión (observaciones, hora real de la llamada) mal formados, o seguimiento sin observación.
export class DatosDeGestionInvalidosError extends Error {}
export class TipoPagoInvalidoError extends Error {}
export class CotizacionNoAceptadaError extends Error {}
export class PagoNoGestionableError extends Error {}
export class PagoNoRechazableError extends Error {}
export class PagoNoConfirmableError extends Error {}
export class MotivoRechazoInvalidoError extends Error {}
export class ImporteInvalidoError extends Error {}
export class CuentaBancariaInvalidaError extends Error {}
export class VerificadorInvalidoError extends Error {}

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS_PAGO = ['ANTICIPO', 'SALDO'];
const MOTIVOS_RECHAZO = ['COMPROBANTE_INCORRECTO', 'IMPORTE_INCORRECTO', 'COMPROBANTE_ILEGIBLE', 'OTRO'];
const METODOS_SALDO_PERMITIDOS = ['TRANSFERENCIA', 'EFECTIVO'];

function validarTipoPago(tipoPago: string): void {
  if (!TIPOS_PAGO.includes(tipoPago)) {
    throw new TipoPagoInvalidoError(`tipoPago debe ser uno de: ${TIPOS_PAGO.join(', ')}`);
  }
}

export const OBSERVACIONES_MAX = 1000;
// Tolerancia para relojes ligeramente desfasados: una llamada no puede ser posterior a «ahora» más este margen.
const MARGEN_LLAMADA_FUTURA_MS = 5 * 60 * 1000;

export interface DatosDeGestion {
  observaciones?: string | null;
  llamadaEn?: Date | null;
  // Seguimiento (ADMIN sin respuesta, el dinero todavía no aparece…): exige observación; el pago sigue PENDIENTE.
  seguimiento?: boolean;
}

// Normaliza y valida los datos opcionales de trazabilidad (V20). Devuelve las observaciones recortadas (null si
// están vacías) y la hora real de la llamada (null si no se conoce — nunca se sustituye por la hora del registro).
function normalizarDatosDeGestion(datos: DatosDeGestion): { observaciones: string | null; llamadaEn: Date | null } {
  const observaciones = datos.observaciones?.trim() ? datos.observaciones.trim() : null;
  if (observaciones && observaciones.length > OBSERVACIONES_MAX) {
    throw new DatosDeGestionInvalidosError(`observaciones no puede superar ${OBSERVACIONES_MAX} caracteres.`);
  }
  if (datos.seguimiento && !observaciones) {
    throw new DatosDeGestionInvalidosError('observaciones es requerida al registrar un seguimiento.');
  }
  const llamadaEn = datos.llamadaEn ?? null;
  if (llamadaEn !== null) {
    if (Number.isNaN(llamadaEn.getTime())) {
      throw new DatosDeGestionInvalidosError('llamadaEn no es una fecha y hora válida.');
    }
    if (llamadaEn.getTime() > Date.now() + MARGEN_LLAMADA_FUTURA_MS) {
      throw new DatosDeGestionInvalidosError('llamadaEn no puede ser posterior al momento actual.');
    }
  }
  return { observaciones, llamadaEn };
}

// Regla de negocio: el saldo no puede gestionarse (registrar, rechazar ni validar) mientras el
// anticipo no esté VALIDADO o NO_APLICA — PENDIENTE, RECHAZADO y NULL (cotizaciones anteriores a
// D.2) lo bloquean. Se invoca dentro de la transacción, con la fila ya bloqueada (FOR UPDATE) y
// ANTES de cualquier escritura: al lanzar, el ROLLBACK no deja ningún cambio. El UPDATE condicional
// del repositorio repite la condición como defensa atómica final.
function exigirAnticipoResuelto(cotizacion: { estado_anticipo: string | null }): void {
  if (!anticipoPermiteSaldo(cotizacion.estado_anticipo)) {
    throw new SaldoRequiereAnticipoValidadoError();
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
} & DatosDeGestion): Promise<TransferenciaPago> {
  validarTipoPago(input.tipoPago);
  if (!(input.importeDeclarado > 0)) {
    throw new ImporteInvalidoError('importeDeclarado debe ser mayor que cero.');
  }
  const { observaciones, llamadaEn } = normalizarDatosDeGestion(input);
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
    if (input.tipoPago === 'SALDO') {
      exigirAnticipoResuelto(cotizacion);
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
    // Un seguimiento (ADMIN sin respuesta, el dinero todavía no aparece…) solo anota una observación sobre una
    // gestión ya registrada: nunca puede ser la primera, porque la revisión del comprobante va antes.
    if (input.seguimiento && (!vigenteAnterior || vigenteAnterior.estado !== 'PENDIENTE')) {
      throw new AnticipoRequiereRevisionError();
    }
    if (vigenteAnterior) {
      await transferenciasRepo.marcarNoVigente(vigenteAnterior.id, client);
    }
    // En un seguimiento los datos de la gestión (importe, banco, cuenta, referencia, comprobante) se conservan
    // tal como estaban; lo que cambia es la observación y la hora de la llamada, si se conoce.
    const base = input.seguimiento ? vigenteAnterior : null;

    const creado = await transferenciasRepo.crear(
      {
        cotizacionId: input.cotizacionId,
        tipoPago: input.tipoPago,
        importeDeclarado: base ? Number(base.importe_declarado) : input.importeDeclarado,
        comprobantePath: base ? base.comprobante_path : (input.comprobantePath ?? vigenteAnterior?.comprobante_path ?? null),
        estado: 'PENDIENTE',
        gestionadoPor: input.gestionadoPor,
        registradoPor: input.gestionadoPor,
        vigente: true,
        bancoOrigen: base ? base.banco_origen : (input.bancoOrigen ?? null),
        cuentaBancariaId: base ? base.cuenta_bancaria_id : (input.cuentaBancariaId ?? null),
        bancoCuentaSnapshot: base ? base.banco_cuenta_snapshot : (snapshot?.banco ?? null),
        titularCuentaSnapshot: base ? base.titular_cuenta_snapshot : (snapshot?.titular ?? null),
        tipoCuentaSnapshot: base ? base.tipo_cuenta_snapshot : (snapshot?.tipoCuenta ?? null),
        numeroCuentaSnapshot: base ? base.numero_cuenta_snapshot : (snapshot?.numeroCuenta ?? null),
        referenciaBancaria: base ? base.referencia_bancaria : (input.referenciaBancaria ?? null),
        observaciones,
        llamadaEn,
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
} & DatosDeGestion): Promise<TransferenciaPago> {
  validarTipoPago(input.tipoPago);
  if (!MOTIVOS_RECHAZO.includes(input.motivoRechazo)) {
    throw new MotivoRechazoInvalidoError(`motivoRechazo debe ser uno de: ${MOTIVOS_RECHAZO.join(', ')}`);
  }
  if (input.motivoRechazo === 'OTRO' && !input.motivoRechazoDetalle?.trim()) {
    throw new MotivoRechazoInvalidoError('motivoRechazoDetalle es requerido cuando motivoRechazo es OTRO.');
  }
  const { observaciones, llamadaEn } = normalizarDatosDeGestion(input);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cotizacion = await cotizacionesRepo.lockParaTransferencia(input.cotizacionId, client);
    if (!cotizacion) {
      throw new CotizacionNoEncontradaError();
    }
    if (input.tipoPago === 'SALDO') {
      exigirAnticipoResuelto(cotizacion);
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
        observaciones,
        llamadaEn,
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
} & DatosDeGestion): Promise<TransferenciaPago> {
  const datos = normalizarDatosDeGestion(input);
  return confirmarAcreditacion({
    cotizacionId: input.cotizacionId,
    tipoPago: input.tipoPago,
    verificadoPor: input.adminId,
    registradoPor: input.adminId,
    medioConfirmacion: 'DIRECTO',
    metodoSaldo: input.metodoSaldo,
    ...datos,
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
} & DatosDeGestion): Promise<TransferenciaPago> {
  const datos = normalizarDatosDeGestion(input);
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
    ...datos,
  });
}

async function confirmarAcreditacion(input: {
  cotizacionId: string;
  tipoPago: string;
  verificadoPor: string;
  registradoPor: string;
  medioConfirmacion: 'DIRECTO' | 'TELEFONICO';
  metodoSaldo?: string;
  observaciones: string | null;
  llamadaEn: Date | null;
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
      // «Dinero acreditado» de un anticipo por TRANSFERENCIA: COMERCIAL debe haber revisado antes el comprobante
      // que subió el cliente (una gestión vigente PENDIENTE). Aplica a TODAS las vías que acreditan (telefónica y
      // VALIDAR directo de ADMIN): ninguna puede saltarse la revisión. Solo cuando el anticipo está PENDIENTE: con
      // cualquier otro estado el UPDATE condicional de abajo responde con PagoNoConfirmableError (409). El efectivo
      // conserva su flujo propio (no tiene comprobante que revisar).
      if (cotizacion.estado_anticipo === 'PENDIENTE' && cotizacion.metodo_anticipo === 'TRANSFERENCIA') {
        if (!cotizacion.comprobante_anticipo) {
          throw new AnticipoRequiereComprobanteError();
        }
        const revision = await transferenciasRepo.obtenerVigente(input.cotizacionId, 'ANTICIPO', client);
        if (!revision || revision.estado !== 'PENDIENTE') {
          throw new AnticipoRequiereRevisionError();
        }
      }
      actualizada = await cotizacionesRepo.actualizarEstadoAnticipo(input.cotizacionId, 'VALIDADO', input.verificadoPor, client);
    } else {
      // El saldo exige el anticipo resuelto (VALIDADO o NO_APLICA); se comprueba antes que el
      // método y el comprobante porque es la condición de estado de la cotización.
      exigirAnticipoResuelto(cotizacion);
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
        observaciones: input.observaciones,
        llamadaEn: input.llamadaEn,
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
