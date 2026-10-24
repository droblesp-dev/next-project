// PC-2026-01: POST /api/ordenes con una cotización inexistente debe responder 404
// "Cotización no encontrada." y no crear ninguna orden. Prueba HTTP real contra
// `nextproject_test` (mismo guard que el resto de pruebas de integración).
// Solo inserta usuarios ficticios (necesarios para firmar JWT); no crea órdenes ni
// transferencias, así que no requiere RegistroLimpieza.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { ordenesRouter } from './ordenes.routes.js';
import * as ordenesRepo from '../repositories/ordenes.repository.js';

// UUID v4 válido y fijo; la prueba confirma que no existe antes de usarlo.
const COTIZACION_INEXISTENTE = '00000000-0000-4000-8000-000000000404';

let server: http.Server;
let baseUrl: string;
let tokenAdmin: string;
let tokenComercial: string;
let tokenOperativo: string;

function firmar(sub: string, rol: string): string {
  return jwt.sign({ sub, rol }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

async function crearUsuario(rolNombre: string): Promise<string> {
  const rol = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [rolNombre]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
    [`Prueba orden cotizacion inexistente (${rolNombre})`, `orden-inexistente.${rolNombre.toLowerCase()}.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  return u.rows[0].id;
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  tokenAdmin = firmar(await crearUsuario('ADMIN'), 'ADMIN');
  tokenComercial = firmar(await crearUsuario('COMERCIAL'), 'COMERCIAL');
  tokenOperativo = firmar(await crearUsuario('OPERATIVO'), 'OPERATIVO');

  const app = express();
  app.use(express.json());
  app.use('/api/ordenes', ordenesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function crear(token: string | null, cuerpo: unknown) {
  return fetch(`${baseUrl}/api/ordenes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
}

async function ordenesDeLaCotizacion(): Promise<number> {
  const r = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM ordenes WHERE cotizacion_id = $1', [
    COTIZACION_INEXISTENTE,
  ]);
  return Number(r.rows[0].n);
}

describe('POST /api/ordenes con cotización inexistente', () => {
  it('el UUID de prueba realmente no existe en cotizaciones (precondición)', async () => {
    const r = await pool.query('SELECT 1 FROM cotizaciones WHERE id = $1', [COTIZACION_INEXISTENTE]);
    expect(r.rowCount).toBe(0);
  });

  for (const [rol, token] of [
    ['COMERCIAL', () => tokenComercial],
    ['ADMIN', () => tokenAdmin],
  ] as const) {
    it(`${rol}: responde 404 "Cotización no encontrada." y no se crea ninguna orden`, async () => {
      const crearOrden = vi.spyOn(ordenesRepo, 'create');
      const antes = await ordenesDeLaCotizacion();

      const res = await crear(token(), { cotizacion_id: COTIZACION_INEXISTENTE });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: 'Cotización no encontrada.' });
      expect(crearOrden).not.toHaveBeenCalled();
      expect(antes).toBe(0);
      expect(await ordenesDeLaCotizacion()).toBe(0);
    });
  }

  it('los permisos se evalúan antes: sin sesión 401 y OPERATIVO 403 (no 404)', async () => {
    expect((await crear(null, { cotizacion_id: COTIZACION_INEXISTENTE })).status).toBe(401);
    expect((await crear(tokenOperativo, { cotizacion_id: COTIZACION_INEXISTENTE })).status).toBe(403);
  });

  it('las validaciones de entrada se conservan: sin cotizacion_id 400 y no-UUID 400', async () => {
    expect((await crear(tokenComercial, {})).status).toBe(400);
    expect((await crear(tokenComercial, { cotizacion_id: 'no-es-uuid' })).status).toBe(400);
  });
});
