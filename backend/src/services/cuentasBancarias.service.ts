import type { PoolClient } from 'pg';
import { pool } from '../config/db.js';
import * as cuentasBancariasRepo from '../repositories/cuentasBancarias.repository.js';
import * as bancosCatalogoRepo from '../repositories/bancosCatalogo.repository.js';
import type { CuentaBancaria, CuentaBancariaConLogo, CuentaBancariaPublica } from '../repositories/cuentasBancarias.repository.js';
import { normalizarNombreBanco, validarTipoEntidad } from './bancosCatalogo.service.js';

export class CuentaBancariaNoEncontradaError extends Error {}
export class TipoCuentaInvalidoError extends Error {}
export class DatosCuentaBancariaInvalidosError extends Error {}
export class BancoRequeridoError extends Error {}
export class BancoCatalogoInvalidoError extends Error {}

const TIPOS_CUENTA_VALIDOS = ['AHORROS', 'CORRIENTE'];

// Fase A (auditoría funcional): límites alineados con las columnas reales de
// `cuentas_bancarias` (V14) — banco VARCHAR(100); titular y numero_cuenta se limitan a 60 y 20 caracteres (decisión de producto, más estrictos que VARCHAR(200)/VARCHAR(50) del esquema, que no cambia),
// El nombre de una entidad personalizada se copia a
// `cuentas_bancarias.banco`, por eso su límite es 100 aunque
// `bancos_catalogo.nombre` (V15) admita 150. Se validan aquí para responder
// 400 con un mensaje claro en vez de dejar que PostgreSQL falle con un 500.
// Duplicados en frontend/src/lib/cuentasBancariasForm.ts (paquetes separados).
export const LIMITES_CUENTA_BANCARIA = {
  titular: 60,
  numeroCuenta: 20,
  bancoNombre: 100,
} as const;

export interface LogoPendiente {
  nombreArchivo: string;
  buffer: Buffer;
}

export interface DatosCuentaBancariaInput {
  titular: string;
  tipoCuenta: string;
  numeroCuenta: string;
  // Exactamente uno de los dos — validado en validarSeleccionBanco().
  bancoCatalogoId?: string | null;
  bancoPersonalizadoNombre?: string | null;
  // PC-2026-01, Fase 1: solo relevante cuando se crea una entidad nueva
  // del catálogo (bancoPersonalizadoNombre sin coincidencia previa por
  // nombre normalizado) — nunca cambia el tipo de una entidad ya
  // existente seleccionada por bancoCatalogoId o reutilizada por nombre.
  tipoEntidad?: string;
  titularVisibleCliente?: boolean;
  activo?: boolean;
  logo?: LogoPendiente | null;
  // Fase B (V17): el logo es PROPIO de la cuenta. `quitarLogo` elimina
  // únicamente la asociación de ESTA cuenta con su logo propio (si no tiene
  // uno propio no hace nada: nunca toca el logo heredado de la entidad). Si
  // además se envía `logo` (archivo nuevo), el archivo nuevo tiene
  // prioridad.
  quitarLogo?: boolean;
}

