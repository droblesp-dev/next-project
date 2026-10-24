import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

const USUARIOS = [
  {
    nombre: 'Administrador NextProject',
    rolNombre: 'ADMIN',
    emailVar: 'SEED_ADMIN_EMAIL',
    passwordVar: 'SEED_ADMIN_PASSWORD',
  },
  {
    nombre: 'Comercial NextProject',
    rolNombre: 'COMERCIAL',
    emailVar: 'SEED_COMERCIAL_EMAIL',
    passwordVar: 'SEED_COMERCIAL_PASSWORD',
  },
  {
    nombre: 'Operativo NextProject',
    rolNombre: 'OPERATIVO',
    emailVar: 'SEED_OPERATIVO_EMAIL',
    passwordVar: 'SEED_OPERATIVO_PASSWORD',
  },
];

const REQUERIDAS = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  ...USUARIOS.flatMap((usuario) => [usuario.emailVar, usuario.passwordVar]),
];

const faltantes = REQUERIDAS.filter((nombre) => !process.env[nombre]);
if (faltantes.length > 0) {
  console.error(`Faltan variables de entorno: ${faltantes.join(', ')}`);
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:
    (process.env.DB_SSL ?? '').trim().toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
});

async function main() {
  const client = await pool.connect();
  const resultado = [];

  try {
    await client.query('BEGIN');

    for (const nombre of ['ADMIN', 'COMERCIAL', 'OPERATIVO']) {
      await client.query(
        'INSERT INTO roles (id, nombre, descripcion) VALUES ($1, $2, NULL) ON CONFLICT (nombre) DO NOTHING',
        [randomUUID(), nombre]
      );
    }

    for (const usuario of USUARIOS) {
      const email = process.env[usuario.emailVar];
      const password = process.env[usuario.passwordVar];

      const rolResult = await client.query('SELECT id FROM roles WHERE nombre = $1', [usuario.rolNombre]);
      if (rolResult.rowCount === 0) {
        throw new Error(`No se encontró el rol '${usuario.rolNombre}' tras el insert de roles.`);
      }

      const existente = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
      if ((existente.rowCount ?? 0) > 0) {
        resultado.push(`${usuario.rolNombre} | ${email} | ya existía, no se modificó`);
        continue;
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const rolId = rolResult.rows[0].id;

      await client.query(
        `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id, activo)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [randomUUID(), usuario.nombre, email, passwordHash, rolId]
      );

      resultado.push(`${usuario.rolNombre} | ${email} | creado`);
    }

    await client.query('COMMIT');

    console.log('Usuarios de prueba aplicados correctamente (uno por rol):');
    resultado.forEach((linea) => console.log(`  - ${linea}`));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error durante la carga de usuarios. Se ejecutó ROLLBACK. Detalle:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
