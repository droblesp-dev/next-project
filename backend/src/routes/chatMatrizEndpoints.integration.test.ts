// #7/#8 (nextproject_test, real): matriz de permisos de TODOS los endpoints del chat por rol (y sin sesión), más los casos
// de acceso a recursos ajenos. La privacidad no depende del frontend: cada celda es una petición HTTP real.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { solicitudesRouter } from './solicitudes.routes.js';
import { usuariosRouter } from './usuarios.routes.js';
import { ordenesRouter } from './ordenes.routes.js';
import { crearSolicitud, cambiarEstadoSolicitud } from '../services/solicitudes.service.js';
import { crearCotizacion } from '../services/cotizaciones.service.js';
import { reiniciarCacheEsquemaChat } from '../repositories/chatEsquema.js';

type Clave = 'ADMIN' | 'COM' | 'COM_OTRO' | 'OPE' | 'OPE_OTRO';
const ROL: Record<Clave, string> = { ADMIN: 'ADMIN', COM: 'COMERCIAL', COM_OTRO: 'COMERCIAL', OPE: 'OPERATIVO', OPE_OTRO: 'OPERATIVO' };
const ids = {} as Record<Clave, string>;
const tokens = {} as Record<Clave, string>;
let server: http.Server;
let baseUrl: string;
const modoOriginal = env.chat.participantesModo;
const desdeOriginal = env.chat.pendientesDesde;

