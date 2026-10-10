// SCRIPT TEMPORAL DE PRUEBA VISUAL — NO forma parte de la lógica de producción.
//
// Crea (o elimina) un escenario mínimo de datos de prueba para revisar a mano,
// en COMERCIAL -> Leads, la integridad Lead -> Cliente -> Solicitud. Todos los
// registros llevan el prefijo "TEST UI - " para reconocerlos y limpiarlos.
//
// Uso (desde backend/):
//   npx tsx scripts/test-ui-leads.ts estado    # solo lectura: lista lo que existe
//   npx tsx scripts/test-ui-leads.ts crear     # inserta el escenario (aborta si ya existe)
//   npx tsx scripts/test-ui-leads.ts limpiar   # elimina SOLO los registros TEST UI
//
// Solo inserta/elimina filas con el prefijo; nunca modifica registros reales.
// Las clasificaciones CONVERTIDO/RECURRENTE y el estado DESCARTADO se fijan
// directamente aquí (solo para estas filas de prueba) porque llegar a ellas
// por el flujo real exigiría cotizaciones aceptadas.
import { randomUUID } from 'crypto';
import 'dotenv/config';
import { pool } from '../src/config/db.js';

const PREFIJO = 'TEST UI - ';
const LIKE = `${PREFIJO}%`;

const CLIENTES = {
  compatible: { nombre: `${PREFIJO}Cliente compatible`, empresa: `${PREFIJO}Empresa Compatible SA`, email: 'test-ui-compatible@example.test' },
  sinSolicitudes: { nombre: `${PREFIJO}Cliente sin solicitudes`, empresa: null, email: 'test-ui-sin-solicitudes@example.test' },
  bloqueados: { nombre: `${PREFIJO}Cliente bloqueados`, empresa: `${PREFIJO}Empresa Bloqueados SA`, email: 'test-ui-bloqueados@example.test' },
} as const;

async function estado() {
  const leads = await pool.query(
    `SELECT l.nombre, l.clasificacion, l.estado, c.nombre AS cliente, s.servicio AS solicitud
     FROM leads l LEFT JOIN clientes c ON c.id = l.cliente_id LEFT JOIN solicitudes s ON s.id = l.solicitud_id
     WHERE l.nombre LIKE $1 ORDER BY l.nombre`,
    [LIKE]
  );
  const clientes = await pool.query(
    `SELECT c.nombre, (SELECT count(*)::int FROM solicitudes s WHERE s.cliente_id = c.id) AS solicitudes
     FROM clientes c WHERE c.nombre LIKE $1 ORDER BY c.nombre`,
    [LIKE]
  );
  console.log('LEADS TEST UI:');
  for (const l of leads.rows) console.log(`  - ${l.nombre} | ${l.clasificacion} ${l.estado} | cliente: ${l.cliente ?? '—'} | solicitud: ${l.solicitud ?? '—'}`);
  console.log('CLIENTES TEST UI:');
  for (const c of clientes.rows) console.log(`  - ${c.nombre} | solicitudes: ${c.solicitudes}`);
  if (leads.rowCount === 0 && clientes.rowCount === 0) console.log('  (no existe ningún registro de prueba)');
}