// Mismas validaciones para crear y editar — nunca se confía en que el
// CHECK de PostgreSQL sea la única barrera (regla del proyecto: el backend
// valida, PostgreSQL garantiza integridad como red de seguridad final).
export function validarDatosBase(input: DatosCuentaBancariaInput): void {
  if (!input.titular?.trim() || !input.numeroCuenta?.trim()) {
    throw new DatosCuentaBancariaInvalidosError('titular y numeroCuenta son requeridos.');
  }
  if (input.titular.trim().length > LIMITES_CUENTA_BANCARIA.titular) {
    throw new DatosCuentaBancariaInvalidosError(
      `titular no puede superar ${LIMITES_CUENTA_BANCARIA.titular} caracteres.`
    );
  }
  if (input.numeroCuenta.trim().length > LIMITES_CUENTA_BANCARIA.numeroCuenta) {
    throw new DatosCuentaBancariaInvalidosError(
      `numeroCuenta no puede superar ${LIMITES_CUENTA_BANCARIA.numeroCuenta} caracteres.`
    );
  }
  if (
    typeof input.bancoPersonalizadoNombre === 'string' &&
    input.bancoPersonalizadoNombre.trim().length > LIMITES_CUENTA_BANCARIA.bancoNombre
  ) {
    throw new DatosCuentaBancariaInvalidosError(
      `El nombre del banco no puede superar ${LIMITES_CUENTA_BANCARIA.bancoNombre} caracteres.`
    );
  }
  if (!TIPOS_CUENTA_VALIDOS.includes(input.tipoCuenta)) {
    throw new TipoCuentaInvalidoError(`tipoCuenta debe ser uno de: ${TIPOS_CUENTA_VALIDOS.join(', ')}`);
  }
  const tieneCatalogo = typeof input.bancoCatalogoId === 'string' && input.bancoCatalogoId.trim();
  const tienePersonalizado = typeof input.bancoPersonalizadoNombre === 'string' && input.bancoPersonalizadoNombre.trim();
  if (!tieneCatalogo && !tienePersonalizado) {
    throw new BancoRequeridoError('Debe seleccionar un banco del catálogo o escribir el nombre de un banco personalizado.');
  }
  if (tieneCatalogo && tienePersonalizado) {
    throw new BancoRequeridoError('Envíe bancoCatalogoId o bancoPersonalizadoNombre, no ambos.');
  }
}

// Resuelve (y, si corresponde, crea) la entidad del catálogo de bancos dentro
// de la misma transacción que la cuenta — nunca deja una cuenta huérfana de
// banco ni duplica una entidad ya existente (dedup por nombre normalizado).
//
// Fase B (V17): esta función ya NO escribe logos. `bancos_catalogo.logo_path`
// es el logo compartido de la entidad (p. ej. los oficiales sembrados) y
// ninguna operación sobre una cuenta lo modifica; el logo que sube o quita
// el usuario vive en `cuentas_bancarias.logo_path`. Una entidad personalizada
// nueva se crea siempre sin logo en el catálogo.
async function resolverBancoCatalogo(
  client: PoolClient,
  input: {
    bancoCatalogoId?: string | null;
    bancoPersonalizadoNombre?: string | null;
    tipoEntidad?: string;
  },
  creadoPor: string
): Promise<{ bancoId: string; nombre: string }> {
  if (input.bancoCatalogoId) {
    const banco = await bancosCatalogoRepo.findById(input.bancoCatalogoId, client);
    if (!banco) {
      throw new BancoCatalogoInvalidoError('bancoCatalogoId no corresponde a ninguna entidad del catálogo.');
    }
    return { bancoId: banco.id, nombre: banco.nombre };
  }

  // bancoPersonalizadoNombre (ya validado como presente por validarDatosBase)
  const nombre = input.bancoPersonalizadoNombre!.trim();
  const nombreNormalizado = normalizarNombreBanco(nombre);
  const existente = await bancosCatalogoRepo.findByNombreNormalizado(nombreNormalizado, client);

  if (existente) {
    return { bancoId: existente.id, nombre: existente.nombre };
  }

  const tipo = validarTipoEntidad(input.tipoEntidad);
  const creado = await bancosCatalogoRepo.create({ nombre, nombreNormalizado, logoPath: null, creadoPor, tipo }, client);
  return { bancoId: creado.id, nombre: creado.nombre };
}

export async function listarCuentasBancarias(): Promise<CuentaBancariaConLogo[]> {
  return cuentasBancariasRepo.listAll();
}

// Para el flujo público de cotizaciones (Fase F) — `titular` se oculta
// (null) cuando la cuenta tiene `titular_visible_cliente = false`; nunca
// se construye a partir de datos inventados. `logo_url` se calcula aquí
// (único lugar) para que el contrato público nunca exponga el nombre de
// archivo crudo del disco.
export async function listarCuentasActivasPublico(): Promise<CuentaBancariaPublica[]> {
  const filas = await cuentasBancariasRepo.listActivas();
  return filas.map((c) => ({
    banco: c.banco,
    titular: c.titular_visible_cliente ? c.titular : null,
    tipo_cuenta: c.tipo_cuenta,
    numero_cuenta: c.numero_cuenta,
    logo_url: c.logo_path ? `/uploads/logos-bancos/${c.logo_path}` : null,
  }));
}

