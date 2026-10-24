// "PC-2026-01 — Continuación autorizada: Frontend Secciones C/D": añade un
// endpoint mínimo nuevo, GET /api/usuarios/admins-activos, para que
// COMERCIAL pueda identificar al ADMIN verificador en «Llamada a ADMIN»
// (CONFIRMAR_TELEFONICA) — antes bloqueado porque GET /api/usuarios es
// requireRole('ADMIN') exclusivo (confirmado por auditoría previa, ver
// comentario en frontend/src/pages/GestionOrdenes.tsx). Esta prueba fija el
// comportamiento real de permisos: COMERCIAL y ADMIN acceden al endpoint
// nuevo (solo id+nombre, nunca email); OPERATIVO y una petición sin token
// siguen rechazados; el resto del router (/api/usuarios) sigue exclusivo de
// ADMIN, sin cambios.
//
// Mismo patrón que routes/codigoSolicitudSeguridad.integration.test.ts:
// servidor HTTP real y efímero montando el router ya exportado, sin tocar
// server.ts, sin supertest (no es dependencia del proyecto).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { usuariosRouter } from './usuarios.routes.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/usuarios', usuariosRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function crearUsuarioConRolYToken(rol: 'ADMIN' | 'COMERCIAL' | 'OPERATIVO', activo = true) {
  const rolRow = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = $1`, [rol]);
  const sufijo = randomUUID();
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id, activo)
     VALUES (gen_random_uuid(), $1, $2, 'placeholder-no-usado-para-login', $3, $4)
     RETURNING id`,
    [`Prueba AdminsActivos (${rol})`, `admins-activos.${rol.toLowerCase()}.${sufijo}@nextproject-test.local`, rolRow.rows[0].id, activo]
  );
  const id = inserted.rows[0].id;
  const token = jwt.sign({ sub: id, rol }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
  return { id, token };
}

describe('GET /api/usuarios/admins-activos (nextproject_test, real)', () => {
  it('COMERCIAL obtiene 200 y solo recibe id+nombre (nunca email)', async () => {
    const comercial = await crearUsuarioConRolYToken('COMERCIAL');
    const admin = await crearUsuarioConRolYToken('ADMIN');

    const response = await fetch(`${baseUrl}/api/usuarios/admins-activos`, {
      headers: { Authorization: `Bearer ${comercial.token}` },
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { admins: Record<string, unknown>[] };
    const fila = data.admins.find((a) => a.id === admin.id);
    expect(fila).toBeDefined();
    expect(Object.keys(fila!).sort()).toEqual(['id', 'nombre'].sort());
  });

  it('ADMIN también obtiene 200 (mismo endpoint, ambos roles autorizados)', async () => {
    const admin = await crearUsuarioConRolYToken('ADMIN');
    const response = await fetch(`${baseUrl}/api/usuarios/admins-activos`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    expect(response.status).toBe(200);
  });

  it('OPERATIVO recibe 403 (no autorizado para este endpoint)', async () => {
    const operativo = await crearUsuarioConRolYToken('OPERATIVO');
    const response = await fetch(`${baseUrl}/api/usuarios/admins-activos`, {
      headers: { Authorization: `Bearer ${operativo.token}` },
    });
    expect(response.status).toBe(403);
  });

  it('sin token recibe 401', async () => {
    const response = await fetch(`${baseUrl}/api/usuarios/admins-activos`);
    expect(response.status).toBe(401);
  });

  it('un ADMIN desactivado no aparece en la lista', async () => {
    const comercial = await crearUsuarioConRolYToken('COMERCIAL');
    const adminInactivo = await crearUsuarioConRolYToken('ADMIN', false);

    const response = await fetch(`${baseUrl}/api/usuarios/admins-activos`, {
      headers: { Authorization: `Bearer ${comercial.token}` },
    });
    const data = (await response.json()) as { admins: { id: string }[] };
    expect(data.admins.some((a) => a.id === adminInactivo.id)).toBe(false);
  });

  it('el resto del router (/api/usuarios) sigue exclusivo de ADMIN — COMERCIAL sigue recibiendo 403', async () => {
    const comercial = await crearUsuarioConRolYToken('COMERCIAL');
    const response = await fetch(`${baseUrl}/api/usuarios`, {
      headers: { Authorization: `Bearer ${comercial.token}` },
    });
    expect(response.status).toBe(403);
  });
});
