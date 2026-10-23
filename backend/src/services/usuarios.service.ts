import type { PoolClient, QueryResult } from 'pg';
import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';
import {
  listAll,
  listarAdminsActivos as listarAdminsActivosRepo,
  existsByEmail,
  create as crearUsuarioRepo,
  lockActiveAdminIds,
  updateActivo as updateActivoRepo,
  updateRol as updateRolRepo,
  findByIdWithRol,
  type UsuarioPublico,
  type UsuarioMinimo,
} from '../repositories/usuarios.repository.js';
import { findByNombre, esRolValido } from '../repositories/roles.repository.js';

// CORRECCIÓN FASE 4 (hallazgo #2): costo 12, igual al que ya usan los scripts de seed
// (scripts/seed-usuarios-roles.ts, scripts/generate-admin-hash.ts) y al nuevo DUMMY_HASH de
// auth.service.ts. Antes era 10 — desalineado con esos scripts, lo que producía un side-channel
// de timing real y medible (Fase 4) entre un login con correo existente y uno inexistente.
// bcrypt.compare() sigue funcionando igual para cualquier hash ya existente (el costo viaja
// embebido en el propio hash) — no afecta a ningún usuario ya creado, solo a los que se creen de
// aquí en adelante.
const SALT_ROUNDS = 12;

export class EmailDuplicadoError extends Error {}
export class RolInvalidoError extends Error {}
export class UltimoAdminError extends Error {}
export class UsuarioNoEncontradoError extends Error {}

export async function listarUsuarios(): Promise<UsuarioPublico[]> {
  return listAll();
}

export async function listarAdminsActivos(): Promise<UsuarioMinimo[]> {
  return listarAdminsActivosRepo();
}

export async function crearUsuario(input: {
  nombre: string;
  email: string;
  password: string;
  rol: string;
}): Promise<UsuarioPublico> {
  if (!esRolValido(input.rol)) {
    throw new RolInvalidoError(`Rol inválido: ${input.rol}`);
  }

  const rol = await findByNombre(input.rol);
  if (!rol) {
    throw new RolInvalidoError(`Rol inválido: ${input.rol}`);
  }

  const yaExiste = await existsByEmail(input.email);
  if (yaExiste) {
    throw new EmailDuplicadoError('El email ya está registrado.');
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  try {
    return await crearUsuarioRepo({
      nombre: input.nombre,
      email: input.email,
      passwordHash,
      rolId: rol.id,
    });
  } catch (error) {
    // Red de seguridad ante una condición de carrera en el chequeo previo
    // de email duplicado: la propia restricción UNIQUE de PostgreSQL
    // (ya existente, no creada en esta fase) rechaza el INSERT.
    if (isUniqueViolation(error)) {
      throw new EmailDuplicadoError('El email ya está registrado.');
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

type ResultadoProteccion = 'ok' | 'no-encontrado' | 'ultimo-admin';

/**
 * Ejecuta un cambio sobre un usuario (desactivar o reasignar rol) protegido
 * ante la posibilidad de dejar el sistema sin ningún ADMIN activo.
 *
 * `reduceElRolAdmin` indica si, EN CASO de que el usuario objetivo sea
 * actualmente un ADMIN activo, la operación solicitada lo sacaría de ese
 * conjunto (desactivarlo, o cambiarle el rol a uno distinto de ADMIN).
 *
 * Todo el chequeo + la modificación ocurren dentro de una misma transacción,
 * bloqueando (`FOR UPDATE`) las filas de los ADMIN activos antes de decidir,
 * para que dos solicitudes concurrentes no puedan dejar 0 ADMIN activos.
 */
async function ejecutarConProteccionUltimoAdmin(
  id: string,
  reduceElRolAdmin: boolean,
  aplicarCambio: (client: PoolClient) => Promise<QueryResult>
): Promise<ResultadoProteccion> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const activeAdminIds = await lockActiveAdminIds(client);

    if (reduceElRolAdmin && activeAdminIds.includes(id)) {
      const quedarianActivos = activeAdminIds.length - 1;
      if (quedarianActivos < 1) {
        await client.query('ROLLBACK');
        return 'ultimo-admin';
      }
    }

    const result = await aplicarCambio(client);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return 'no-encontrado';
    }

    await client.query('COMMIT');
    return 'ok';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cambiarActivo(id: string, activo: boolean): Promise<UsuarioPublico> {
  // Activar nunca reduce la cantidad de ADMIN activos; solo desactivar puede.
  const reduce = activo === false;

  const resultado = await ejecutarConProteccionUltimoAdmin(id, reduce, (client) =>
    updateActivoRepo(client, id, activo)
  );

  if (resultado === 'no-encontrado') throw new UsuarioNoEncontradoError();
  if (resultado === 'ultimo-admin') throw new UltimoAdminError();

  const usuario = await findByIdWithRol(id);
  if (!usuario) throw new UsuarioNoEncontradoError();
  return usuario;
}

export async function cambiarRol(id: string, nuevoRol: string): Promise<UsuarioPublico> {
  if (!esRolValido(nuevoRol)) {
    throw new RolInvalidoError(`Rol inválido: ${nuevoRol}`);
  }

  const rol = await findByNombre(nuevoRol);
  if (!rol) {
    throw new RolInvalidoError(`Rol inválido: ${nuevoRol}`);
  }

  // Cambiar A ADMIN nunca reduce la cantidad de ADMIN activos (promueve o
  // no cambia nada); cambiar A cualquier otro rol sí puede reducirla.
  const reduce = nuevoRol !== 'ADMIN';

  const resultado = await ejecutarConProteccionUltimoAdmin(id, reduce, (client) =>
    updateRolRepo(client, id, rol.id)
  );

  if (resultado === 'no-encontrado') throw new UsuarioNoEncontradoError();
  if (resultado === 'ultimo-admin') throw new UltimoAdminError();

  const usuario = await findByIdWithRol(id);
  if (!usuario) throw new UsuarioNoEncontradoError();
  return usuario;
}