async function crear() {
  const existentes = await pool.query(
    `SELECT (SELECT count(*) FROM leads WHERE nombre LIKE $1) + (SELECT count(*) FROM clientes WHERE nombre LIKE $1) AS n`,
    [LIKE]
  );
  if (Number(existentes.rows[0].n) > 0) {
    console.error('Ya existen registros TEST UI. Ejecuta primero: npx tsx scripts/test-ui-leads.ts limpiar');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cid: Record<string, string> = {};
    for (const [clave, c] of Object.entries(CLIENTES)) {
      cid[clave] = randomUUID();
      await client.query(
        `INSERT INTO clientes (id, nombre, empresa, email, telefono) VALUES ($1, $2, $3, $4, '0000000000')`,
        [cid[clave], c.nombre, c.empresa, c.email]
      );
    }

    const solicitud = async (clienteId: string, servicio: string, descripcion: string, estadoSol = 'NUEVA') => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO solicitudes (id, cliente_id, servicio, descripcion, cantidad, estado) VALUES ($1, $2, $3, $4, 1, $5)`,
        [id, clienteId, `${PREFIJO}${servicio}`, `${PREFIJO}${descripcion}`, estadoSol]
      );
      return id;
    };

    const solComp1 = await solicitud(cid.compatible, 'Fresado de eje', 'Solicitud de prueba 1 del cliente compatible (vinculada al lead)');
    const solComp2 = await solicitud(cid.compatible, 'Torneado de brida', 'Solicitud de prueba 2 del cliente compatible (sin cotización)');
    const solBloq1 = await solicitud(cid.bloqueados, 'Servicio convertido', 'Solicitud de prueba del lead convertido');
    const solBloq2 = await solicitud(cid.bloqueados, 'Servicio recurrente', 'Solicitud de prueba del lead recurrente');
    const solBloq3 = await solicitud(cid.bloqueados, 'Servicio descartado', 'Solicitud de prueba del lead descartado');

    const lead = async (
      nombre: string,
      clasificacion: string,
      estadoLead: string,
      clienteId: string | null,
      solicitudId: string | null
    ) => {
      await client.query(
        `INSERT INTO leads (id, nombre, telefono, email, fuente, estado, clasificacion, cliente_id, solicitud_id, observaciones)
         VALUES ($1, $2, '0000000000', 'test-ui@example.test', 'OTRO', $3, $4, $5, $6, 'Registro de prueba visual (TEST UI). Se puede eliminar.')`,
        [randomUUID(), `${PREFIJO}${nombre}`, estadoLead, clasificacion, clienteId, solicitudId]
      );
    };

    await lead('Lead tibio', 'TIBIO', 'ACTIVO', null, null);
    await lead('Lead tibio con cliente', 'TIBIO', 'ACTIVO', cid.sinSolicitudes, null);
    await lead('Lead compatible', 'CALIENTE', 'ACTIVO', cid.compatible, solComp1);
    await lead('Lead caliente sin cotizacion', 'CALIENTE', 'ACTIVO', cid.compatible, solComp2);
    await lead('Lead sin cliente', 'FRIO', 'ACTIVO', null, null);
    await lead('Lead cliente sin solicitudes', 'FRIO', 'ACTIVO', cid.sinSolicitudes, null);
    await lead('Lead convertido', 'CONVERTIDO', 'ACTIVO', cid.bloqueados, solBloq1);
    await lead('Lead recurrente', 'RECURRENTE', 'ACTIVO', cid.bloqueados, solBloq2);
    await lead('Lead descartado', 'CALIENTE', 'DESCARTADO', cid.bloqueados, solBloq3);

    await client.query(
      `INSERT INTO lead_seguimientos (id, lead_id, tipo, observacion)
       SELECT gen_random_uuid(), l.id, t.tipo, t.obs FROM leads l,
         (VALUES ('LLAMADA', 'TEST UI - Primer contacto: pidió información de torneado.'),
                 ('WHATSAPP', 'TEST UI - Se acordó enviar un enlace para completar la solicitud.')) AS t(tipo, obs)
       WHERE l.nombre = $1`,
      [`${PREFIJO}Lead tibio`]
    );

    // Cotización de ejemplo sobre la solicitud del lead CALIENTE (para ver la sección COTIZACIÓN).
    await client.query(
      `INSERT INTO cotizaciones (id, solicitud_id, valor, total, estado, descripcion)
       VALUES (gen_random_uuid(), $1, 1250.00, 1250.00, 'ENVIADA', 'TEST UI - Cotización de ejemplo')`,
      [solComp1]
    );

    await client.query('COMMIT');
    console.log('Escenario TEST UI creado.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await estado();
}

async function limpiar() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seg = await client.query(
      `DELETE FROM lead_seguimientos WHERE lead_id IN (SELECT id FROM leads WHERE nombre LIKE $1)`,
      [LIKE]
    );
    const leads = await client.query(`DELETE FROM leads WHERE nombre LIKE $1`, [LIKE]);
    // Cotizaciones de ejemplo creadas por este script (solo las de solicitudes de clientes TEST UI).
    await client.query(
      `DELETE FROM cotizaciones WHERE solicitud_id IN (
         SELECT s.id FROM solicitudes s JOIN clientes c ON c.id = s.cliente_id WHERE c.nombre LIKE $1)`,
      [LIKE]
    );
    const sols = await client.query(
      `DELETE FROM solicitudes WHERE cliente_id IN (SELECT id FROM clientes WHERE nombre LIKE $1)`,
      [LIKE]
    );
    const clientes = await client.query(`DELETE FROM clientes WHERE nombre LIKE $1`, [LIKE]);
    await client.query('COMMIT');
    console.log(
      `Limpieza TEST UI: seguimientos=${seg.rowCount}, leads=${leads.rowCount}, solicitudes=${sols.rowCount}, clientes=${clientes.rowCount}`
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Limpieza revertida (no se eliminó nada). Posible dato dependiente (p. ej. cotización) creado sobre un registro TEST UI.');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const modo = process.argv[2];
  if (modo === 'estado') await estado();
  else if (modo === 'crear') await crear();
  else if (modo === 'limpiar') await limpiar();
  else {
    console.error('Uso: npx tsx scripts/test-ui-leads.ts <estado|crear|limpiar>');
    process.exitCode = 1;
  }
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
