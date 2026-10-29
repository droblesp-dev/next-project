// #11 (nextproject_test, real): cada orden entrega los numeros legibles SOL y COT de su origen, derivados de la
// cadena orden -> cotizacion -> solicitud. Si la cotizacion o la solicitud es anterior a la numeracion (codigo NULL),
// la orden devuelve null: nunca se inventan ni se rellenan. Lo ven todos los roles que consultan ordenes.
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

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  for (const rolNombre of ['ADMIN', 'COMERCIAL', 'OPERATIVO'] as const) {
    const rol = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [rolNombre]);
    const u = await pool.query<{ id: string }>(
      `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
       VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
      [`Prueba origen ${rolNombre}`, `ord-origen.${rolNombre.toLowerCase()}.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
    );
    ids[rolNombre] = u.rows[0].id;
    tokens[rolNombre] = jwt.sign({ sub: u.rows[0].id, rol: rolNombre }, env.jwtSecret, {
      expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    });
  }
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

async function ordenNueva(): Promise<{ ordenId: string; cotizacionId: string; solicitudId: string }> {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba origen ordenes',
      empresa: null,
      email: `ord-origen.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio origen',
      descripcion: 'Registro ficticio de integracion (origen SOL/COT de las ordenes).',
      cantidad: 1,
    },
    `ord-origen-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  const cot = await crearCotizacion({ solicitudId: s.solicitud.id, valor: 100, descripcion: null, creadoPor: ids.COMERCIAL, anticipoPorcentaje: 0 });
  await pool.query(`UPDATE cotizaciones SET estado = 'ACEPTADA' WHERE id = $1`, [cot.id]);
  const o = await pool.query<{ id: string }>(
    `INSERT INTO ordenes (id, cotizacion_id, responsable_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
    [cot.id, ids.OPERATIVO]
  );
  return { ordenId: o.rows[0].id, cotizacionId: cot.id, solicitudId: s.solicitud.id };
}

async function detalle(token: string, id: string) {
  const res = await fetch(`${baseUrl}/api/ordenes/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { orden: Record<string, unknown> }).orden;
}

async function codigosReales(cotizacionId: string, solicitudId: string) {
  const c = await pool.query<{ codigo: string | null }>('SELECT codigo FROM cotizaciones WHERE id = $1', [cotizacionId]);
  const s = await pool.query<{ codigo: string | null }>('SELECT codigo FROM solicitudes WHERE id = $1', [solicitudId]);
  return { cot: c.rows[0].codigo, sol: s.rows[0].codigo };
}

describe('#11 — SOL y COT de origen en las ordenes', () => {
  it('el detalle entrega el SOL y el COT reales de la cadena de la orden, a todos los roles', async () => {
    const { ordenId, cotizacionId, solicitudId } = await ordenNueva();
    const { cot, sol } = await codigosReales(cotizacionId, solicitudId);
    expect(cot).toMatch(/^COT-\d{6}$/);
    expect(sol).toMatch(/^SOL-\d{6}$/);

    for (const rol of ['ADMIN', 'COMERCIAL', 'OPERATIVO'] as const) {
      expect(await detalle(tokens[rol], ordenId)).toMatchObject({ cotizacion_codigo: cot, solicitud_codigo: sol });
    }
  });

  it('el listado incluye los codigos de cada orden, sin mezclar los de otras ordenes', async () => {
    const a = await ordenNueva();
    const b = await ordenNueva();
    const res = await fetch(`${baseUrl}/api/ordenes`, { headers: { Authorization: `Bearer ${tokens.OPERATIVO}` } });
    const { ordenes } = (await res.json()) as { ordenes: Array<{ id: string; cotizacion_codigo: string | null; solicitud_codigo: string | null }> };

    for (const o of [a, b]) {
      const { cot, sol } = await codigosReales(o.cotizacionId, o.solicitudId);
      expect(ordenes.find((x) => x.id === o.ordenId)).toMatchObject({ cotizacion_codigo: cot, solicitud_codigo: sol });
    }
    const ca = await codigosReales(a.cotizacionId, a.solicitudId);
    const cb = await codigosReales(b.cotizacionId, b.solicitudId);
    expect(ca.cot).not.toBe(cb.cot);
    expect(ca.sol).not.toBe(cb.sol);
  });

  it('historica: sin numero de cotizacion y/o de solicitud devuelve null, nunca un valor inventado', async () => {
    const { ordenId, cotizacionId, solicitudId } = await ordenNueva();
    const { cot, sol } = await codigosReales(cotizacionId, solicitudId);

    await pool.query('UPDATE cotizaciones SET codigo = NULL WHERE id = $1', [cotizacionId]);
    expect(await detalle(tokens.ADMIN, ordenId)).toMatchObject({ cotizacion_codigo: null, solicitud_codigo: sol });

    await pool.query('UPDATE solicitudes SET codigo = NULL WHERE id = $1', [solicitudId]);
    expect(await detalle(tokens.OPERATIVO, ordenId)).toMatchObject({ cotizacion_codigo: null, solicitud_codigo: null });

    // la asociacion real sigue intacta: solo falta el numero visible
    const vinculo = await pool.query('SELECT solicitud_id FROM cotizaciones WHERE id = $1', [cotizacionId]);
    expect(vinculo.rows[0].solicitud_id).toBe(solicitudId);
    expect(cot).not.toBeNull();
  });
});
