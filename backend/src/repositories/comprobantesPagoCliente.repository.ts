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
}

export async function registrar(
  data: { id: string; cotizacionId: string; tipoPago: 'ANTICIPO' | 'SALDO'; archivo: string },
  executor: Executor = pool
): Promise<ComprobantePagoCliente> {
  const result = await executor.query<ComprobantePagoCliente>(
    `INSERT INTO comprobantes_pago_cliente (id, cotizacion_id, tipo_pago, archivo)
     VALUES ($1, $2, $3, $4)
     RETURNING id, cotizacion_id, tipo_pago, archivo, creado_en`,
    [data.id, data.cotizacionId, data.tipoPago, data.archivo]
  );
  return result.rows[0];
}

export async function listarPorCotizacion(
  cotizacionId: string,
  executor: Executor = pool
): Promise<ComprobantePagoCliente[]> {
  const result = await executor.query<ComprobantePagoCliente>(
    `SELECT id, cotizacion_id, tipo_pago, archivo, creado_en
     FROM comprobantes_pago_cliente WHERE cotizacion_id = $1 ORDER BY creado_en DESC`,
    [cotizacionId]
  );
  return result.rows;
}
