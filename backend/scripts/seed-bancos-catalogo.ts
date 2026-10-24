import { randomUUID } from 'crypto';
import 'dotenv/config';
import { pool } from '../src/config/db.js';
import { normalizarNombreBanco } from '../src/services/bancosCatalogo.service.js';

// PC-2026-01 (Fase B — catálogo de bancos de Ecuador): siembra el
// catálogo inicial de entidades verificadas — nunca crea cuentas
// bancarias receptoras (decisión 8: el catálogo es independiente de
// `cuentas_bancarias`). Idempotente (ON CONFLICT ... DO NOTHING sobre
// nombre_normalizado): puede ejecutarse más de una vez sin duplicar.
//
// Nombres verificados contra fuentes reales antes de incluirlos (ninguno
// se inventó): listado de entidades del sector financiero privado
// cubiertas por el seguro de depósitos (COSEDE) e informes de
// calificación de riesgo de instituciones financieras de la
// Superintendencia de Bancos del Ecuador. Varios nombres propuestos
// originalmente por el propietario NO se incluyen aquí por no haberse
// podido verificar su vigencia actual con una fuente real en esta tarea
// (Banco ProCredit, Citibank Ecuador, Banco de Desarrollo de los Pueblos/
// Codesarrollo, Banco VisionFund Ecuador, Banco Comercial de Manabí,
// Banco Atlántida Ecuador) — quedan documentados como pendientes de
// verificación en el informe de cierre; ADMIN puede agregarlos
// manualmente mediante «Otro banco (personalizado)» si confirma su
// vigencia.
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

async function main() {
  const adminResult = await pool.query<{ id: string }>(
    `SELECT u.id FROM usuarios u JOIN roles r ON r.id = u.rol_id
     WHERE r.nombre = 'ADMIN' AND u.activo = true
     ORDER BY u.creado_en LIMIT 1`
  );
  const adminId = adminResult.rows[0]?.id;
  if (!adminId) {
    console.error('No se encontró ningún usuario ADMIN activo en esta base de datos. Cree uno antes de sembrar el catálogo.');
    process.exit(1);
  }

  const client = await pool.connect();
  const insertados: string[] = [];
  const yaExistian: string[] = [];

  try {
    await client.query('BEGIN');

    for (const nombre of BANCOS_VERIFICADOS) {
      const nombreNormalizado = normalizarNombreBanco(nombre);
      const result = await client.query(
        `INSERT INTO bancos_catalogo (id, nombre, nombre_normalizado, creado_por)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (nombre_normalizado) DO NOTHING
         RETURNING id`,
        [randomUUID(), nombre, nombreNormalizado, adminId]
      );
      if (result.rowCount && result.rowCount > 0) {
        insertados.push(nombre);
      } else {
        yaExistian.push(nombre);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  console.log(`Insertados (${insertados.length}): ${insertados.join(', ') || '(ninguno)'}`);
  console.log(`Ya existían (${yaExistian.length}): ${yaExistian.join(', ') || '(ninguno)'}`);
  await pool.end();
}

main().catch((error) => {
  console.error('Error al sembrar el catálogo de bancos:', error);
  process.exit(1);
});
