import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { pool } from '../src/config/db.js';

const HASH_PATH = path.resolve('.local-secrets/admin-password-hash.txt');

const ROLES = ['ADMIN', 'COMERCIAL', 'OPERATIVO'];

const ADMIN_USER = {
  nombre: 'Administrador NextProject',
  email: 'admin@nextproject.test',
  rolNombre: 'ADMIN',
};

async function main() {
  if (!existsSync(HASH_PATH)) {
    console.error(
      `No se encontró el archivo de hash local (${HASH_PATH}). Abortando sin modificar PostgreSQL.`
    );
    process.exit(1);
  }

  const passwordHash = readFileSync(HASH_PATH, 'utf-8').trim();

  if (!passwordHash) {
    console.error('El archivo de hash local está vacío. Abortando sin modificar PostgreSQL.');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const nombre of ROLES) {
      await client.query(
        'INSERT INTO roles (id, nombre, descripcion) VALUES ($1, $2, NULL) ON CONFLICT (nombre) DO NOTHING',
        [randomUUID(), nombre]
      );
    }

    const rolResult = await client.query<{ id: string }>(
      'SELECT id FROM roles WHERE nombre = $1',
      [ADMIN_USER.rolNombre]
    );

    if (rolResult.rowCount === 0) {
      throw new Error(`No se encontró el rol '${ADMIN_USER.rolNombre}' tras el insert de roles.`);
    }

    const rolId = rolResult.rows[0].id;

    await client.query(
      `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id, activo)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (email) DO NOTHING`,
      [randomUUID(), ADMIN_USER.nombre, ADMIN_USER.email, passwordHash, rolId]
    );

    await client.query('COMMIT');
    console.log('Datos iniciales aplicados correctamente (roles + usuario administrador).');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error durante la carga inicial. Se ejecutó ROLLBACK. Detalle:', (error as Error).message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
