// V21 (nextproject_test, real): `transferencias_pago` es un historial inmutable. Solo se permite `vigente`
// true -> false; cualquier otro UPDATE y todo DELETE/TRUNCATE se rechaza, salvo la limpieza de pruebas
// (base nextproject_test + marca de transacción fijada por RegistroLimpieza).
import { randomUUID } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../config/db.js';
import { RegistroLimpieza } from '../config/testCleanup.js';
import * as transferenciasRepo from './transferenciasPago.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from '../services/solicitudes.service.js';
import { crearCotizacion } from '../services/cotizaciones.service.js';

let usuarioId: string;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  const rol = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'COMERCIAL'`);
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), 'Prueba Protecciones Pagos', $1, 'placeholder-no-usado-para-login', $2) RETURNING id`,
    [`protecciones-pagos.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  usuarioId = inserted.rows[0].id;
});

async function nuevaTransferencia() {
  const sufijo = randomUUID();
  const r = await crearSolicitud(
    {
      nombre: 'Prueba Protecciones Pagos',
      empresa: null,
      email: `protecciones-pagos.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio Protecciones Pagos',
      descripcion: 'Registro ficticio de integración (protecciones V21).',
      cantidad: 1,
    },
    `protecciones-pagos-${sufijo}`
  );
  await cambiarEstadoSolicitud(r.solicitud.id, 'EN_REVISION');
  const cot = await crearCotizacion({ solicitudId: r.solicitud.id, valor: 100, descripcion: null, creadoPor: usuarioId, anticipoPorcentaje: 0 });
  return transferenciasRepo.crear({
    cotizacionId: cot.id,
    tipoPago: 'ANTICIPO',
    importeDeclarado: 50,
    gestionadoPor: usuarioId,
    registradoPor: usuarioId,
    vigente: true,
  });
}

describe('V21 — transferencias_pago inmutable', () => {
  it('marcarNoVigente (vigente true -> false) sigue permitido', async () => {
    const t = await nuevaTransferencia();
    await transferenciasRepo.marcarNoVigente(t.id);
    const { rows } = await pool.query(`SELECT vigente FROM transferencias_pago WHERE id = $1`, [t.id]);
    expect(rows[0].vigente).toBe(false);
  });

  it.each([
    ['cambiar el estado', `UPDATE transferencias_pago SET estado = 'VALIDADO' WHERE id = $1`],
    ['cambiar el importe', `UPDATE transferencias_pago SET importe_declarado = 1 WHERE id = $1`],
    ['cambiar vigente y otra columna a la vez', `UPDATE transferencias_pago SET vigente = false, observaciones = 'x' WHERE id = $1`],
    ['reactivar (false -> true) un intento no vigente', `UPDATE transferencias_pago SET vigente = true WHERE id = $1 AND vigente = false`],
  ])('rechaza %s', async (_nombre, sql) => {
    const t = await nuevaTransferencia();
    if (sql.includes('vigente = false')) await transferenciasRepo.marcarNoVigente(t.id);
    const antes = (await pool.query(`SELECT * FROM transferencias_pago WHERE id = $1`, [t.id])).rows[0];
    await expect(pool.query(sql, [t.id])).rejects.toMatchObject({ code: '23514' });
    expect((await pool.query(`SELECT * FROM transferencias_pago WHERE id = $1`, [t.id])).rows[0]).toEqual(antes);
  });

  it('rechaza DELETE y TRUNCATE sin la marca de limpieza de pruebas', async () => {
    const t = await nuevaTransferencia();
    await expect(pool.query(`DELETE FROM transferencias_pago WHERE id = $1`, [t.id])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(`TRUNCATE transferencias_pago`)).rejects.toMatchObject({ code: '23514' });
    const { rowCount } = await pool.query(`SELECT 1 FROM transferencias_pago WHERE id = $1`, [t.id]);
    expect(rowCount).toBe(1);
  });

  it('la marca es local a la transacción: tras ella el DELETE vuelve a rechazarse', async () => {
    const t = await nuevaTransferencia();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.permitir_limpieza_pruebas', 'on', true)`);
      await client.query('ROLLBACK');
      await expect(client.query(`DELETE FROM transferencias_pago WHERE id = $1`, [t.id])).rejects.toMatchObject({ code: '23514' });
    } finally {
      client.release();
    }
  });

  it('RegistroLimpieza sí puede borrar las transferencias que registró', async () => {
    const t = await nuevaTransferencia();
    const registro = new RegistroLimpieza();
    registro.registrarTransferencia(t.id);
    const r = await registro.limpiar(pool);
    expect(r.transferenciasEliminadas).toBe(1);
    expect((await pool.query(`SELECT 1 FROM transferencias_pago WHERE id = $1`, [t.id])).rowCount).toBe(0);
  });
});
