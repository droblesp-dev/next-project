import type { PoolClient, QueryResult } from 'pg';
import { pool } from '../config/db.js';

export interface UsuarioAuth {
  id: string;
  nombre: string;
  email: string;
  password_hash: string;
  activo: boolean;
  rol: string;
}

export interface UsuarioPublico {
  id: string;
  nombre: string;
  email: string;
  activo: boolean;
  rol: string;
}

export async function findByEmailWithRol(email: string): Promise<UsuarioAuth | null> {
  const result = await pool.query<UsuarioAuth>(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.activo, r.nombre AS rol
     FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     WHERE u.email = $1`,
    [email]
  );
  return result.rows[0] ?? null;
}

export async function findByIdWithRol(id: string): Promise<UsuarioPublico | null> {
  const result = await pool.query<UsuarioPublico>(
    `SELECT u.id, u.nombre, u.email, u.activo, r.nombre AS rol
     FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     WHERE u.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function listAll(): Promise<UsuarioPublico[]> {
  const result = await pool.query<UsuarioPublico>(
    `SELECT u.id, u.nombre, u.email, u.activo, r.nombre AS rol
     FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     ORDER BY u.creado_en`
  );
  return result.rows;
}

export interface UsuarioMinimo {
  id: string;
  nombre: string;
}

// PC-2026-01 (continuación — Frontend Secciones C/D): proyección mínima
// (solo id+nombre, nunca email) de los ADMIN activos — usada exclusivamente
// para que COMERCIAL identifique al verificador en «Llamada a ADMIN»
// (CONFIRMAR_TELEFONICA). No reutiliza listAll()/UsuarioPublico para no
// exponerle a COMERCIAL el email de otros usuarios.
export async function listarAdminsActivos(): Promise<UsuarioMinimo[]> {
  const result = await pool.query<UsuarioMinimo>(
    `SELECT u.id, u.nombre
     FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     WHERE r.nombre = 'ADMIN' AND u.activo = true
     ORDER BY u.nombre`
  );
  return result.rows;
}

export async function existsByEmail(email: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
  return (result.rowCount ?? 0) > 0;
}

export async function create(data: {
  nombre: string;
  email: string;
  passwordHash: string;
  rolId: string;
}): Promise<UsuarioPublico> {
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), $1, $2, $3, $4)
     RETURNING id`,
    [data.nombre, data.email, data.passwordHash, data.rolId]
  );
  const nuevo = await findByIdWithRol(inserted.rows[0].id);
  if (!nuevo) {
    throw new Error('No se pudo recuperar el usuario recién creado.');
  }
  return nuevo;
}

// Bloquea (FOR UPDATE) todas las filas de usuarios que son ADMIN activos en
// este momento, dentro de la transacción del `client` recibido. Debe
// llamarse siempre antes de decidir si una operación puede reducir la
// cantidad de administradores activos, para evitar condiciones de carrera
// entre solicitudes concurrentes.
export async function lockActiveAdminIds(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT u.id FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     WHERE r.nombre = 'ADMIN' AND u.activo = true
     FOR UPDATE OF u`
  );
  return result.rows.map((row) => row.id);
}

export async function updateActivo(
  client: PoolClient,
  id: string,
  activo: boolean
): Promise<QueryResult> {
  return client.query('UPDATE usuarios SET activo = $2 WHERE id = $1 RETURNING id', [id, activo]);
}

export async function updateRol(
  client: PoolClient,
  id: string,
  rolId: string
): Promise<QueryResult> {
  return client.query('UPDATE usuarios SET rol_id = $2 WHERE id = $1 RETURNING id', [id, rolId]);
}
