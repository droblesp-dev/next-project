import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

// PC-2026-01 (Fase B — catálogo de bancos de Ecuador): tabla creada en
// V15, independiente de `cuentas_bancarias` — agregar una entidad aquí
// nunca crea ni habilita una cuenta receptora.

export interface BancoCatalogo {
  id: string;
  nombre: string;
  nombre_normalizado: string;
  logo_path: string | null;
  creado_por: string;
  creado_en: string;
  tipo: string;
}

type Executor = Pool | PoolClient;

const COLUMNAS = 'id, nombre, nombre_normalizado, logo_path, creado_por, creado_en, tipo';

export async function listAll(executor: Executor = pool): Promise<BancoCatalogo[]> {
  const result = await executor.query<BancoCatalogo>(`SELECT ${COLUMNAS} FROM bancos_catalogo ORDER BY nombre`);
  return result.rows;
}

export async function findById(id: string, executor: Executor = pool): Promise<BancoCatalogo | null> {
  const result = await executor.query<BancoCatalogo>(`SELECT ${COLUMNAS} FROM bancos_catalogo WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function findByNombreNormalizado(
  nombreNormalizado: string,
  executor: Executor = pool
): Promise<BancoCatalogo | null> {
  const result = await executor.query<BancoCatalogo>(
    `SELECT ${COLUMNAS} FROM bancos_catalogo WHERE nombre_normalizado = $1`,
    [nombreNormalizado]
  );
  return result.rows[0] ?? null;
}

export async function create(
  data: { nombre: string; nombreNormalizado: string; logoPath?: string | null; creadoPor: string; tipo: string },
  executor: Executor = pool
): Promise<BancoCatalogo> {
  const result = await executor.query<BancoCatalogo>(
    `INSERT INTO bancos_catalogo (id, nombre, nombre_normalizado, logo_path, creado_por, tipo)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
     RETURNING ${COLUMNAS}`,
    [data.nombre, data.nombreNormalizado, data.logoPath ?? null, data.creadoPor, data.tipo]
  );
  return result.rows[0];
}

// Reemplaza el logo (o lo quita, con `null`) de una entidad ya existente
// del catálogo — compartido por todas las cuentas que la referencien,
// nunca una copia por cuenta (ver comentario de V15).
export async function actualizarLogo(
  id: string,
  logoPath: string | null,
  executor: Executor = pool
): Promise<BancoCatalogo | null> {
  const result = await executor.query<BancoCatalogo>(
    `UPDATE bancos_catalogo SET logo_path = $2 WHERE id = $1 RETURNING ${COLUMNAS}`,
    [id, logoPath]
  );
  return result.rows[0] ?? null;
}