beforeAll(async () => {
  env.chat.participantesModo = 'SOMBRA';
  env.chat.pendientesDesde = new Date('2020-01-01T00:00:00Z'); // contadores activos para ejercitar la validación del marcado
  await pool.query(
    `INSERT INTO roles (id, nombre) VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  for (const clave of Object.keys(ROL) as Clave[]) {
    const r = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [ROL[clave]]);
    const u = await pool.query<{ id: string }>(
      `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id) VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
      [`Prueba matriz ${clave}`, `matriz.${clave.toLowerCase()}.${randomUUID()}@nextproject-test.local`, r.rows[0].id]
    );
    ids[clave] = u.rows[0].id;
    tokens[clave] = jwt.sign({ sub: ids[clave], rol: ROL[clave] }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
  }
  reiniciarCacheEsquemaChat();
  const app = express();
  app.use(express.json());
  app.use('/api/solicitudes', solicitudesRouter);
  app.use('/api/usuarios', usuariosRouter);
  app.use('/api/ordenes', ordenesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  env.chat.participantesModo = modoOriginal;
  env.chat.pendientesDesde = desdeOriginal;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function solicitudNueva(): Promise<string> {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba matriz chat',
      empresa: null,
      email: `matriz.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio matriz chat',
      descripcion: 'Registro ficticio de integracion (matriz de endpoints del chat).',
      cantidad: 1,
    },
    `matriz-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  return s.solicitud.id;
}

async function llamar(clave: Clave | null, metodo: string, ruta: string, cuerpo?: unknown): Promise<number> {
  const res = await fetch(`${baseUrl}${ruta}`, {
    method: metodo,
    headers: { ...(clave ? { Authorization: `Bearer ${tokens[clave]}` } : {}), 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return res.status;
}

describe('matriz de permisos del chat por rol', () => {
  // [descripción, método, ruta (con :s = solicitud), cuerpo, esperado por rol: sin sesión / ADMIN / COMERCIAL / OPERATIVO]
  const matriz: Array<[string, string, string, unknown, [number, number, number, number]]> = [
    ['leer mensajes', 'GET', '/api/solicitudes/:s/mensajes', undefined, [401, 403, 200, 200]],
    ['enviar mensaje', 'POST', '/api/solicitudes/:s/mensajes', { contenido: 'hola desde la matriz' }, [401, 403, 201, 201]],
    ['pendientes', 'GET', '/api/solicitudes/mensajes/pendientes', undefined, [401, 403, 200, 200]],
    ['marcar leído (mensaje inexistente)', 'POST', '/api/solicitudes/:s/mensajes/leidos', { hasta_id: '00000000-0000-4000-8000-000000000000' }, [401, 403, 400, 400]],
    ['ver participantes', 'GET', '/api/solicitudes/:s/participantes', undefined, [401, 403, 200, 200]],
    ['incorporar participante (sin ser participante)', 'POST', '/api/solicitudes/:s/participantes', { usuario_id: '00000000-0000-4000-8000-000000000000' }, [401, 403, 403, 403]],
    ['retirar participante (sin ser participante)', 'DELETE', '/api/solicitudes/:s/participantes/00000000-0000-4000-8000-000000000000', undefined, [401, 403, 403, 403]],
    ['listado de operativos activos', 'GET', '/api/usuarios/operativos-activos', undefined, [401, 403, 200, 403]],
  ];

  for (const [descripcion, metodo, ruta, cuerpo, esperado] of matriz) {
    it(`${descripcion}: ${metodo} ${ruta}`, async () => {
      const sol = await solicitudNueva();
      const url = ruta.replace(':s', sol);
      const obtenidos = [
        await llamar(null, metodo, url, cuerpo),
        await llamar('ADMIN', metodo, url, cuerpo),
        await llamar('COM', metodo, url, cuerpo),
        await llamar('OPE', metodo, url, cuerpo),
      ];
      expect(obtenidos, `[sin sesión, ADMIN, COMERCIAL, OPERATIVO] ${metodo} ${url}`).toEqual(esperado);
    });
  }

  it('reclamar un hilo: solo COMERCIAL puede (ADMIN y OPERATIVO reciben 403; sin sesión 401)', async () => {
    const sol = await solicitudNueva();
    const url = `/api/solicitudes/${sol}/participantes/reclamar`;
    expect(await llamar(null, 'POST', url)).toBe(401);
    expect(await llamar('ADMIN', 'POST', url)).toBe(403);
    expect(await llamar('OPE', 'POST', url)).toBe(403);
    expect(await llamar('COM', 'POST', url)).toBe(201);
  });
});

describe('acceso a recursos ajenos', () => {
  async function ordenConFicha(responsable: Clave): Promise<{ solicitud: string; orden: string }> {
    const solicitud = await solicitudNueva();
    const cot = await crearCotizacion({ solicitudId: solicitud, valor: 100, descripcion: null, creadoPor: ids.COM, anticipoPorcentaje: 0 });
    await pool.query(`UPDATE cotizaciones SET estado = 'ACEPTADA' WHERE id = $1`, [cot.id]);
    const o = await pool.query<{ id: string }>(
      `INSERT INTO ordenes (id, cotizacion_id, responsable_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [cot.id, ids[responsable]]
    );
    await pool.query(`INSERT INTO fichas_tecnicas (id, orden_id, contenido) VALUES (gen_random_uuid(), $1, 'FICHA TÉCNICA ficticia de la matriz')`, [o.rows[0].id]);
    return { solicitud, orden: o.rows[0].id };
  }

  it('un OPERATIVO que no es el responsable no accede al chat de la orden ni lo marca; COMERCIAL sí accede', async () => {
    const { solicitud } = await ordenConFicha('OPE');
    expect(await llamar('OPE', 'GET', `/api/solicitudes/${solicitud}/mensajes`)).toBe(200);
    expect(await llamar('OPE_OTRO', 'GET', `/api/solicitudes/${solicitud}/mensajes`)).toBe(403);
    expect(await llamar('OPE_OTRO', 'POST', `/api/solicitudes/${solicitud}/mensajes`, { contenido: 'intruso' })).toBe(403);
    expect(await llamar('OPE_OTRO', 'POST', `/api/solicitudes/${solicitud}/mensajes/leidos`, { hasta_id: randomUUID() })).toBe(403);
    expect(await llamar('OPE_OTRO', 'GET', `/api/solicitudes/${solicitud}/participantes`)).toBe(403);
    expect(await llamar('COM_OTRO', 'GET', `/api/solicitudes/${solicitud}/mensajes`)).toBe(200);
  });

  it('la ficha técnica: ADMIN y COMERCIAL la leen, el OPERATIVO responsable la lee y otro OPERATIVO no', async () => {
    const { orden } = await ordenConFicha('OPE');
    const ruta = `/api/ordenes/${orden}/ficha-tecnica`;
    expect(await llamar(null, 'GET', ruta)).toBe(401);
    expect(await llamar('ADMIN', 'GET', ruta)).toBe(200);
    expect(await llamar('COM', 'GET', ruta)).toBe(200);
    expect(await llamar('OPE', 'GET', ruta)).toBe(200);
    expect(await llamar('OPE_OTRO', 'GET', ruta)).toBe(403);
  });

  it('el id de una solicitud inválido o inexistente responde 404 sin revelar nada', async () => {
    expect(await llamar('COM', 'GET', '/api/solicitudes/no-es-uuid/mensajes')).toBe(404);
    expect(await llamar('COM', 'GET', `/api/solicitudes/${randomUUID()}/mensajes`)).toBe(404);
    expect(await llamar('COM', 'POST', `/api/solicitudes/${randomUUID()}/mensajes/leidos`, { hasta_id: randomUUID() })).toBe(404);
  });
});
