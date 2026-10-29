// PC-2026-01: el banco de origen de un pago ya NO se bloquea cuando difiere del de un
// pago anterior (se retiró la autorización de excepción). Lo que se comprueba:
//   - Un pago con banco de origen distinto se registra (200) sin 409.
//   - Cada intento conserva su banco de origen, su cuenta receptora y la copia (snapshot).
//   - Siguen vigentes las validaciones (importe, campos, cuenta inválida), el único
//     intento vigente, los conflictos 409 reales y los permisos de COMERCIAL/ADMIN.
//   - Registrar un pago NO confirma la acreditación: eso lo sigue confirmando ADMIN.
//   - Los endpoints de excepción ya no existen.
// Pruebas de integración reales contra `nextproject_test` (mismo guard que el resto).
// Limpieza por IDs (RegistroLimpieza): transferencias, cuentas y entidades que crea este
// archivo. Usuarios, solicitudes, clientes y cotizaciones ficticios quedan (como en el
// resto de pruebas de pagos).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import { simularComprobanteDelCliente } from '../config/testFixturesPagos.js';
import { env } from '../config/env.js';
import { RegistroLimpieza } from '../config/testCleanup.js';
import { cotizacionesRouter } from './cotizaciones.routes.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from '../services/solicitudes.service.js';
import { crearCotizacion, cambiarEstadoCotizacion } from '../services/cotizaciones.service.js';
import { crearCuentaBancaria, editarCuentaBancaria } from '../services/cuentasBancarias.service.js';

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

type Transferencia = {
  id: string;
  tipo_pago: string;
  estado: string;
  vigente: boolean;
  banco_origen: string | null;
  cuenta_bancaria_id: string | null;
  banco_cuenta_snapshot: string | null;
  titular_cuenta_snapshot: string | null;
  numero_cuenta_snapshot: string | null;
};

