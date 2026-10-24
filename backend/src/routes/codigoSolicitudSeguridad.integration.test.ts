// AUDITORÍA DE SEGURIDAD — CONSULTA DE DATOS DEL CLIENTE MEDIANTE EL NÚMERO
// DE SOLICITUD (fase de pruebas, autorización explícita: "NEXTPROJECT — FASE
// 1: PRUEBAS DE SEGURIDAD SOBRE EL CÓDIGO DE SOLICITUD"). Fija mediante
// pruebas reales de integración la conclusión de la auditoría estática
// previa: el código legible `SOL-XXXXXX` nunca funciona como clave de
// búsqueda ni como credencial de acceso — el único identificador aceptado en
// rutas internas es un UUID validado por middleware, y el único acceso
// público real usa un `:token` firmado.
//
// Pruebas de integración REALES contra `nextproject_test` (mismo guard
// obligatorio que el resto de *.integration.test.ts — nunca se ejecuta
// contra `nextproject`). No se usa `supertest` (no es dependencia del
// proyecto y no se instala aquí sin autorización aparte): se levanta un
// servidor HTTP real, efímero, en un puerto aleatorio, que monta
// EXACTAMENTE los routers ya exportados por la aplicación
// (`solicitudesRouter`, `clientesRouter`, `cotizacionesRouter`), sin tocar
// `server.ts` ni ningún archivo funcional. Esto permite observar el
// comportamiento REAL de la cadena completa de middlewares (orden de
// autenticación, autorización y validación de formato) con peticiones HTTP
// genuinas (`fetch` nativo de Node, sin dependencias nuevas) — no se simula
// el dispatch de Express a mano.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { solicitudesRouter } from './solicitudes.routes.js';
import { clientesRouter } from './clientes.routes.js';
import { cotizacionesRouter } from './cotizaciones.routes.js';
import { crearSolicitud, cambiarEstadoSolicitud } from '../services/solicitudes.service.js';
import { crearCotizacion } from '../services/cotizaciones.service.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  // Mismos prefijos que server.ts (app.use('/api/solicitudes', ...) etc.),
  // pero en una app de prueba separada — nunca se importa ni se ejecuta
  // server.ts (que haría un app.listen(env.port) real y checkDatabaseConnection()).
  const app = express();
  app.use(express.json());
  app.use('/api/solicitudes', solicitudesRouter);
  app.use('/api/clientes', clientesRouter);
  app.use('/api/cotizaciones', cotizacionesRouter);

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

async function crearUsuarioConRolYToken(rol: 'ADMIN' | 'COMERCIAL' | 'OPERATIVO') {
  const rolRow = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = $1`, [rol]);
  const sufijo = randomUUID();
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), $1, $2, 'placeholder-no-usado-para-login', $3)
     RETURNING id`,
    [`Prueba Seguridad Codigo (${rol})`, `seguridad.codigo.${rol.toLowerCase()}.${sufijo}@nextproject-test.local`, rolRow.rows[0].id]
  );
  const id = inserted.rows[0].id;
  const token = jwt.sign({ sub: id, rol }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
  return { id, token };
}

function datosUnicosSolicitud(etiqueta: string) {
  const sufijo = randomUUID();
  return {
    email: `seguridad.codigo.${etiqueta}.${sufijo}@nextproject-test.local`.toLowerCase(),
    telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
    idempotencyKey: `seguridad-codigo-${etiqueta}-${sufijo}`,
  };
}

async function crearSolicitudReal(etiqueta: string) {
  const { email, telefono, idempotencyKey } = datosUnicosSolicitud(etiqueta);
  const resultado = await crearSolicitud(
    {
      nombre: `Prueba Seguridad Codigo ${etiqueta}`,
      empresa: null,
      email,
      telefono,
      servicio: `Servicio Seguridad Codigo ${etiqueta}`,
      descripcion: `Registro ficticio de integración (Auditoría SOL-XXXXXX, caso ${etiqueta}).`,
      cantidad: 1,
    },
    idempotencyKey
  );
  // `codigo` lo asigna un trigger de PostgreSQL en el INSERT (V10) — el tipo
  // del repositorio lo declara `string | null` porque la columna lo permite
  // a nivel de esquema, pero toda solicitud creada por este flujo real
  // siempre lo recibe. Se verifica aquí en vez de forzar el tipo a ciegas.
  if (!resultado.solicitud.codigo) {
    throw new Error('crearSolicitudReal: la solicitud se creó sin código (trigger no aplicado) — inesperado.');
  }
  return resultado.solicitud as typeof resultado.solicitud & { codigo: string };
}

