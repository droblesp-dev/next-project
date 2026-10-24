import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

// PC-2026-01, Etapa 2: repositorio de `transferencias_pago` (creada en
// V13/V14). Este archivo solo persiste/consulta la tabla — todavía no está
// conectado a `gestionarAnticipo()`/`gestionarSaldo()` (eso pertenece a una
// etapa posterior de integración, junto con las transacciones que unan
// ambas escrituras). Ningún `UPDATE`/`DELETE` de este archivo toca las
// filas existentes de `cotizaciones`.

export interface TransferenciaPago {
  id: string;
  cotizacion_id: string;
  tipo_pago: string;
  importe_declarado: string;
  comprobante_path: string | null;
  estado: string;
  gestionado_por: string;
  verificado_por: string | null;
  registrado_por: string;
  medio_confirmacion: string | null;
  vigente: boolean;
  creado_en: string;
  banco_origen: string | null;
  cuenta_bancaria_id: string | null;
  banco_cuenta_snapshot: string | null;
  titular_cuenta_snapshot: string | null;
  tipo_cuenta_snapshot: string | null;
  numero_cuenta_snapshot: string | null;
  referencia_bancaria: string | null;
  motivo_rechazo: string | null;
  motivo_rechazo_detalle: string | null;
}

type Executor = Pool | PoolClient;

const COLUMNAS = `id, cotizacion_id, tipo_pago, importe_declarado, comprobante_path, estado,
                   gestionado_por, verificado_por, registrado_por, medio_confirmacion, vigente, creado_en,
                   banco_origen, cuenta_bancaria_id, banco_cuenta_snapshot, titular_cuenta_snapshot,
                   tipo_cuenta_snapshot, numero_cuenta_snapshot, referencia_bancaria,
                   motivo_rechazo, motivo_rechazo_detalle`;

// Crea un nuevo intento. No decide por sí solo si marca `vigente=false` al
// anterior ni sincroniza las columnas-caché de `cotizaciones` — eso es
// responsabilidad del servicio que la integre, dentro de una transacción
// (ver auditoría de Fase 2 ya entregada: patrón de `ordenEvidencia.service.ts`).
export async function crear(
  data: {
    cotizacionId: string;
    tipoPago: string;
    importeDeclarado: number;
    comprobantePath?: string | null;
    estado?: string;
    gestionadoPor: string;
    verificadoPor?: string | null;
    registradoPor: string;
    medioConfirmacion?: string | null;
    vigente: boolean;
    bancoOrigen?: string | null;
    cuentaBancariaId?: string | null;
    bancoCuentaSnapshot?: string | null;
    titularCuentaSnapshot?: string | null;
    tipoCuentaSnapshot?: string | null;
    numeroCuentaSnapshot?: string | null;
    referenciaBancaria?: string | null;
    motivoRechazo?: string | null;
    motivoRechazoDetalle?: string | null;
  },
  executor: Executor = pool
): Promise<TransferenciaPago> {
  const result = await executor.query<TransferenciaPago>(
    `INSERT INTO transferencias_pago (
       id, cotizacion_id, tipo_pago, importe_declarado, comprobante_path, estado,
       gestionado_por, verificado_por, registrado_por, medio_confirmacion, vigente,
       banco_origen, cuenta_bancaria_id, banco_cuenta_snapshot, titular_cuenta_snapshot,
       tipo_cuenta_snapshot, numero_cuenta_snapshot, referencia_bancaria,
       motivo_rechazo, motivo_rechazo_detalle
     )
     VALUES (
       gen_random_uuid(), $1, $2, $3, $4, COALESCE($5, 'PENDIENTE'),
       $6, $7, $8, $9, $10,
       $11, $12, $13, $14,
       $15, $16, $17,
       $18, $19
     )
     RETURNING ${COLUMNAS}`,
    [
      data.cotizacionId,
      data.tipoPago,
      data.importeDeclarado,
      data.comprobantePath ?? null,
      data.estado ?? null,
      data.gestionadoPor,
      data.verificadoPor ?? null,
      data.registradoPor,
      data.medioConfirmacion ?? null,
      data.vigente,
      data.bancoOrigen ?? null,
      data.cuentaBancariaId ?? null,
      data.bancoCuentaSnapshot ?? null,
      data.titularCuentaSnapshot ?? null,
      data.tipoCuentaSnapshot ?? null,
      data.numeroCuentaSnapshot ?? null,
      data.referenciaBancaria ?? null,
      data.motivoRechazo ?? null,
      data.motivoRechazoDetalle ?? null,
    ]
  );
  return result.rows[0];
}

// Historial completo de una cotización (ambos tipos de pago, vigentes y no
// vigentes), más reciente primero — nunca filtra por `vigente` para no
// ocultar intentos anteriores.
export async function listarPorCotizacion(
  cotizacionId: string,
  executor: Executor = pool
): Promise<TransferenciaPago[]> {
  const result = await executor.query<TransferenciaPago>(
    `SELECT ${COLUMNAS} FROM transferencias_pago WHERE cotizacion_id = $1 ORDER BY creado_en DESC`,
    [cotizacionId]
  );
  return result.rows;
}

export async function obtenerVigente(
  cotizacionId: string,
  tipoPago: string,
  executor: Executor = pool
): Promise<TransferenciaPago | null> {
  const result = await executor.query<TransferenciaPago>(
    `SELECT ${COLUMNAS} FROM transferencias_pago WHERE cotizacion_id = $1 AND tipo_pago = $2 AND vigente = true`,
    [cotizacionId, tipoPago]
  );
  return result.rows[0] ?? null;
}

// Último intento registrado para (cotización, tipo_pago), vigente o no —
// usado para comparar el `banco_origen` contra el pago anterior, aunque
// ese anterior ya haya quedado `vigente=false`.
export async function obtenerUltimoIntento(
  cotizacionId: string,
  tipoPago: string,
  executor: Executor = pool
): Promise<TransferenciaPago | null> {
  const result = await executor.query<TransferenciaPago>(
    `SELECT ${COLUMNAS} FROM transferencias_pago
     WHERE cotizacion_id = $1 AND tipo_pago = $2
     ORDER BY creado_en DESC
     LIMIT 1`,
    [cotizacionId, tipoPago]
  );
  return result.rows[0] ?? null;
}

// Marca como no vigente el intento anterior — nunca lo borra ni modifica
// ningún otro campo (comprobante, motivo, responsables quedan intactos).
export async function marcarNoVigente(id: string, executor: Executor = pool): Promise<void> {
  await executor.query('UPDATE transferencias_pago SET vigente = false WHERE id = $1', [id]);
}