function firmar(sub: string, rol: string): string {
  return jwt.sign({ sub, rol }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

async function crearUsuario(rolNombre: string, etiqueta: string): Promise<string> {
  const rol = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [rolNombre]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
    [`Prueba banco origen libre (${etiqueta})`, `banco-libre.${etiqueta}.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  return u.rows[0].id;
}

// Cotización ficticia con anticipo por TRANSFERENCIA. `aceptada=false` la deja ENVIADA.
// Se acepta con la función existente del repositorio (no crea órdenes ni llama a servicios
// externos).
async function crearCotizacionFicticia(aceptada = true): Promise<string> {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba banco origen libre',
      empresa: null,
      email: `banco-libre.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio ficticio banco origen libre',
      descripcion: 'Registro ficticio de integración (banco de origen libre).',
      cantidad: 1,
    },
    `banco-libre-${sufijo}`
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

async function crearCuenta(etiqueta: string, titular: string, numero: string) {
  const { cuenta } = await crearCuentaBancaria(
    {
      bancoPersonalizadoNombre: `Banco Receptor ${etiqueta} ${randomUUID().slice(0, 8)}`,
      titular,
      tipoCuenta: 'AHORROS',
      numeroCuenta: numero,
    },
    adminId
  );
  registro.registrarCuenta(cuenta.id);
  const e = await pool.query<{ creado_por: string }>('SELECT creado_por FROM bancos_catalogo WHERE id = $1', [
    cuenta.banco_catalogo_id,
  ]);
  if (e.rows[0]?.creado_por === adminId) registro.registrarEntidad(cuenta.banco_catalogo_id);
  return cuenta;
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
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

const gestionar = (id: string, token: string, cuerpo: Record<string, unknown>) =>
  pedir(`/${id}/anticipo`, token, { method: 'PATCH', body: { accion: 'GESTIONAR', importeDeclarado: 500, ...cuerpo } });

async function historial(id: string): Promise<Transferencia[]> {
  const res = await pedir(`/${id}/transferencias`, tokenComercial);
  expect(res.status).toBe(200);
  return ((await res.json()) as { transferencias: Transferencia[] }).transferencias;
}

async function estadoAnticipo(id: string): Promise<string | null> {
  const r = await pool.query<{ estado_anticipo: string | null }>('SELECT estado_anticipo FROM cotizaciones WHERE id = $1', [id]);
  return r.rows[0].estado_anticipo;
}

describe('Pago con banco de origen distinto: sin bloqueo y con trazabilidad', () => {
  it('COMERCIAL registra pagos con bancos de origen distintos sin 409; cada intento conserva su banco y solo el último es vigente', async () => {
    const id = await crearCotizacionFicticia();

    const a = await gestionar(id, tokenComercial, { bancoOrigen: 'Banco A', referenciaBancaria: 'REF-A' });
    const b = await gestionar(id, tokenComercial, { bancoOrigen: 'Banco B', referenciaBancaria: 'REF-B' });
    const c = await gestionar(id, tokenComercial, { bancoOrigen: 'Banco C' });
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);

    const filas = await historial(id);
    expect(filas.map((t) => t.banco_origen).sort()).toEqual(['Banco A', 'Banco B', 'Banco C']);
    expect(filas.filter((t) => t.vigente)).toHaveLength(1);
    expect(filas.find((t) => t.vigente)?.banco_origen).toBe('Banco C');
    // registrar un pago NO lo acredita: el anticipo sigue PENDIENTE
    expect(await estadoAnticipo(id)).toBe('PENDIENTE');
  });

  it('cada intento conserva su cuenta receptora y su copia (snapshot), también tras cambiar de banco de origen', async () => {
    const id = await crearCotizacionFicticia();
    const cuentaX = await crearCuenta('X', 'Titular X', '1000001');
    const cuentaY = await crearCuenta('Y', 'Titular Y', '2000002');

    const r1 = await gestionar(id, tokenComercial, { bancoOrigen: 'Banco A', cuentaBancariaId: cuentaX.id });
    const r2 = await gestionar(id, tokenComercial, { bancoOrigen: 'Banco B', cuentaBancariaId: cuentaY.id });
    expect([r1.status, r2.status]).toEqual([200, 200]);

    // la cuenta X cambia después: el historial no cambia
    await editarCuentaBancaria(
      cuentaX.id,
      { bancoCatalogoId: cuentaX.banco_catalogo_id!, titular: 'Titular X MODIFICADO', tipoCuenta: 'CORRIENTE', numeroCuenta: '9999999' },
      adminId
    );

    const filas = await historial(id);
    const intentoA = filas.find((t) => t.banco_origen === 'Banco A');
    const intentoB = filas.find((t) => t.banco_origen === 'Banco B');
    expect(intentoA).toMatchObject({
      cuenta_bancaria_id: cuentaX.id,
      banco_cuenta_snapshot: cuentaX.banco,
      titular_cuenta_snapshot: 'Titular X',
      numero_cuenta_snapshot: '1000001',
    });
    expect(intentoB).toMatchObject({
      cuenta_bancaria_id: cuentaY.id,
      banco_cuenta_snapshot: cuentaY.banco,
      titular_cuenta_snapshot: 'Titular Y',
      numero_cuenta_snapshot: '2000002',
    });
  });
});

describe('Validaciones que siguen vigentes', () => {
  it('importe inválido (cero, negativo, no numérico o ausente) responde 400 y no crea intentos', async () => {
    const id = await crearCotizacionFicticia();
    for (const importeDeclarado of [0, -5, 'abc', null]) {
      const res = await gestionar(id, tokenComercial, { importeDeclarado, bancoOrigen: 'Banco A' });
      expect(res.status).toBe(400);
    }
    const sinImporte = await pedir(`/${id}/anticipo`, tokenComercial, { method: 'PATCH', body: { accion: 'GESTIONAR' } });
    expect(sinImporte.status).toBe(400);
    expect((await historial(id)).length).toBe(0);
  });

  it('acción ausente o desconocida responde 400; cuenta inexistente o con formato inválido responde 400', async () => {
    const id = await crearCotizacionFicticia();
    expect((await pedir(`/${id}/anticipo`, tokenComercial, { method: 'PATCH', body: { importeDeclarado: 5 } })).status).toBe(400);
    expect((await pedir(`/${id}/anticipo`, tokenComercial, { method: 'PATCH', body: { accion: 'INVENTADA' } })).status).toBe(400);
    expect((await gestionar(id, tokenComercial, { cuentaBancariaId: randomUUID() })).status).toBe(400);
    expect((await gestionar(id, tokenComercial, { cuentaBancariaId: 'no-es-un-uuid' })).status).toBe(400);
    expect((await historial(id)).length).toBe(0);
  });

  it('un rechazo exige motivo y el motivo OTRO exige detalle (400)', async () => {
    const id = await crearCotizacionFicticia();
    await gestionar(id, tokenComercial, { bancoOrigen: 'Banco A' });
    const sinMotivo = await pedir(`/${id}/anticipo`, tokenComercial, { method: 'PATCH', body: { accion: 'RECHAZAR' } });
    expect(sinMotivo.status).toBe(400);
    const otroSinDetalle = await pedir(`/${id}/anticipo`, tokenComercial, {
      method: 'PATCH',
      body: { accion: 'RECHAZAR', motivoRechazo: 'OTRO' },
    });
    expect(otroSinDetalle.status).toBe(400);
  });

  it('un 409 real se conserva: gestionar un pago de una cotización que no está ACEPTADA', async () => {
    const id = await crearCotizacionFicticia(false);
    const res = await gestionar(id, tokenComercial, { bancoOrigen: 'Banco A' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toMatch(/ACEPTADA/);
  });
});

describe('Permisos y confirmación de la acreditación (sin cambios)', () => {
  it('sin sesión 401 y OPERATIVO 403 al gestionar pagos; ADMIN y COMERCIAL pueden gestionarlos', async () => {
    const id = await crearCotizacionFicticia();
    const sinSesion = await pedir(`/${id}/anticipo`, null, { method: 'PATCH', body: { accion: 'GESTIONAR', importeDeclarado: 5 } });
    expect(sinSesion.status).toBe(401);
    expect((await gestionar(id, tokenOperativo, { bancoOrigen: 'Banco A' })).status).toBe(403);
    expect((await gestionar(id, tokenComercial, { bancoOrigen: 'Banco A' })).status).toBe(200);
    expect((await gestionar(id, tokenAdmin, { bancoOrigen: 'Banco B' })).status).toBe(200);
  });

  it('COMERCIAL conserva el rechazo documental y no puede confirmar la acreditación; ADMIN no rechaza', async () => {
    const id = await crearCotizacionFicticia();
    await gestionar(id, tokenComercial, { bancoOrigen: 'Banco A' });

    const validarComercial = await pedir(`/${id}/anticipo`, tokenComercial, { method: 'PATCH', body: { accion: 'VALIDAR' } });
    expect(validarComercial.status).toBe(403);
    const rechazarAdmin = await pedir(`/${id}/anticipo`, tokenAdmin, {
      method: 'PATCH',
      body: { accion: 'RECHAZAR', motivoRechazo: 'COMPROBANTE_INCORRECTO' },
    });
    expect(rechazarAdmin.status).toBe(403);

    const rechazarComercial = await pedir(`/${id}/anticipo`, tokenComercial, {
      method: 'PATCH',
      body: { accion: 'RECHAZAR', motivoRechazo: 'COMPROBANTE_INCORRECTO' },
    });
    expect(rechazarComercial.status).toBe(200);
    expect((await historial(id)).some((t) => t.estado === 'RECHAZADO')).toBe(true);
  });

  it('ADMIN confirma la acreditación tras pagos con bancos distintos; un segundo intento de confirmar o rechazar es un 409 real', async () => {
    const id = await crearCotizacionFicticia();
    await gestionar(id, tokenComercial, { bancoOrigen: 'Banco A' });
    await gestionar(id, tokenComercial, { bancoOrigen: 'Banco B' });
    expect(await estadoAnticipo(id)).toBe('PENDIENTE');
    // Fase 2: acreditar un anticipo por TRANSFERENCIA exige el comprobante del cliente (la revisión ya está registrada).
    await simularComprobanteDelCliente(pool, id);

    const validar = await pedir(`/${id}/anticipo`, tokenAdmin, { method: 'PATCH', body: { accion: 'VALIDAR' } });
    expect(validar.status).toBe(200);
    expect(await estadoAnticipo(id)).toBe('VALIDADO');
    expect((await historial(id)).find((t) => t.vigente)).toMatchObject({ estado: 'VALIDADO', banco_origen: 'Banco B' });

    expect((await pedir(`/${id}/anticipo`, tokenAdmin, { method: 'PATCH', body: { accion: 'VALIDAR' } })).status).toBe(409);
    const rechazoTardio = await pedir(`/${id}/anticipo`, tokenComercial, {
      method: 'PATCH',
      body: { accion: 'RECHAZAR', motivoRechazo: 'COMPROBANTE_INCORRECTO' },
    });
    expect(rechazoTardio.status).toBe(409);
  });
});

describe('Autorización de excepción retirada', () => {
  it('los endpoints de excepción ya no existen (404 para ADMIN y COMERCIAL)', async () => {
    const id = await crearCotizacionFicticia();
    for (const token of [tokenAdmin, tokenComercial]) {
      expect((await pedir(`/${id}/banco-origen-excepcion`, token)).status).toBe(404);
      expect((await pedir(`/${id}/banco-origen-excepcion`, token, { method: 'PATCH' })).status).toBe(404);
    }
  });
});
