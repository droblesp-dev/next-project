// Siembra del catálogo de bancos para el pipeline (Node plano + `pg`, sin tsx),
// mismo patrón que seed-usuarios-roles.js. Es el equivalente en JS de
// seed-bancos-catalogo.ts: mantener ambas listas sincronizadas.
// Idempotente (ON CONFLICT sobre nombre_normalizado). Requiere un ADMIN activo,
// por eso debe ejecutarse DESPUÉS de seed-usuarios-roles.js. No crea cuentas bancarias.
import { randomUUID } from 'crypto';
import { Pool } from 'pg';

const BANCOS_VERIFICADOS = [
  'Banco Pichincha',
  'Banco del Pacífico',
  'Banco de Guayaquil',
  'Produbanco',
  'Banco Bolivariano',
  'Banco Internacional',
  'Banco del Austro',
  'Banco Diners Club',
  'Banco General Rumiñahui',
  'Banco de Machala',
  'Banco de Loja',
  'Banco Solidario',
  'Banco Amazonas',
  'Banco Coopnacional',
  'Banco Capital',
  'Banco del Litoral',
  'Delbank',
];

// Mismo criterio que normalizarNombreBanco (src/services/bancosCatalogo.service.ts).
const normalizar = (nombre) => nombre.trim().toLowerCase().replace(/\s+/g, ' ');

const REQUERIDAS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
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
  const adminResult = await pool.query(
    `SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id
     WHERE r.nombre = 'ADMIN' AND u.activo = true
     ORDER BY u.creado_en LIMIT 1`
  );
  const adminId = adminResult.rows[0]?.id;
  if (!adminId) {
    console.error('No se encontró ningún usuario ADMIN activo. Ejecute antes seed-usuarios-roles.js.');
    process.exitCode = 1;
    return;
  }

  const client = await pool.connect();
  let insertados = 0;
  try {
    await client.query('BEGIN');
    for (const nombre of BANCOS_VERIFICADOS) {
      const result = await client.query(
        `INSERT INTO bancos_catalogo (id, nombre, nombre_normalizado, creado_por)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (nombre_normalizado) DO NOTHING`,
        [randomUUID(), nombre, normalizar(nombre), adminId]
      );
      insertados += result.rowCount ?? 0;
    }
    await client.query('COMMIT');
    console.log(`Catálogo de bancos: ${insertados} insertados, ${BANCOS_VERIFICADOS.length - insertados} ya existían.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al sembrar el catálogo de bancos. Se ejecutó ROLLBACK. Detalle:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
