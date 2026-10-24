// PC-2026-01: una cotización inexistente en las rutas de pagos debe responder 404, no 500.
// Causa: `transferenciasPago.service` lanzaba su PROPIA clase `CotizacionNoEncontradaError`
// (distinta de la de `cotizaciones.service`, la única que el controlador reconocía), así que
// el error llegaba como "inesperado" y terminaba en 500.
// Esta prueba cubre cada ruta de pagos afectada, que lo demás conserva su código HTTP
// (400, 401, 403, 409) y que un error inesperado sigue siendo 500 sin exponer detalles.
// Pruebas de integración reales contra `nextproject_test` (mismo guard que el resto).
// Limpieza por IDs (RegistroLimpieza) de las transferencias que crea este archivo; los
// usuarios, solicitudes, clientes y cotizaciones ficticios quedan (como en el resto de
// pruebas de pagos).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { RegistroLimpieza } from '../config/testCleanup.js';
import { cotizacionesRouter } from './cotizaciones.routes.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from '../services/solicitudes.service.js';
import { crearCotizacion, cambiarEstadoCotizacion } from '../services/cotizaciones.service.js';

let server: http.Server;
let baseUrl: string;
let adminId: string;
let comercialId: string;
let tokenAdmin: string;
let tokenComercial: string;
let tokenOperativo: string;
let restaurarFetch: () => void;

const registro = new RegistroLimpieza();
const cotizacionesCreadas: string[] = [];

