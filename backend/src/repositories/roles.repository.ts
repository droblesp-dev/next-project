import { pool } from '../config/db.js';

export interface Rol {
  id: string;
  nombre: string;
}

const ROLES_VALIDOS = ['ADMIN', 'COMERCIAL', 'OPERATIVO'] as const;
export type RolNombre = (typeof ROLES_VALIDOS)[number];

export function esRolValido(valor: string): valor is RolNombre {
  return (ROLES_VALIDOS as readonly string[]).includes(valor);
}

export async function findByNombre(nombre: string): Promise<Rol | null> {
  const result = await pool.query<Rol>('SELECT id, nombre FROM roles WHERE nombre = $1', [nombre]);
  return result.rows[0] ?? null;
}
