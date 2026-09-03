import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

export interface Cliente {
  id: string;
  nombre: string;
  empresa: string | null;
  email: string;
  telefono: string;
  creado_en: string;
}

type Executor = Pool | PoolClient;

export async function listAll(): Promise<Cliente[]> {
  const result = await pool.query<Cliente>(
    `SELECT id, nombre, empresa, email, telefono, creado_en
     FROM clientes
     ORDER BY creado_en DESC`
  );
  return result.rows;
}

export async function findByEmail(executor: Executor, email: string): Promise<Cliente | null> {
  const result = await executor.query<Cliente>(
    `SELECT id, nombre, empresa, email, telefono, creado_en
     FROM clientes
     WHERE email = $1`,
    [email]
  );
  return result.rows[0] ?? null;
}

export async function create(
  executor: Executor,
  data: { nombre: string; empresa: string | null; email: string; telefono: string }
): Promise<Cliente> {
  const result = await executor.query<Cliente>(
    `INSERT INTO clientes (id, nombre, empresa, email, telefono)
     VALUES (gen_random_uuid(), $1, $2, $3, $4)
     RETURNING id, nombre, empresa, email, telefono, creado_en`,
    [data.nombre, data.empresa, data.email, data.telefono]
  );
  return result.rows[0];
}