function firmar(sub: string, rol: string): string {
  return jwt.sign({ sub, rol }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

async function crearUsuario(rolNombre: string, etiqueta: string): Promise<string> {
  const rol = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [rolNombre]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
    [`Prueba cotizacion inexistente (${etiqueta})`, `cot-inexistente.${etiqueta}.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  return u.rows[0].id;
}

// Cotización ficticia con anticipo por TRANSFERENCIA, aceptada con la función existente del
// repositorio (no crea órdenes). `aceptada=false` la deja ENVIADA.
async function crearCotizacionFicticia(aceptada: boolean): Promise<string> {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba cotizacion inexistente',
      empresa: null,
      email: `cot-inexistente.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio ficticio cotizacion inexistente',
      descripcion: 'Registro ficticio de integración (cotización inexistente en pagos).',
      cantidad: 1,
    },
    `cot-inexistente-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  const c = await crearCotizacion({
    solicitudId: s.solicitud.id,
    valor: 1000,
    descripcion: null,
    creadoPor: comercialId,
    anticipoPorcentaje: 50,
    metodoAnticipo: 'TRANSFERENCIA',
  });
  await cambiarEstadoCotizacion(c.id, 'ENVIADA');
  if (aceptada) await cotizacionesRepo.marcarAceptada(c.id);
  cotizacionesCreadas.push(c.id);
  return c.id;
}

beforeAll(async () => {
  // Llamadas de red que no sean al servidor local (correo, IA…): respuesta vacía.
  const original = globalThis.fetch;
  const espia = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(input).startsWith('http://127.0.0.1') ? original(input, init) : Promise.resolve(new Response('{}', { status: 200 }))
  );
  restaurarFetch = () => espia.mockRestore();

  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  adminId = await crearUsuario('ADMIN', 'admin');
  comercialId = await crearUsuario('COMERCIAL', 'comercial');
  const operativoId = await crearUsuario('OPERATIVO', 'operativo');
  tokenAdmin = firmar(adminId, 'ADMIN');
  tokenComercial = firmar(comercialId, 'COMERCIAL');
  tokenOperativo = firmar(operativoId, 'OPERATIVO');

  const app = express();
  app.use(express.json());
  app.use('/api/cotizaciones', cotizacionesRouter);
  // Equivalente al manejador final de server.ts para errores no controlados (mismo
  // contrato: 500 con mensaje genérico, sin detalles internos). server.ts no se puede
  // importar sin abrir el puerto, por eso se reproduce aquí.
  const manejadorFinal: ErrorRequestHandler = (_err, _req, res, _next) => {
    res.status(500).json({ message: 'Error interno del servidor.' });
  };
  app.use(manejadorFinal);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    restaurarFetch();
    if (cotizacionesCreadas.length > 0) {
      const t = await pool.query<{ id: string }>(
        'SELECT id FROM transferencias_pago WHERE cotizacion_id = ANY($1::uuid[])',
        [cotizacionesCreadas]
      );
      for (const fila of t.rows) registro.registrarTransferencia(fila.id);
    }
    await registro.limpiar(pool);
  }
});

function pedir(ruta: string, token: string | null, init: { method?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}/api/cotizaciones${ruta}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

type RutaPago = { nombre: string; ruta: (id: string) => string; metodo: string; cuerpo?: () => unknown; token: () => string };

// Todas las rutas que pasan por transferenciasPago.service (historial y las cuatro acciones de
// anticipo y de saldo). El anticipo y el saldo comparten la misma lógica de pagos.
const accionesPago = (tramo: 'anticipo' | 'saldo'): RutaPago[] => [
  {
    nombre: `${tramo} GESTIONAR`,
    ruta: (id) => `/${id}/${tramo}`,
    metodo: 'PATCH',
    cuerpo: () => ({ accion: 'GESTIONAR', importeDeclarado: 5, metodo: 'TRANSFERENCIA' }),
    token: () => tokenComercial,
  },
  {
    nombre: `${tramo} RECHAZAR`,
    ruta: (id) => `/${id}/${tramo}`,
    metodo: 'PATCH',
    cuerpo: () => ({ accion: 'RECHAZAR', motivoRechazo: 'COMPROBANTE_INCORRECTO' }),
    token: () => tokenComercial,
  },
  {
    nombre: `${tramo} VALIDAR`,
    ruta: (id) => `/${id}/${tramo}`,
    metodo: 'PATCH',
    cuerpo: () => ({ accion: 'VALIDAR', metodo: 'TRANSFERENCIA' }),
    token: () => tokenAdmin,
  },
  {
    nombre: `${tramo} CONFIRMAR_TELEFONICA`,
    ruta: (id) => `/${id}/${tramo}`,
    metodo: 'PATCH',
    cuerpo: () => ({ accion: 'CONFIRMAR_TELEFONICA', verificadorId: adminId, metodo: 'TRANSFERENCIA' }),
    token: () => tokenComercial,
  },
];

const RUTAS_PAGOS: RutaPago[] = [
  { nombre: 'historial GET /:id/transferencias', ruta: (id) => `/${id}/transferencias`, metodo: 'GET', token: () => tokenComercial },
  ...accionesPago('anticipo'),
  ...accionesPago('saldo'),
];

describe('Cotización inexistente en rutas de pagos: 404 con mensaje claro y consistente', () => {
  for (const r of RUTAS_PAGOS) {
    it(`${r.nombre}: cotización inexistente -> 404 "Cotización no encontrada."`, async () => {
      const res = await pedir(r.ruta(randomUUID()), r.token(), { method: r.metodo, body: r.cuerpo?.() });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { message: string }).message).toBe('Cotización no encontrada.');
    });
  }

  it('el mismo mensaje y código en las rutas que ya respondían 404 (reabrir saldo y descarga de comprobante)', async () => {
    const id = randomUUID();
    const reabrir = await pedir(`/${id}/saldo/reabrir`, tokenComercial, { method: 'PATCH', body: {} });
    expect(reabrir.status).toBe(404);
    expect(((await reabrir.json()) as { message: string }).message).toBe('Cotización no encontrada.');
    const comprobante = await pedir(`/${id}/comprobante`, tokenComercial);
    expect(comprobante.status).toBe(404);
  });

  it('un id que no tiene formato UUID sigue respondiendo 404 (guard de formato del router)', async () => {
    expect((await pedir('/no-es-uuid/transferencias', tokenComercial)).status).toBe(404);
    expect((await pedir('/no-es-uuid/anticipo', tokenComercial, { method: 'PATCH', body: { accion: 'GESTIONAR', importeDeclarado: 5 } })).status).toBe(404);
  });
});

describe('Los demás códigos HTTP se conservan', () => {
  it('cotización existente: el flujo normal sigue funcionando (gestionar 200 y historial 200)', async () => {
    const id = await crearCotizacionFicticia(true);
    const g = await pedir(`/${id}/anticipo`, tokenComercial, {
      method: 'PATCH',
      body: { accion: 'GESTIONAR', importeDeclarado: 500, bancoOrigen: 'Banco A' },
    });
    expect(g.status).toBe(200);
    const h = await pedir(`/${id}/transferencias`, tokenComercial);
    expect(h.status).toBe(200);
    expect(((await h.json()) as { transferencias: unknown[] }).transferencias).toHaveLength(1);
  });

  it('400 en solicitudes inválidas (importe, acción, cuenta con formato inválido, falta de motivo)', async () => {
    const id = await crearCotizacionFicticia(true);
    const g = (cuerpo: Record<string, unknown>) =>
      pedir(`/${id}/anticipo`, tokenComercial, { method: 'PATCH', body: { accion: 'GESTIONAR', ...cuerpo } });
    expect((await g({ importeDeclarado: 0 })).status).toBe(400);
    expect((await g({ importeDeclarado: 5, cuentaBancariaId: 'no-es-un-uuid' })).status).toBe(400);
    expect((await pedir(`/${id}/anticipo`, tokenComercial, { method: 'PATCH', body: { accion: 'INVENTADA' } })).status).toBe(400);
    expect((await pedir(`/${id}/anticipo`, tokenComercial, { method: 'PATCH', body: { accion: 'RECHAZAR' } })).status).toBe(400);
  });

  it('401 sin sesión y 403 por permisos insuficientes (OPERATIVO, ADMIN al rechazar, COMERCIAL al confirmar)', async () => {
    const id = await crearCotizacionFicticia(true);
    const cuerpo = { accion: 'GESTIONAR', importeDeclarado: 5 };
    expect((await pedir(`/${id}/anticipo`, null, { method: 'PATCH', body: cuerpo })).status).toBe(401);
    expect((await pedir(`/${id}/anticipo`, tokenOperativo, { method: 'PATCH', body: cuerpo })).status).toBe(403);
    expect((await pedir(`/${id}/transferencias`, tokenOperativo)).status).toBe(403);
    const rechazoAdmin = await pedir(`/${id}/anticipo`, tokenAdmin, {
      method: 'PATCH',
      body: { accion: 'RECHAZAR', motivoRechazo: 'COMPROBANTE_INCORRECTO' },
    });
    expect(rechazoAdmin.status).toBe(403);
    const validarComercial = await pedir(`/${id}/anticipo`, tokenComercial, { method: 'PATCH', body: { accion: 'VALIDAR' } });
    expect(validarComercial.status).toBe(403);
    // aunque la cotización no exista, el permiso se evalúa primero (403, no 404)
    const sinPermisoEInexistente = await pedir(`/${randomUUID()}/anticipo`, tokenOperativo, { method: 'PATCH', body: cuerpo });
    expect(sinPermisoEInexistente.status).toBe(403);
  });

  it('409 en conflictos reales: gestionar una cotización no aceptada y confirmar dos veces', async () => {
    const noAceptada = await crearCotizacionFicticia(false);
    const g = await pedir(`/${noAceptada}/anticipo`, tokenComercial, {
      method: 'PATCH',
      body: { accion: 'GESTIONAR', importeDeclarado: 5 },
    });
    expect(g.status).toBe(409);

    const aceptada = await crearCotizacionFicticia(true);
    await pedir(`/${aceptada}/anticipo`, tokenComercial, { method: 'PATCH', body: { accion: 'GESTIONAR', importeDeclarado: 5 } });
    expect((await pedir(`/${aceptada}/anticipo`, tokenAdmin, { method: 'PATCH', body: { accion: 'VALIDAR' } })).status).toBe(200);
    expect((await pedir(`/${aceptada}/anticipo`, tokenAdmin, { method: 'PATCH', body: { accion: 'VALIDAR' } })).status).toBe(409);
  });

  it('un error inesperado sigue siendo 500 (no se convierte en 404/409/400) y no expone detalles internos', async () => {
    const id = await crearCotizacionFicticia(true);
    vi.spyOn(cotizacionesRepo, 'lockParaTransferencia').mockRejectedValue(new Error('DETALLE INTERNO SECRETO: fallo de base'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await pedir(`/${id}/anticipo`, tokenComercial, {
      method: 'PATCH',
      body: { accion: 'GESTIONAR', importeDeclarado: 5 },
    });
    expect(res.status).toBe(500);
    const texto = await res.text();
    expect(texto).not.toContain('SECRETO');
    expect(texto).not.toContain('fallo de base');
    expect(JSON.parse(texto)).toEqual({ message: 'Error interno del servidor.' });
  });
});
