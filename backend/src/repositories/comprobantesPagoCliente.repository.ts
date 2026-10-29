import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

// Historial de los comprobantes que sube el cliente desde el enlace público (V19). Cada subida es
// una fila nueva: nunca se actualiza ni se borra una anterior.

type Executor = Pool | PoolClient;

export interface ComprobantePagoCliente {
  id: string;
  cotizacion_id: string;
  tipo_pago: string;
  archivo: string;
  creado_en: string;
  // QA-08 (V24): cuenta que el cliente dijo haber usado. Informativa; la cuenta real la confirma COMERCIAL.
  cuenta_bancaria_id: string | null;
}

// Fila para el personal: el comprobante con la cuenta indicada por el cliente (si la hubo).
export interface ComprobanteConCuentaIndicada {
  tipo_pago: string;
  creado_en: string;
  cuenta_indicada: { banco: string; tipo_cuenta: string; numero_cuenta: string } | null;
}

export async function registrar(
  data: { id: string; cotizacionId: string; tipoPago: 'ANTICIPO' | 'SALDO'; archivo: string; cuentaBancariaId?: string | null },
  executor: Executor = pool
): Promise<ComprobantePagoCliente> {
  const result = await executor.query<ComprobantePagoCliente>(
    `INSERT INTO comprobantes_pago_cliente (id, cotizacion_id, tipo_pago, archivo, cuenta_bancaria_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, cotizacion_id, tipo_pago, archivo, creado_en, cuenta_bancaria_id`,
    [data.id, data.cotizacionId, data.tipoPago, data.archivo, data.cuentaBancariaId ?? null]
  );
  return result.rows[0];
}

export async function listarPorCotizacion(
  cotizacionId: string,
  executor: Executor = pool
): Promise<ComprobantePagoCliente[]> {
  const result = await executor.query<ComprobantePagoCliente>(
    `SELECT id, cotizacion_id, tipo_pago, archivo, creado_en, cuenta_bancaria_id
     FROM comprobantes_pago_cliente WHERE cotizacion_id = $1 ORDER BY creado_en DESC`,
    [cotizacionId]
  );
  return result.rows;
}

// Para la gestión interna: nunca expone el nombre de archivo, solo cuándo subió el cliente y qué cuenta indicó.
export async function listarConCuentaIndicada(
  cotizacionId: string,
  executor: Executor = pool
): Promise<ComprobanteConCuentaIndicada[]> {
  const result = await executor.query<{
    tipo_pago: string;
    creado_en: string;
    banco: string | null;
    tipo_cuenta: string | null;
    numero_cuenta: string | null;
  }>(
    `SELECT c.tipo_pago, c.creado_en, cb.banco, cb.tipo_cuenta, cb.numero_cuenta
     FROM comprobantes_pago_cliente c
     LEFT JOIN cuentas_bancarias cb ON cb.id = c.cuenta_bancaria_id
     WHERE c.cotizacion_id = $1 ORDER BY c.creado_en DESC`,
    [cotizacionId]
  );
  return result.rows.map((r) => ({
    tipo_pago: r.tipo_pago,
    creado_en: r.creado_en,
    cuenta_indicada: r.banco ? { banco: r.banco, tipo_cuenta: r.tipo_cuenta ?? '', numero_cuenta: r.numero_cuenta ?? '' } : null,
  }));
}
