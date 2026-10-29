import { Pool } from 'pg';
import { env } from './env.js';

export const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
  ssl: env.db.ssl ? { rejectUnauthorized: false } : undefined,
  // Huella de esta versión del backend en `pg_stat_activity` (R0, #8): permite comprobar en la base que ninguna
  // instancia anterior (que no declara este nombre) sigue conectada antes de abrir el chat tras un despliegue.
  application_name: 'nextproject-api-r0',
});

pool.on('error', (error) => {
  console.error('Error inesperado en el pool de PostgreSQL:', error.message);
});

export async function checkDatabaseConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
