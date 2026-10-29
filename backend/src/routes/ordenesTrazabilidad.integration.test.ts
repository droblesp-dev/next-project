// V22 (nextproject_test, real): cada hito de la orden guarda QUIEN lo ejecuto (finalizada_por,
// entrega_confirmada_por, cerrada_por y el ultimo estado_cambiado_por) y el detalle expone los nombres.
// Las ordenes se insertan por SQL (no depende de OPERATIVO_POR_DEFECTO_EMAIL); el resto va por HTTP real.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { ordenesRouter } from './ordenes.routes.js';
import { crearSolicitud, cambiarEstadoSolicitud } from '../services/solicitudes.service.js';
import { crearCotizacion } from '../services/cotizaciones.service.js';

type Rol = 'ADMIN' | 'COMERCIAL' | 'OPERATIVO';

let server: http.Server;
let baseUrl: string;
const ids: Record<Rol, string> = { ADMIN: '', COMERCIAL: '', OPERATIVO: '' };
const tokens: Record<Rol, string> = { ADMIN: '', COMERCIAL: '', OPERATIVO: '' };

async function crearUsuario(rolNombre: Rol) {
  const rol = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [rolNombre]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
    [`Prueba trazabilidad ${rolNombre}`, `ord-traza.${rolNombre.toLowerCase()}.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  ids[rolNombre] = u.rows[0].id;
  tokens[rolNombre] = jwt.sign({ sub: u.rows[0].id, rol: rolNombre }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  for (const r of ['ADMIN', 'COMERCIAL', 'OPERATIVO'] as const) await crearUsuario(r);
  const app = express();
  app.use(express.json());
  app.use('/api/ordenes', ordenesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function ordenNueva(): Promise<string> {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba trazabilidad ordenes',
      empresa: null,
      email: `ord-traza.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio trazabilidad',
      descripcion: 'Registro ficticio de integracion (trazabilidad de ordenes V22).',
      cantidad: 1,
    },
    `ord-traza-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  const cot = await crearCotizacion({ solicitudId: s.solicitud.id, valor: 100, descripcion: null, creadoPor: ids.COMERCIAL, anticipoPorcentaje: 0 });
  await pool.query(`UPDATE cotizaciones SET estado = 'ACEPTADA', estado_saldo = 'VALIDADO' WHERE id = $1`, [cot.id]);
  const o = await pool.query<{ id: string }>(
    `INSERT INTO ordenes (id, cotizacion_id, responsable_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
    [cot.id, ids.OPERATIVO]
  );
  return o.rows[0].id;
}

function patch(token: string, ruta: string, cuerpo: unknown = {}) {
  return fetch(`${baseUrl}/api/ordenes/${ruta}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(cuerpo),
  });
}

async function detalle(id: string) {
  const res = await fetch(`${baseUrl}/api/ordenes/${id}`, { headers: { Authorization: `Bearer ${tokens.ADMIN}` } });
  return ((await res.json()) as { orden: Record<string, unknown> }).orden;
}

describe('V22 - trazabilidad de actores en ordenes', () => {
  it('una orden nueva no inventa autores', async () => {
    const orden = await detalle(await ordenNueva());
    expect(orden).toMatchObject({ estado_cambiado_por: null, finalizada_por: null, entrega_confirmada_por: null, cerrada_por: null });
  });

  it('registra quien cambio el estado, quien finalizo, quien confirmo la entrega y quien cerro', async () => {
    const id = await ordenNueva();

    expect((await patch(tokens.OPERATIVO, `${id}/estado`, { estado: 'EN_PROCESO' })).status).toBe(200);
    expect(await detalle(id)).toMatchObject({ estado_cambiado_por: ids.OPERATIVO, finalizada_por: null });

    await pool.query(`UPDATE ordenes SET avance = 100 WHERE id = $1`, [id]);
    await pool.query(`INSERT INTO ordenes_evidencias (orden_id, tipo, nombre_archivo) VALUES ($1, 'FOTO', 'traza.png')`, [id]);
    expect((await patch(tokens.OPERATIVO, `${id}/estado`, { estado: 'FINALIZADA', observaciones: 'Trabajo terminado' })).status).toBe(200);
    expect(await detalle(id)).toMatchObject({
      estado_cambiado_por: ids.OPERATIVO,
      finalizada_por: ids.OPERATIVO,
      finalizada_por_nombre: 'Prueba trazabilidad OPERATIVO',
      entrega_confirmada_por: null,
    });

    expect((await patch(tokens.COMERCIAL, `${id}/entrega`)).status).toBe(200);
    expect(await detalle(id)).toMatchObject({
      entrega_confirmada_por: ids.COMERCIAL,
      entrega_confirmada_por_nombre: 'Prueba trazabilidad COMERCIAL',
      estado_cambiado_por: ids.OPERATIVO,
    });

    expect((await patch(tokens.ADMIN, `${id}/cerrar`)).status).toBe(200);
    expect(await detalle(id)).toMatchObject({
      estado: 'CERRADA',
      cerrada_por: ids.ADMIN,
      cerrada_por_nombre: 'Prueba trazabilidad ADMIN',
      estado_cambiado_por: ids.ADMIN,
      finalizada_por: ids.OPERATIVO,
      entrega_confirmada_por: ids.COMERCIAL,
    });
  });

  it('una segunda confirmacion de entrega (409) no cambia al autor original', async () => {
    const id = await ordenNueva();
    await pool.query(`UPDATE ordenes SET estado = 'FINALIZADA' WHERE id = $1`, [id]);
    expect((await patch(tokens.COMERCIAL, `${id}/entrega`)).status).toBe(200);

    expect((await patch(tokens.ADMIN, `${id}/entrega`)).status).toBe(409);

    expect(await detalle(id)).toMatchObject({ entrega_confirmada_por: ids.COMERCIAL });
  });

  it('la cancelacion guarda a quien cancelo en estado_cambiado_por', async () => {
    const id = await ordenNueva();
    expect((await patch(tokens.COMERCIAL, `${id}/cancelar`, { motivo: 'Cliente desistio' })).status).toBe(200);
    expect(await detalle(id)).toMatchObject({ estado: 'CANCELADA', estado_cambiado_por: ids.COMERCIAL, finalizada_por: null, cerrada_por: null });
  });
});
