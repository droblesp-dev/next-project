import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

export interface CuentaBancaria {
  id: string;
  banco: string;
  titular: string;
  tipo_cuenta: string;
  numero_cuenta: string;
  activo: boolean;
  creado_por: string;
  creado_en: string;
  actualizado_en: string;
  banco_catalogo_id: string | null;
  titular_visible_cliente: boolean;
  // V17: logo PROPIO de la cuenta (nombre de archivo), o null si hereda el
  // de su entidad del catálogo. Nunca es el logo efectivo — ese es
  // `logo_path` en las filas de listAll()/listActivas().
  logo_propio_path: string | null;
}

// Fila de listado: `logo_path` es el logo EFECTIVO (el propio de la cuenta
// y, si no tiene, el de su entidad del catálogo).
export type CuentaBancariaConLogo = CuentaBancaria & { logo_path: string | null };

// Subconjunto expuesto a la consulta pública (sin id técnico, creado_por ni
// timestamps) — Fase D.6-equivalente de esta propuesta: nunca se entrega al
// cliente más de lo estrictamente necesario para transferir. `titular` es
// `string | null` porque `titular_visible_cliente` puede ocultarlo (ver
// cuentasBancarias.service.ts::aPublica) — no es un campo opcional
// olvidado, la ausencia es intencional.
export interface CuentaBancariaPublica {
  banco: string;
  titular: string | null;
  tipo_cuenta: string;
  numero_cuenta: string;
  logo_url: string | null;
}

const COLUMNAS =
  'id, banco, titular, tipo_cuenta, numero_cuenta, activo, creado_por, creado_en, actualizado_en, banco_catalogo_id, titular_visible_cliente, logo_path AS logo_propio_path';

// Logo efectivo = el propio de la cuenta, o el de la entidad del catálogo si
// la cuenta no tiene (V17). Un único lugar para que el listado administrativo
// y la consulta pública nunca difieran.
const SELECT_CON_LOGO_EFECTIVO = `SELECT cb.id, cb.banco, cb.titular, cb.tipo_cuenta, cb.numero_cuenta, cb.activo,
            cb.creado_por, cb.creado_en, cb.actualizado_en, cb.banco_catalogo_id, cb.titular_visible_cliente,
            cb.logo_path AS logo_propio_path,
            COALESCE(cb.logo_path, bc.logo_path) AS logo_path
     FROM cuentas_bancarias cb
     LEFT JOIN bancos_catalogo bc ON bc.id = cb.banco_catalogo_id`;

type Executor = Pool | PoolClient;

// Incluye el logo de la entidad del catálogo asociada (Fase E: el listado
// administrativo muestra el logo en su propia columna).
export async function listAll(executor: Executor = pool): Promise<CuentaBancariaConLogo[]> {
  const result = await executor.query<CuentaBancariaConLogo>(`${SELECT_CON_LOGO_EFECTIVO} ORDER BY cb.creado_en`);
  return result.rows;
}

// Solo activas — alimenta tanto el DTO público de cotizaciones como
// cualquier otro consumidor público futuro. Incluye `titular` siempre (la
// ocultación por `titular_visible_cliente` se aplica en el servicio, al
// construir `CuentaBancariaPublica`, no aquí) y el logo de la entidad del
// catálogo asociada (si tiene una).
export async function listActivas(executor: Executor = pool): Promise<CuentaBancariaConLogo[]> {
  const result = await executor.query<CuentaBancariaConLogo>(
    `${SELECT_CON_LOGO_EFECTIVO} WHERE cb.activo = true ORDER BY cb.creado_en`
  );
  return result.rows;
}

export async function findById(id: string, executor: Executor = pool): Promise<CuentaBancaria | null> {
  const result = await executor.query<CuentaBancaria>(`SELECT ${COLUMNAS} FROM cuentas_bancarias WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function create(
  data: {
    banco: string;
    titular: string;
    tipoCuenta: string;
    numeroCuenta: string;
    creadoPor: string;
    bancoCatalogoId: string | null;
    titularVisibleCliente: boolean;
    activo?: boolean;
    logoPath?: string | null;
  },
  executor: Executor = pool
): Promise<CuentaBancaria> {
  const result = await executor.query<CuentaBancaria>(
    `INSERT INTO cuentas_bancarias
       (id, banco, titular, tipo_cuenta, numero_cuenta, creado_por, banco_catalogo_id, titular_visible_cliente, activo, logo_path)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, COALESCE($8, true), $9)
     RETURNING ${COLUMNAS}`,
    [
      data.banco,
      data.titular,
      data.tipoCuenta,
      data.numeroCuenta,
      data.creadoPor,
      data.bancoCatalogoId,
      data.titularVisibleCliente,
      data.activo ?? null,
      data.logoPath ?? null,
    ]
  );
  return result.rows[0];
}

export async function update(
  id: string,
  data: {
    banco: string;
    titular: string;
    tipoCuenta: string;
    numeroCuenta: string;
    bancoCatalogoId: string | null;
    titularVisibleCliente: boolean;
    // undefined = no tocar el logo propio; null = quitarlo (solo la
    // asociación con esta cuenta); string = asignar ese archivo. Nunca
    // escribe bancos_catalogo.
    logoPath?: string | null;
  },
  executor: Executor = pool
): Promise<CuentaBancaria | null> {
  const result = await executor.query<CuentaBancaria>(
    `UPDATE cuentas_bancarias
     SET banco = $2, titular = $3, tipo_cuenta = $4, numero_cuenta = $5,
         banco_catalogo_id = $6, titular_visible_cliente = $7,
         logo_path = CASE WHEN $8::boolean THEN $9::text ELSE logo_path END,
         actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING ${COLUMNAS}`,
    [
      id,
      data.banco,
      data.titular,
      data.tipoCuenta,
      data.numeroCuenta,
      data.bancoCatalogoId,
      data.titularVisibleCliente,
      data.logoPath !== undefined,
      data.logoPath ?? null,
    ]
  );
  return result.rows[0] ?? null;
}

export async function updateActivo(id: string, activo: boolean, executor: Executor = pool): Promise<CuentaBancaria | null> {
  const result = await executor.query<CuentaBancaria>(
    `UPDATE cuentas_bancarias
     SET activo = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING ${COLUMNAS}`,
    [id, activo]
  );
  return result.rows[0] ?? null;
}
