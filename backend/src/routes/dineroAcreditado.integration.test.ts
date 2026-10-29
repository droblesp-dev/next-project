// Fase 2 — «Dinero acreditado» (integración real contra `nextproject_test`, servidor HTTP efímero con el router real).
// ADMIN verifica verbalmente que el dinero ingresó y COMERCIAL lo registra: la acción CONFIRMAR_TELEFONICA (alias
// DINERO_ACREDITADO) conserva quién verificó (ADMIN) y quién registró (COMERCIAL), la hora del registro (creado_en),
// las observaciones y —solo si se conoce— la hora REAL de la llamada (llamada_en, V20).
//   * Anticipo por TRANSFERENCIA: exige el comprobante del cliente y la revisión previa de COMERCIAL, por TODAS las vías
//     (telefónica y VALIDAR directo de ADMIN). El efectivo conserva su flujo propio.
//   * Si ADMIN no responde o el dinero todavía no aparece: seguimiento con observación; el pago sigue PENDIENTE
//     (no hay estados nuevos) y nunca puede ser la primera gestión.
// Cada caso crea SU PROPIA cotización ficticia. Limpieza por IDs (RegistroLimpieza) de las transferencias creadas.
// Requisito de entorno: OPERATIVO_POR_DEFECTO_EMAIL vacío (si no, acreditar un anticipo crearía una orden real y
// dispararía la generación de ficha con IA); la prueba aborta si no lo está.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { RegistroLimpieza } from '../config/testCleanup.js';
import { simularComprobanteDelCliente } from '../config/testFixturesPagos.js';
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
let restaurarFetch: () => void;

const registro = new RegistroLimpieza();
const cotizacionesCreadas: string[] = [];

type FilaPago = {
  id: string;
  tipo_pago: string;
  estado: string;
  vigente: boolean;
  medio_confirmacion: string | null;
  verificado_por: string | null;
  registrado_por: string;
  observaciones: string | null;
  llamada_en: Date | null;
  creado_en: Date;
  motivo_rechazo: string | null;
  importe_declarado: string;
  banco_origen: string | null;
  referencia_bancaria: string | null;
};

