import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import 'dotenv/config';
import { pool } from '../src/config/db.js';

const SALT_ROUNDS = 12;

const USUARIOS = [
  {
    nombre: 'Administrador NextProject',
    email: 'admin.seed@nextproject.test',
    rolNombre: 'ADMIN',
    envVar: 'SEED_ADMIN_PASSWORD',
  },
  {
    nombre: 'Comercial NextProject',
    email: 'comercial.seed@nextproject.test',
    rolNombre: 'COMERCIAL',
    envVar: 'SEED_COMERCIAL_PASSWORD',
  },
  {
    nombre: 'Operativo NextProject',
    email: 'operativo.seed@nextproject.test',
    rolNombre: 'OPERATIVO',
    envVar: 'SEED_OPERATIVO_PASSWORD',
  },
];

async function main() {
  const faltantes = USUARIOS.filter((usuario) => !process.env[usuario.envVar]).map((usuario) => usuario.envVar);

  if (faltantes.length > 0) {
    console.error(
      `Faltan variables de entorno en backend/.env: ${faltantes.join(', ')}.\n` +
        'Definí una contraseña para cada una (ver backend/.env.example) y volvé a ejecutar el script.'
    );
    process.exit(1);
  }

  const client = await pool.connect();
  const resultado: string[] = [];

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
        resultado.push(`${usuario.rolNombre} | ${usuario.email} | ya existía, no se modificó`);
        continue;
      }

      const password = process.env[usuario.envVar]!;
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const rolId = rolResult.rows[0].id;

      await client.query(
        `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id, activo)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [randomUUID(), usuario.nombre, usuario.email, passwordHash, rolId]
      );

      resultado.push(`${usuario.rolNombre} | ${usuario.email} | creado`);
    }

    await client.query('COMMIT');

    console.log('Usuarios de prueba aplicados correctamente (uno por rol):');
    resultado.forEach((linea) => console.log(`  - ${linea}`));
    console.log('Las contraseñas son las definidas en backend/.env (no se muestran aquí).');
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