// Cuentas receptoras que ve el personal (ADMIN/COMERCIAL) al gestionar un pago:
// solo las ACTIVAS y solo lo imprescindible para identificar y elegir la cuenta
// (id, banco, tipo y número). No incluye el titular — no hace falta para elegir,
// y su visibilidad (`titular_visible_cliente`) es una política orientada al
// cliente — ni logo, estado ni datos de auditoría. El titular de la cuenta
// elegida queda en el historial a través de la copia (snapshot) que guarda
// `transferenciasPago.service.ts::registrarGestionPago`.
export interface CuentaReceptora {
  id: string;
  banco: string;
  tipo_cuenta: string;
  numero_cuenta: string;
}

export async function listarCuentasReceptorasActivas(): Promise<CuentaReceptora[]> {
  const filas = await cuentasBancariasRepo.listActivas();
  return filas.map((c) => ({ id: c.id, banco: c.banco, tipo_cuenta: c.tipo_cuenta, numero_cuenta: c.numero_cuenta }));
}

export async function obtenerCuentaBancaria(id: string): Promise<CuentaBancaria> {
  const cuenta = await cuentasBancariasRepo.findById(id);
  if (!cuenta) {
    throw new CuentaBancariaNoEncontradaError();
  }
  return cuenta;
}

export async function crearCuentaBancaria(
  input: DatosCuentaBancariaInput,
  creadoPor: string
): Promise<{ cuenta: CuentaBancaria; archivoLogoAEscribir: LogoPendiente | null }> {
  validarDatosBase(input);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { bancoId, nombre } = await resolverBancoCatalogo(client, input, creadoPor);
    const cuenta = await cuentasBancariasRepo.create(
      {
        banco: nombre,
        titular: input.titular.trim(),
        tipoCuenta: input.tipoCuenta,
        numeroCuenta: input.numeroCuenta.trim(),
        creadoPor,
        bancoCatalogoId: bancoId,
        titularVisibleCliente: input.titularVisibleCliente ?? true,
        activo: input.activo,
        logoPath: input.logo?.nombreArchivo ?? null,
      },
      client
    );
    await client.query('COMMIT');
    return { cuenta, archivoLogoAEscribir: input.logo ?? null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function editarCuentaBancaria(
  id: string,
  input: DatosCuentaBancariaInput,
  editadoPor: string
): Promise<{ cuenta: CuentaBancaria; archivoLogoAEscribir: LogoPendiente | null }> {
  validarDatosBase(input);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existente = await cuentasBancariasRepo.findById(id, client);
    if (!existente) {
      throw new CuentaBancariaNoEncontradaError();
    }
    const { bancoId, nombre } = await resolverBancoCatalogo(client, input, editadoPor);
    // Logo propio de la cuenta: archivo nuevo -> se asigna; quitarLogo ->
    // solo se desasocia (null); cambio de entidad sin archivo nuevo -> se
    // desasocia el logo propio, que pertenecía a la entidad anterior; en
    // cualquier otro caso (undefined) se conserva tal cual.
    const cambioDeEntidad = existente.banco_catalogo_id !== bancoId;
    const logoPath = input.logo ? input.logo.nombreArchivo : input.quitarLogo || cambioDeEntidad ? null : undefined;
    const actualizada = await cuentasBancariasRepo.update(
      id,
      {
        banco: nombre,
        titular: input.titular.trim(),
        tipoCuenta: input.tipoCuenta,
        numeroCuenta: input.numeroCuenta.trim(),
        bancoCatalogoId: bancoId,
        titularVisibleCliente: input.titularVisibleCliente ?? existente.titular_visible_cliente,
        logoPath,
      },
      client
    );
    if (!actualizada) {
      throw new CuentaBancariaNoEncontradaError();
    }
    await client.query('COMMIT');
    return { cuenta: actualizada, archivoLogoAEscribir: input.logo ?? null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function cambiarActivoCuentaBancaria(id: string, activo: boolean): Promise<CuentaBancaria> {
  const actualizada = await cuentasBancariasRepo.updateActivo(id, activo);
  if (!actualizada) {
    throw new CuentaBancariaNoEncontradaError();
  }
  return actualizada;
}