function firmar(sub: string, rol: string): string {
  return jwt.sign({ sub, rol }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

async function crearUsuario(rolNombre: string, etiqueta: string): Promise<string> {
  const rol = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [rolNombre]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
    [`Prueba dinero acreditado (${etiqueta})`, `dinero-acreditado.${etiqueta}.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  return u.rows[0].id;
}

// Cotización ficticia ACEPTADA con anticipo del 50 % por el método pedido (PENDIENTE). anticipoPorcentaje 0 = NO_APLICA.
async function crearCotizacionAceptada(opciones: { metodo?: 'TRANSFERENCIA' | 'EFECTIVO'; anticipoPorcentaje?: number } = {}): Promise<string> {
  const porcentaje = opciones.anticipoPorcentaje ?? 50;
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba dinero acreditado',
      empresa: null,
      email: `dinero-acreditado.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio ficticio dinero acreditado',
      descripcion: 'Registro ficticio de integración (dinero acreditado, Fase 2).',
      cantidad: 1,
    },
    `dinero-acreditado-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  const c = await crearCotizacion({
    solicitudId: s.solicitud.id,
    valor: 1000,
    descripcion: null,
    creadoPor: comercialId,
    anticipoPorcentaje: porcentaje,
    ...(porcentaje > 0 ? { metodoAnticipo: opciones.metodo ?? 'TRANSFERENCIA' } : {}),
  });
  await cambiarEstadoCotizacion(c.id, 'ENVIADA');
  expect(await cotizacionesRepo.marcarAceptada(c.id)).not.toBeNull();
  cotizacionesCreadas.push(c.id);
  return c.id;
}

const filaCotizacion = async (id: string) => (await pool.query('SELECT * FROM cotizaciones WHERE id = $1', [id])).rows[0] as Record<string, unknown>;

async function filasPago(id: string): Promise<FilaPago[]> {
  return (
    await pool.query<FilaPago>(
      `SELECT id, tipo_pago, estado, vigente, medio_confirmacion, verificado_por, registrado_por, observaciones, llamada_en,
              creado_en, motivo_rechazo, importe_declarado, banco_origen, referencia_bancaria
         FROM transferencias_pago WHERE cotizacion_id = $1 ORDER BY creado_en, id`,
      [id]
    )
  ).rows;
}

const instantanea = async (id: string) => ({ cotizacion: await filaCotizacion(id), pagos: await filasPago(id) });

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

const anticipo = (id: string, token: string, cuerpo: Record<string, unknown>) => pedir(`/${id}/anticipo`, token, { method: 'PATCH', body: cuerpo });
const saldo = (id: string, token: string, cuerpo: Record<string, unknown>) => pedir(`/${id}/saldo`, token, { method: 'PATCH', body: cuerpo });
const mensaje = async (res: Response) => ((await res.json()) as { message: string }).message;

// COMERCIAL registra la revisión del comprobante (gestión vigente PENDIENTE) con datos reconocibles.
const revisar = (id: string) => anticipo(id, tokenComercial, { accion: 'GESTIONAR', importeDeclarado: 500, bancoOrigen: 'Banco del Cliente', referenciaBancaria: 'REF-F2' });
const dineroAcreditado = (id: string, extra: Record<string, unknown> = {}) =>
  anticipo(id, tokenComercial, { accion: 'DINERO_ACREDITADO', verificadorId: adminId, ...extra });

beforeAll(async () => {
  if (env.operativoPorDefectoEmail) {
    throw new Error('OPERATIVO_POR_DEFECTO_EMAIL debe estar vacío al ejecutar esta prueba (crearía órdenes reales).');
  }
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
  tokenAdmin = firmar(adminId, 'ADMIN');
  tokenComercial = firmar(comercialId, 'COMERCIAL');

  const app = express();
  app.use(express.json());
  app.use('/api/cotizaciones', cotizacionesRouter);
  const manejadorFinal: ErrorRequestHandler = (_err, _req, res, _next) => {
    res.status(500).json({ message: 'Error interno del servidor.' });
  };
  app.use(manejadorFinal);
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
      const t = await pool.query<{ id: string }>('SELECT id FROM transferencias_pago WHERE cotizacion_id = ANY($1::uuid[])', [cotizacionesCreadas]);
      for (const fila of t.rows) registro.registrarTransferencia(fila.id);
    }
    await registro.limpiar(pool);
  }
});

describe('anticipo por TRANSFERENCIA: «Dinero acreditado» exige comprobante y revisión previa', () => {
  it('sin el comprobante del cliente -> 409 y no cambia nada', async () => {
    const id = await crearCotizacionAceptada();
    await revisar(id); // aunque COMERCIAL ya revisó, sin comprobante del cliente no hay nada que acreditar
    const antes = await instantanea(id);

    const res = await dineroAcreditado(id);

    expect(res.status).toBe(409);
    expect(await mensaje(res)).toMatch(/comprobante/i);
    expect(await instantanea(id)).toEqual(antes);
  });

  it('con comprobante pero sin la revisión de COMERCIAL -> 409 y no cambia nada', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    const antes = await instantanea(id);

    const res = await dineroAcreditado(id);

    expect(res.status).toBe(409);
    expect(await mensaje(res)).toMatch(/revisi/i);
    expect(await instantanea(id)).toEqual(antes);
  });

  it('con la última gestión RECHAZADA (no es una revisión pendiente) -> 409', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    await revisar(id);
    expect((await anticipo(id, tokenComercial, { accion: 'RECHAZAR', motivoRechazo: 'IMPORTE_INCORRECTO' })).status).toBe(200);
    // el anticipo RECHAZADO ya no admite acreditarse: el cliente debe volver a subir el comprobante
    expect((await dineroAcreditado(id)).status).toBe(409);
  });

  it('VALIDAR directo de ADMIN no es una vía alterna: también exige comprobante y revisión (409) y funciona cuando se cumplen (200, DIRECTO)', async () => {
    const id = await crearCotizacionAceptada();
    expect((await anticipo(id, tokenAdmin, { accion: 'VALIDAR' })).status).toBe(409);
    await simularComprobanteDelCliente(pool, id);
    expect((await anticipo(id, tokenAdmin, { accion: 'VALIDAR' })).status).toBe(409);
    await revisar(id);
    expect((await anticipo(id, tokenAdmin, { accion: 'VALIDAR' })).status).toBe(200);
    const [vigente] = (await filasPago(id)).filter((p) => p.vigente);
    expect(vigente).toMatchObject({ estado: 'VALIDADO', medio_confirmacion: 'DIRECTO', verificado_por: adminId });
  });

  it('con comprobante y revisión -> 200: conserva quién verificó, quién registró, observaciones y la hora real de la llamada', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    await revisar(id);
    const llamada = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const res = await dineroAcreditado(id, { observaciones: '  ADMIN confirmó el ingreso en la cuenta  ', llamadaEn: llamada.toISOString() });

    expect(res.status).toBe(200);
    expect(await filaCotizacion(id)).toMatchObject({ estado_anticipo: 'VALIDADO', anticipo_confirmado_por: adminId });
    const pagos = await filasPago(id);
    expect(pagos).toHaveLength(2);
    expect(pagos.filter((p) => p.vigente)).toHaveLength(1);
    const [vigente] = pagos.filter((p) => p.vigente);
    expect(vigente).toMatchObject({
      estado: 'VALIDADO', tipo_pago: 'ANTICIPO', medio_confirmacion: 'TELEFONICO',
      verificado_por: adminId, registrado_por: comercialId, observaciones: 'ADMIN confirmó el ingreso en la cuenta',
    });
    // dos instantes distintos: la llamada (informada) y el registro en el sistema (automático)
    expect(vigente.llamada_en?.getTime()).toBe(llamada.getTime());
    expect(vigente.creado_en.getTime()).toBeGreaterThan(llamada.getTime());
    // la revisión previa queda en el historial, ya no vigente, con sus datos
    expect(pagos.find((p) => !p.vigente)).toMatchObject({ estado: 'PENDIENTE', banco_origen: 'Banco del Cliente', referencia_bancaria: 'REF-F2' });
  });

  it('CONFIRMAR_TELEFONICA y DINERO_ACREDITADO son la misma acción (compatibilidad del contrato)', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    await revisar(id);
    expect((await anticipo(id, tokenComercial, { accion: 'CONFIRMAR_TELEFONICA', verificadorId: adminId })).status).toBe(200);
    const [vigente] = (await filasPago(id)).filter((p) => p.vigente);
    expect(vigente).toMatchObject({ estado: 'VALIDADO', medio_confirmacion: 'TELEFONICO', llamada_en: null });
  });

  it('sin hora de llamada, llamada_en queda en NULL (no se rellena con la hora del registro)', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    await revisar(id);
    expect((await dineroAcreditado(id)).status).toBe(200);
    const [vigente] = (await filasPago(id)).filter((p) => p.vigente);
    expect(vigente.llamada_en).toBeNull();
    expect(vigente.observaciones).toBeNull();
  });

  it('datos inválidos -> 400 y no cambia nada: llamada en el futuro, fecha ilegible y observaciones demasiado largas', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    await revisar(id);
    const antes = await instantanea(id);

    expect((await dineroAcreditado(id, { llamadaEn: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })).status).toBe(400);
    expect((await dineroAcreditado(id, { llamadaEn: 'ayer por la tarde' })).status).toBe(400);
    expect((await dineroAcreditado(id, { observaciones: 'x'.repeat(1001) })).status).toBe(400);
    expect((await dineroAcreditado(id, { observaciones: 12345 })).status).toBe(400);
    expect(await instantanea(id)).toEqual(antes);
  });

  it('permisos: ADMIN no puede registrar «Dinero acreditado» (403) y un verificador que no es ADMIN activo se rechaza (400)', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    await revisar(id);
    expect((await anticipo(id, tokenAdmin, { accion: 'DINERO_ACREDITADO', verificadorId: adminId })).status).toBe(403);
    expect((await dineroAcreditado(id, { verificadorId: comercialId })).status).toBe(400);
    expect((await filaCotizacion(id)).estado_anticipo).toBe('PENDIENTE');
  });

  it('dos «Dinero acreditado» simultáneos: exactamente uno tiene éxito (200) y el otro 409', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    await revisar(id);

    const respuestas = await Promise.all([dineroAcreditado(id), dineroAcreditado(id)]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await filasPago(id)).filter((p) => p.vigente && p.estado === 'VALIDADO')).toHaveLength(1);
  });
});

describe('seguimiento: ADMIN sin respuesta o el dinero todavía no aparece (el pago sigue PENDIENTE)', () => {
  it('no puede ser la primera gestión (409) y exige observación (400)', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    const antes = await instantanea(id);
    expect((await anticipo(id, tokenComercial, { accion: 'GESTIONAR', importeDeclarado: 500, seguimiento: true, observaciones: 'ADMIN no respondió' })).status).toBe(409);
    expect(await instantanea(id)).toEqual(antes);

    await revisar(id);
    expect((await anticipo(id, tokenComercial, { accion: 'GESTIONAR', importeDeclarado: 500, seguimiento: true })).status).toBe(400);
    expect((await anticipo(id, tokenComercial, { accion: 'GESTIONAR', importeDeclarado: 500, seguimiento: true, observaciones: '   ' })).status).toBe(400);
  });

  it('con la revisión previa -> 200: fila PENDIENTE vigente con la observación, datos de la gestión conservados y el anticipo sigue PENDIENTE; después se puede acreditar', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    await revisar(id);
    const llamada = new Date(Date.now() - 30 * 60 * 1000);

    const res = await anticipo(id, tokenComercial, {
      accion: 'GESTIONAR', importeDeclarado: 1, seguimiento: true, observaciones: 'El dinero todavía no aparece', llamadaEn: llamada.toISOString(),
    });

    expect(res.status).toBe(200);
    expect(await filaCotizacion(id)).toMatchObject({ estado_anticipo: 'PENDIENTE' });
    const pagos = await filasPago(id);
    expect(pagos).toHaveLength(2);
    const [vigente] = pagos.filter((p) => p.vigente);
    expect(vigente).toMatchObject({
      estado: 'PENDIENTE', observaciones: 'El dinero todavía no aparece', banco_origen: 'Banco del Cliente', referencia_bancaria: 'REF-F2',
    });
    expect(Number(vigente.importe_declarado)).toBe(500); // se conserva el importe de la gestión (no el del cuerpo)
    expect(vigente.llamada_en?.getTime()).toBe(llamada.getTime());

    expect((await dineroAcreditado(id, { observaciones: 'Ya apareció en la cuenta' })).status).toBe(200);
    expect(await filaCotizacion(id)).toMatchObject({ estado_anticipo: 'VALIDADO' });
  });

  it('si finalmente no se acredita, COMERCIAL rechaza el comprobante con motivo y observación', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    await revisar(id);
    const res = await anticipo(id, tokenComercial, { accion: 'RECHAZAR', motivoRechazo: 'OTRO', motivoRechazoDetalle: 'No se acreditó en 48 h', observaciones: 'ADMIN confirmó que no llegó' });
    expect(res.status).toBe(200);
    expect(await filaCotizacion(id)).toMatchObject({ estado_anticipo: 'RECHAZADO' });
    const [vigente] = (await filasPago(id)).filter((p) => p.vigente);
    expect(vigente).toMatchObject({ estado: 'RECHAZADO', motivo_rechazo: 'OTRO', observaciones: 'ADMIN confirmó que no llegó' });
  });
});

describe('efectivo: flujo propio, sin comprobante ni revisión de transferencia', () => {
  it('el anticipo en EFECTIVO se confirma con el ADMIN identificado, sin comprobante ni revisión previa', async () => {
    const id = await crearCotizacionAceptada({ metodo: 'EFECTIVO' });

    const res = await dineroAcreditado(id, { observaciones: 'Efectivo entregado en oficina' });

    expect(res.status).toBe(200);
    expect(await filaCotizacion(id)).toMatchObject({ estado_anticipo: 'VALIDADO', metodo_anticipo: 'EFECTIVO' });
    const [vigente] = (await filasPago(id)).filter((p) => p.vigente);
    expect(vigente).toMatchObject({ estado: 'VALIDADO', verificado_por: adminId, registrado_por: comercialId, observaciones: 'Efectivo entregado en oficina' });
  });
});

describe('saldo por TRANSFERENCIA: «Dinero acreditado» con el comprobante del saldo', () => {
  it('con el anticipo NO_APLICA y el comprobante del saldo registrado -> 200 con ADMIN verificador y observaciones', async () => {
    const id = await crearCotizacionAceptada({ anticipoPorcentaje: 0 });
    await pool.query(`UPDATE cotizaciones SET metodo_saldo = 'TRANSFERENCIA', comprobante_saldo = 'saldo-ficticio-pruebas.png' WHERE id = $1`, [id]);

    const res = await saldo(id, tokenComercial, { accion: 'DINERO_ACREDITADO', verificadorId: adminId, observaciones: 'Saldo acreditado' });

    expect(res.status).toBe(200);
    expect(await filaCotizacion(id)).toMatchObject({ estado_saldo: 'VALIDADO', metodo_saldo: 'TRANSFERENCIA', saldo_confirmado_por: adminId });
    const [vigente] = (await filasPago(id)).filter((p) => p.vigente);
    expect(vigente).toMatchObject({ tipo_pago: 'SALDO', estado: 'VALIDADO', medio_confirmacion: 'TELEFONICO', verificado_por: adminId, registrado_por: comercialId, observaciones: 'Saldo acreditado' });
  });

  it('el saldo sigue bloqueado con el anticipo PENDIENTE aunque se use «Dinero acreditado» (409, sin cambios)', async () => {
    const id = await crearCotizacionAceptada();
    const antes = await instantanea(id);
    expect((await saldo(id, tokenComercial, { accion: 'DINERO_ACREDITADO', verificadorId: adminId, metodo: 'EFECTIVO' })).status).toBe(409);
    expect(await instantanea(id)).toEqual(antes);
  });
});

describe('historial: quién verificó y quién registró', () => {
  it('GET /:id/transferencias devuelve los nombres, las observaciones y la hora de la llamada', async () => {
    const id = await crearCotizacionAceptada();
    await simularComprobanteDelCliente(pool, id);
    await revisar(id);
    const llamada = new Date(Date.now() - 10 * 60 * 1000);
    expect((await dineroAcreditado(id, { observaciones: 'Confirmado', llamadaEn: llamada.toISOString() })).status).toBe(200);

    const res = await pedir(`/${id}/transferencias`, tokenComercial);
    expect(res.status).toBe(200);
    const { transferencias } = (await res.json()) as {
      transferencias: Array<{ vigente: boolean; estado: string; verificado_por_nombre: string | null; registrado_por_nombre: string | null; observaciones: string | null; llamada_en: string | null; creado_en: string }>;
    };
    expect(transferencias).toHaveLength(2);
    const vigente = transferencias.find((t) => t.vigente)!;
    expect(vigente).toMatchObject({ estado: 'VALIDADO', verificado_por_nombre: 'Prueba dinero acreditado (admin)', registrado_por_nombre: 'Prueba dinero acreditado (comercial)', observaciones: 'Confirmado' });
    expect(new Date(vigente.llamada_en!).getTime()).toBe(llamada.getTime());
    expect(new Date(vigente.creado_en).getTime()).toBeGreaterThan(llamada.getTime());
    expect(transferencias.find((t) => !t.vigente)).toMatchObject({ estado: 'PENDIENTE', verificado_por_nombre: null });
  });
});
