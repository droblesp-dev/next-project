import { randomBytes, randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/db.js';

const SECRETS_DIR = path.resolve('.local-secrets');
const OUTPUT_PATH = path.join(SECRETS_DIR, 'usuarios-seed-credenciales.txt');
const SALT_ROUNDS = 12;

const USUARIOS = [
  { nombre: 'Administrador NextProject', email: 'admin.seed@nextproject.test', rolNombre: 'ADMIN' },
  { nombre: 'Comercial NextProject', email: 'comercial.seed@nextproject.test', rolNombre: 'COMERCIAL' },
  { nombre: 'Operativo NextProject', email: 'operativo.seed@nextproject.test', rolNombre: 'OPERATIVO' },
];

function generarPassword(): string {
  return randomBytes(9).toString('base64url');
}

async function main() {
  const client = await pool.connect();
  const credenciales: string[] = [];

  try {
    await client.query('BEGIN');

    for (const nombre of ['ADMIN', 'COMERCIAL', 'OPERATIVO']) {
      await client.query(
        'INSERT INTO roles (id, nombre, descripcion) VALUES ($1, $2, NULL) ON CONFLICT (nombre) DO NOTHING',
        [randomUUID(), nombre]
      );
    }

    for (const usuario of USUARIOS) {
      const rolResult = await client.query<{ id: string }>(
        'SELECT id FROM roles WHERE nombre = $1',
        [usuario.rolNombre]
      );

      if (rolResult.rowCount === 0) {
        throw new Error(`No se encontró el rol '${usuario.rolNombre}' tras el insert de roles.`);
      }

      const existente = await client.query('SELECT id FROM usuarios WHERE email = $1', [usuario.email]);

      if ((existente.rowCount ?? 0) > 0) {
        credenciales.push(`${usuario.rolNombre} | ${usuario.email} | (ya existía, contraseña no modificada)`);
        continue;
      }

      const password = generarPassword();
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const rolId = rolResult.rows[0].id;

      await client.query(
        `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id, activo)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [randomUUID(), usuario.nombre, usuario.email, passwordHash, rolId]
      );

      credenciales.push(`${usuario.rolNombre} | ${usuario.email} | ${password}`);
    }

    await client.query('COMMIT');

    if (!existsSync(SECRETS_DIR)) {
      mkdirSync(SECRETS_DIR, { recursive: true });
    }
    writeFileSync(
      OUTPUT_PATH,
      credenciales.join('\n') + '\n',
      'utf-8'
    );

    console.log('Usuarios de prueba aplicados correctamente (uno por rol).');
    console.log(`Credenciales en texto plano guardadas localmente en: ${OUTPUT_PATH}`);
    console.log('Ese archivo no se sube a git (.local-secrets/ está en .gitignore).');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error durante la carga de usuarios. Se ejecutó ROLLBACK. Detalle:', (error as Error).message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