describe('Auditoría SOL-XXXXXX — el código de solicitud nunca funciona como clave de búsqueda ni credencial (nextproject_test, real)', () => {
  describe('Riesgo 1 — GET /api/solicitudes/<codigo real> no revela datos de la solicitud', () => {
    it('sin autenticación: el código real (SOL-XXXXXX) es rechazado, nunca devuelve la solicitud', async () => {
      const solicitud = await crearSolicitudReal('R1-anon');

      const res = await fetch(`${baseUrl}/api/solicitudes/${solicitud.codigo}`);
      const cuerpo = await res.json();

      expect(res.status).toBe(404);
      expect(JSON.stringify(cuerpo)).not.toContain(solicitud.servicio);
      expect(cuerpo).not.toHaveProperty('solicitud');
    });

    it('autenticado con un rol interno válido (ADMIN): el código real sigue sin devolver la solicitud', async () => {
      const solicitud = await crearSolicitudReal('R1-admin');
      const { token } = await crearUsuarioConRolYToken('ADMIN');

      const res = await fetch(`${baseUrl}/api/solicitudes/${solicitud.codigo}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cuerpo = await res.json();

      // Resultado real observado: el guard de formato UUID
      // (`solicitudesRouter.param('id', ...)`) corre ANTES que
      // requireAuth/requireRole para esta ruta (están registrados como
      // middlewares de la propia Route, no con `.use()` a nivel de router —
      // ver solicitudes.routes.ts). Por eso el código se rechaza igual con
      // 404, sin llegar siquiera a evaluar el token. Se documenta el 401/403
      // como comportamiento NO observado para este caso, para no forzar un
      // código que la cadena real de middlewares no produce.
      expect(res.status).toBe(404);
      expect(JSON.stringify(cuerpo)).not.toContain(solicitud.servicio);
    });
  });

  describe('Riesgo 2 — una ruta protegida con un :id que no es UUID se rechaza según el orden real de middlewares', () => {
    const idNoUuid = 'SOL-000583';

    it('solicitudes: el guard de formato (router.param) corre antes que requireAuth — 404 sin token', async () => {
      const res = await fetch(`${baseUrl}/api/solicitudes/${idNoUuid}`);
      expect(res.status).toBe(404);
    });

    it('solicitudes: el guard de formato corre antes que requireRole — 404 también con rol sin permiso para ese recurso', async () => {
      const { token } = await crearUsuarioConRolYToken('OPERATIVO');
      const res = await fetch(`${baseUrl}/api/solicitudes/${idNoUuid}/estado`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'EN_REVISION' }),
      });
      // router.param('id', ...) se dispara también para "/:id/estado". Con
      // OPERATIVO (rol no permitido en esta ruta) el resultado observado es
      // igualmente 404: el guard de UUID corre antes que requireRole, igual
      // que en el caso anterior.
      expect(res.status).toBe(404);
    });

    it('cotizaciones: requireAuth/requireRole corren ANTES que el guard de formato — 401 sin token (orden inverso al de solicitudes)', async () => {
      const res = await fetch(`${baseUrl}/api/cotizaciones/${idNoUuid}`);
      // Aquí requireAuth/requireRole están montados con
      // `cotizacionesRouter.use(...)`, ANTES de `.param('id', ...)` — un
      // layer de router.use() se evalúa antes que el process_params del
      // layer de la ruta /:id. Resultado real observado: 401, no 404 —
      // confirma que el orden efectivo de middlewares no es el mismo en
      // ambos routers, y que en ninguno de los dos un id no-UUID llega a
      // filtrar datos.
      expect(res.status).toBe(401);
    });

    it('cotizaciones: con token válido pero rol no permitido, 403 antes de llegar al guard de formato', async () => {
      const { token } = await crearUsuarioConRolYToken('OPERATIVO');
      const res = await fetch(`${baseUrl}/api/cotizaciones/${idNoUuid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(403);
    });

    it('cotizaciones: con rol permitido (ADMIN), el id no-UUID se rechaza por 404 una vez pasada la autenticación/autorización', async () => {
      const { token } = await crearUsuarioConRolYToken('ADMIN');
      const res = await fetch(`${baseUrl}/api/cotizaciones/${idNoUuid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('Riesgo 3 — un usuario autenticado sin el rol requerido no obtiene datos privados', () => {
    it('OPERATIVO no puede listar clientes (GET /api/clientes) — 403, nunca el listado', async () => {
      const { token } = await crearUsuarioConRolYToken('OPERATIVO');
      const res = await fetch(`${baseUrl}/api/clientes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cuerpo = await res.json();

      expect(res.status).toBe(403);
      expect(cuerpo).not.toHaveProperty('clientes');
    });

    it('OPERATIVO no puede cambiar el estado de una solicitud (PATCH /:id/estado) — 403 con un UUID real y válido', async () => {
      const solicitud = await crearSolicitudReal('R3-operativo-estado');
      const { token } = await crearUsuarioConRolYToken('OPERATIVO');
      const res = await fetch(`${baseUrl}/api/solicitudes/${solicitud.id}/estado`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'EN_REVISION' }),
      });
      expect(res.status).toBe(403);
    });

    it('sin ningún token, ninguna de las tres rutas protegidas devuelve datos (401 uniforme)', async () => {
      const [resClientes, resSolicitudes, resCotizaciones] = await Promise.all([
        fetch(`${baseUrl}/api/clientes`),
        fetch(`${baseUrl}/api/solicitudes`),
        fetch(`${baseUrl}/api/cotizaciones`),
      ]);
      expect(resClientes.status).toBe(401);
      expect(resSolicitudes.status).toBe(401);
      expect(resCotizaciones.status).toBe(401);
    });
  });

  describe('Riesgo 4 — el código SOL-XXXXXX no funciona como mecanismo alternativo de autorización en clientes/solicitudes/cotizaciones', () => {
    it('un ADMIN autenticado no puede usar el código de la solicitud para llegar a una cotización asociada', async () => {
      const solicitud = await crearSolicitudReal('R4-cotizacion');
      await cambiarEstadoSolicitud(solicitud.id, 'EN_REVISION');
      const { id: creadoPorId, token } = await crearUsuarioConRolYToken('COMERCIAL');
      await crearCotizacion({
        solicitudId: solicitud.id,
        valor: 100,
        descripcion: null,
        creadoPor: creadoPorId,
        anticipoPorcentaje: 0,
      });

      // Intento de usar el código de la SOLICITUD (nunca el id real de la
      // cotización) como si fuera un identificador válido de cotización.
      const res = await fetch(`${baseUrl}/api/cotizaciones/${solicitud.codigo}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    });

    it('pasar el código como query string (?codigo=) a un listado autenticado no actúa como filtro ni como atajo de autorización', async () => {
      const solicitud = await crearSolicitudReal('R4-query');
      const { token } = await crearUsuarioConRolYToken('ADMIN');

      const res = await fetch(`${baseUrl}/api/solicitudes?codigo=${encodeURIComponent(solicitud.codigo)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cuerpo = (await res.json()) as { solicitudes?: unknown[] };

      // El controller real (listarController) ignora cualquier query string:
      // devuelve siempre la lista completa, nunca una fila "seleccionada por
      // código" — el parámetro no tiene ningún efecto, ni de filtro ni de
      // autorización alternativa.
      expect(res.status).toBe(200);
      expect(Array.isArray(cuerpo.solicitudes)).toBe(true);
      expect(cuerpo.solicitudes!.some((s) => (s as { id: string }).id === solicitud.id)).toBe(true);
    });
  });
});
