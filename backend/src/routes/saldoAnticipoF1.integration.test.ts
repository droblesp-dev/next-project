// F1 y F2 (P0) — integración real de las operaciones de SALDO contra el estado del anticipo.
//   F1: el saldo (VALIDAR, CONFIRMAR_TELEFONICA, RECHAZAR, GESTIONAR y reabrir) solo puede gestionarse
//       con el anticipo VALIDADO o NO_APLICA; con PENDIENTE, RECHAZADO o NULL (cotizaciones anteriores
//       a D.2) responde 409 y NO modifica la cotización ni crea transferencias.
//   F2: los errores funcionales de saldo (método requerido / inválido, comprobante requerido) responden
//       400/409 con las clases compartidas de cotizaciones.service, nunca 500.
// Pruebas de integración reales contra `nextproject_test`, con un servidor HTTP efímero y el router real
// (mismo andamiaje que pagosCotizacionInexistente / cuentaReceptoraPago). Cada caso crea SU PROPIA
// cotización ficticia (fixtures independientes): ninguna prueba altera el estado de otra.
// Limpieza por IDs (RegistroLimpieza) de las transferencias creadas; los usuarios, solicitudes, clientes y
// cotizaciones ficticios quedan (como en el resto de pruebas de pagos).
// Requisito de entorno: OPERATIVO_POR_DEFECTO_EMAIL vacío (si no, acreditar un anticipo crearía una orden
// real y dispararía la generación de ficha con IA); la prueba aborta si no lo está.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { RegistroLimpieza } from '../config/testCleanup.js';
import { cotizacionesRouter } from './cotizaciones.routes.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from '../services/solicitudes.service.js';
import { crearCotizacion, cambiarEstadoCotizacion } from '../services/cotizaciones.service.js';
import { confirmarAcreditacionDirecta, rechazarPago } from '../services/transferenciasPago.service.js';

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

type EstadoAnticipo = 'PENDIENTE' | 'RECHAZADO' | 'NULL' | 'VALIDADO' | 'NO_APLICA';
type CuerpoPago = Record<string, unknown>;
type Operacion = { nombre: string; token: () => string; cuerpo: () => CuerpoPago };
type FilaPago = {
  id: string;
  tipo_pago: string;
  estado: string;
  vigente: boolean;
  medio_confirmacion: string | null;
  verificado_por: string | null;
  registrado_por: string;
  motivo_rechazo: string | null;
};

function firmar(sub: string, rol: string): string {
  return jwt.sign({ sub, rol }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

async function crearUsuario(rolNombre: string, etiqueta: string): Promise<string> {
  const rol = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [rolNombre]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
    [`Prueba saldo anticipo F1 (${etiqueta})`, `saldo-anticipo-f1.${etiqueta}.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  return u.rows[0].id;
}

// Cotización ficticia ACEPTADA (aceptada con la función existente del repositorio: no crea órdenes).
// anticipoPorcentaje 0 => NO_APLICA (sin método); >0 => anticipo por TRANSFERENCIA en PENDIENTE.
async function crearCotizacionBase(anticipoPorcentaje: number): Promise<string> {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba saldo anticipo F1',
      empresa: null,
      email: `saldo-anticipo-f1.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio ficticio saldo anticipo F1',
      descripcion: 'Registro ficticio de integración (saldo y anticipo, F1/F2).',
      cantidad: 1,
    },
    `saldo-anticipo-f1-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  const c = await crearCotizacion({
    solicitudId: s.solicitud.id,
    valor: 1000,
    descripcion: null,
    creadoPor: comercialId,
    anticipoPorcentaje,
    ...(anticipoPorcentaje > 0 ? { metodoAnticipo: 'TRANSFERENCIA' } : {}),
  });
  await cambiarEstadoCotizacion(c.id, 'ENVIADA');
  expect(await cotizacionesRepo.marcarAceptada(c.id)).not.toBeNull();
  cotizacionesCreadas.push(c.id);
  return c.id;
}

async function filaCotizacion(id: string): Promise<Record<string, unknown>> {
  return (await pool.query('SELECT * FROM cotizaciones WHERE id = $1', [id])).rows[0];
}

async function filasPago(id: string): Promise<FilaPago[]> {
  return (
    await pool.query<FilaPago>(
      `SELECT id, tipo_pago, estado, vigente, medio_confirmacion, verificado_por, registrado_por, motivo_rechazo
       FROM transferencias_pago WHERE cotizacion_id = $1 ORDER BY creado_en, id`,
      [id]
    )
  ).rows;
}

// Estado completo de la cotización y su historial de pagos: lo que un rechazo (409/400) NO debe alterar.
async function instantanea(id: string) {
  return { cotizacion: await filaCotizacion(id), pagos: await filasPago(id) };
}

// Fixture con el anticipo en el estado pedido, alcanzado por el flujo real salvo NULL (dato anterior a D.2,
// que ya no puede producir el código actual: se fuerza con SQL sobre la cotización ficticia de esta prueba).
async function cotizacionConAnticipo(estado: EstadoAnticipo): Promise<string> {
  if (estado === 'NO_APLICA') {
    const id = await crearCotizacionBase(0);
    expect((await filaCotizacion(id)).estado_anticipo).toBe('NO_APLICA');
    return id;
  }
  const id = await crearCotizacionBase(50);
  if (estado === 'RECHAZADO') {
    await rechazarPago({ cotizacionId: id, tipoPago: 'ANTICIPO', motivoRechazo: 'COMPROBANTE_ILEGIBLE', rechazadoPor: comercialId });
  }
  if (estado === 'VALIDADO') {
    await confirmarAcreditacionDirecta({ cotizacionId: id, tipoPago: 'ANTICIPO', adminId });
  }
  if (estado === 'NULL') {
    await pool.query('UPDATE cotizaciones SET estado_anticipo = NULL WHERE id = $1', [id]);
  }
  // precondición de cada caso: el anticipo está realmente en el estado que dice probar
  expect((await filaCotizacion(id)).estado_anticipo).toBe(estado === 'NULL' ? null : estado);
  return id;
}

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

const saldo = (id: string, token: string, cuerpo: CuerpoPago) => pedir(`/${id}/saldo`, token, { method: 'PATCH', body: cuerpo });
const mensaje = async (res: Response) => ((await res.json()) as { message: string }).message;

const OPERACIONES_SALDO: Operacion[] = [
  { nombre: 'VALIDAR (ADMIN, EFECTIVO)', token: () => tokenAdmin, cuerpo: () => ({ accion: 'VALIDAR', metodo: 'EFECTIVO' }) },
  {
    nombre: 'CONFIRMAR_TELEFONICA (COMERCIAL, EFECTIVO)',
    token: () => tokenComercial,
    cuerpo: () => ({ accion: 'CONFIRMAR_TELEFONICA', verificadorId: adminId, metodo: 'EFECTIVO' }),
  },
  {
    nombre: 'RECHAZAR (COMERCIAL)',
    token: () => tokenComercial,
    cuerpo: () => ({ accion: 'RECHAZAR', motivoRechazo: 'COMPROBANTE_ILEGIBLE' }),
  },
  { nombre: 'GESTIONAR (COMERCIAL)', token: () => tokenComercial, cuerpo: () => ({ accion: 'GESTIONAR', importeDeclarado: 50 }) },
];

beforeAll(async () => {
  // Protección de entorno: sin operativo por defecto no se crean órdenes ni se llama a la IA al acreditar anticipos.
  if (env.operativoPorDefectoEmail) {
    throw new Error('OPERATIVO_POR_DEFECTO_EMAIL debe estar vacío al ejecutar esta prueba (crearía órdenes reales).');
  }
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
  // Equivalente al manejador final de server.ts (500 genérico): si algún error funcional se escapara, el
  // caso fallaría con 500 en lugar del 400/409 esperado.
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
      const t = await pool.query<{ id: string }>(
        'SELECT id FROM transferencias_pago WHERE cotizacion_id = ANY($1::uuid[])',
        [cotizacionesCreadas]
      );
      for (const fila of t.rows) registro.registrarTransferencia(fila.id);
    }
    await registro.limpiar(pool);
  }
});

describe.each(['PENDIENTE', 'RECHAZADO', 'NULL'] as const)(
  'F1: anticipo %s — las operaciones de saldo responden 409 y no alteran nada',
  (estado) => {
    it.each(OPERACIONES_SALDO)('$nombre -> 409 con el motivo del anticipo y sin cambios en BD', async (op) => {
      const id = await cotizacionConAnticipo(estado);
      const antes = await instantanea(id);

      const res = await saldo(id, op.token(), op.cuerpo());

      expect(res.status).toBe(409);
      expect(await mensaje(res)).toMatch(/anticipo/i);
      // ni la cotización (estado_saldo, método, confirmaciones, actualizado_en…) ni el historial de pagos cambian
      expect(await instantanea(id)).toEqual(antes);
    });

    it('reabrir saldo -> 409 con el motivo del anticipo y sin cambios en BD', async () => {
      const id = await cotizacionConAnticipo(estado);
      // saldo RECHAZADO con el anticipo sin resolver: dato inconsistente (p. ej. anterior a la regla), forzado por SQL
      await pool.query(`UPDATE cotizaciones SET estado_saldo = 'RECHAZADO' WHERE id = $1`, [id]);
      const antes = await instantanea(id);

      const res = await pedir(`/${id}/saldo/reabrir`, tokenComercial, { method: 'PATCH', body: {} });

      expect(res.status).toBe(409);
      expect(await mensaje(res)).toMatch(/anticipo/i);
      expect(await instantanea(id)).toEqual(antes);
    });
  }
);

describe.each(['VALIDADO', 'NO_APLICA'] as const)('F1: anticipo %s — el saldo puede gestionarse', (estado) => {
  it('VALIDAR (ADMIN, EFECTIVO) -> 200: saldo VALIDADO y una fila DIRECTO vigente', async () => {
    const id = await cotizacionConAnticipo(estado);
    const pagosAntes = (await filasPago(id)).length;

    const res = await saldo(id, tokenAdmin, { accion: 'VALIDAR', metodo: 'EFECTIVO' });

    expect(res.status).toBe(200);
    const fila = await filaCotizacion(id);
    expect(fila).toMatchObject({ estado_anticipo: estado, estado_saldo: 'VALIDADO', metodo_saldo: 'EFECTIVO', saldo_confirmado_por: adminId });
    expect(fila.saldo_confirmado_en).not.toBeNull();
    const pagos = await filasPago(id);
    expect(pagos).toHaveLength(pagosAntes + 1);
    expect(pagos.filter((p) => p.tipo_pago === 'SALDO')).toEqual([
      expect.objectContaining({ estado: 'VALIDADO', vigente: true, medio_confirmacion: 'DIRECTO', verificado_por: adminId, registrado_por: adminId }),
    ]);
  });

  it('CONFIRMAR_TELEFONICA (COMERCIAL) -> 200: el ADMIN verificador es distinto del COMERCIAL que registra', async () => {
    const id = await cotizacionConAnticipo(estado);

    const res = await saldo(id, tokenComercial, { accion: 'CONFIRMAR_TELEFONICA', verificadorId: adminId, metodo: 'EFECTIVO' });

    expect(res.status).toBe(200);
    expect(await filaCotizacion(id)).toMatchObject({ estado_anticipo: estado, estado_saldo: 'VALIDADO', saldo_confirmado_por: adminId });
    const [pago] = (await filasPago(id)).filter((p) => p.tipo_pago === 'SALDO');
    expect(pago).toMatchObject({ estado: 'VALIDADO', vigente: true, medio_confirmacion: 'TELEFONICO', verificado_por: adminId, registrado_por: comercialId });
  });

  it('RECHAZAR (COMERCIAL) -> 200: saldo RECHAZADO y fila RECHAZADO con su motivo', async () => {
    const id = await cotizacionConAnticipo(estado);

    const res = await saldo(id, tokenComercial, { accion: 'RECHAZAR', motivoRechazo: 'COMPROBANTE_ILEGIBLE' });

    expect(res.status).toBe(200);
    expect(await filaCotizacion(id)).toMatchObject({ estado_anticipo: estado, estado_saldo: 'RECHAZADO' });
    const [pago] = (await filasPago(id)).filter((p) => p.tipo_pago === 'SALDO');
    expect(pago).toMatchObject({ estado: 'RECHAZADO', vigente: true, motivo_rechazo: 'COMPROBANTE_ILEGIBLE' });
  });

  it('GESTIONAR (COMERCIAL) -> 200: intento PENDIENTE vigente y el saldo sigue PENDIENTE', async () => {
    const id = await cotizacionConAnticipo(estado);

    const res = await saldo(id, tokenComercial, { accion: 'GESTIONAR', importeDeclarado: 50 });

    expect(res.status).toBe(200);
    expect(await filaCotizacion(id)).toMatchObject({ estado_anticipo: estado, estado_saldo: 'PENDIENTE' });
    const [pago] = (await filasPago(id)).filter((p) => p.tipo_pago === 'SALDO');
    expect(pago).toMatchObject({ estado: 'PENDIENTE', vigente: true, registrado_por: comercialId });
  });

  it('RECHAZAR y luego reabrir -> 200: el saldo vuelve a PENDIENTE sin método ni confirmación', async () => {
    const id = await cotizacionConAnticipo(estado);
    expect((await saldo(id, tokenComercial, { accion: 'RECHAZAR', motivoRechazo: 'COMPROBANTE_ILEGIBLE' })).status).toBe(200);

    const res = await pedir(`/${id}/saldo/reabrir`, tokenComercial, { method: 'PATCH', body: {} });

    expect(res.status).toBe(200);
    const fila = await filaCotizacion(id);
    expect(fila).toMatchObject({ estado_anticipo: estado, estado_saldo: 'PENDIENTE', metodo_saldo: null, saldo_confirmado_por: null });
    expect(fila.saldo_confirmado_en).toBeNull();
  });
});

describe('F2: errores funcionales de saldo con códigos controlados (nunca 500)', () => {
  it('VALIDAR sin método (saldo sin método definido) -> 400 y sin cambios', async () => {
    const id = await cotizacionConAnticipo('NO_APLICA');
    const antes = await instantanea(id);

    const res = await saldo(id, tokenAdmin, { accion: 'VALIDAR' });

    expect(res.status).toBe(400);
    expect(await mensaje(res)).toMatch(/metodo/i);
    expect(await instantanea(id)).toEqual(antes);
  });

  it('VALIDAR con un método fuera del catálogo -> 400 y sin cambios', async () => {
    const id = await cotizacionConAnticipo('NO_APLICA');
    const antes = await instantanea(id);

    const res = await saldo(id, tokenAdmin, { accion: 'VALIDAR', metodo: 'CHEQUE' });

    expect(res.status).toBe(400);
    expect(await instantanea(id)).toEqual(antes);
  });

  it('VALIDAR con un método distinto al ya definido (TRANSFERENCIA) -> 400 y sin cambios', async () => {
    const id = await cotizacionConAnticipo('NO_APLICA');
    await pool.query(`UPDATE cotizaciones SET metodo_saldo = 'TRANSFERENCIA' WHERE id = $1`, [id]);
    const antes = await instantanea(id);

    const res = await saldo(id, tokenAdmin, { accion: 'VALIDAR', metodo: 'EFECTIVO' });

    expect(res.status).toBe(400);
    expect(await instantanea(id)).toEqual(antes);
  });

  it('VALIDAR por TRANSFERENCIA sin comprobante subido -> 409 y sin cambios', async () => {
    const id = await cotizacionConAnticipo('NO_APLICA');
    await pool.query(`UPDATE cotizaciones SET metodo_saldo = 'TRANSFERENCIA' WHERE id = $1`, [id]);
    const antes = await instantanea(id);

    const res = await saldo(id, tokenAdmin, { accion: 'VALIDAR' });

    expect(res.status).toBe(409);
    expect(await mensaje(res)).toMatch(/comprobante/i);
    expect(await instantanea(id)).toEqual(antes);
  });

  it('VALIDAR por TRANSFERENCIA con el comprobante ya registrado -> 200 y saldo VALIDADO por TRANSFERENCIA', async () => {
    const id = await cotizacionConAnticipo('VALIDADO');
    await pool.query(
      `UPDATE cotizaciones SET metodo_saldo = 'TRANSFERENCIA', comprobante_saldo = 'comprobante-ficticio-f1.png' WHERE id = $1`,
      [id]
    );

    const res = await saldo(id, tokenAdmin, { accion: 'VALIDAR' });

    expect(res.status).toBe(200);
    expect(await filaCotizacion(id)).toMatchObject({ estado_saldo: 'VALIDADO', metodo_saldo: 'TRANSFERENCIA' });
  });
});

describe('F1: los permisos se evalúan antes que la regla del anticipo (sin cambios de contrato)', () => {
  it('con el anticipo PENDIENTE: COMERCIAL no puede VALIDAR (403), ADMIN no puede RECHAZAR (403) y OPERATIVO no accede (403)', async () => {
    const id = await cotizacionConAnticipo('PENDIENTE');
    const antes = await instantanea(id);

    expect((await saldo(id, tokenComercial, { accion: 'VALIDAR', metodo: 'EFECTIVO' })).status).toBe(403);
    expect((await saldo(id, tokenAdmin, { accion: 'RECHAZAR', motivoRechazo: 'COMPROBANTE_ILEGIBLE' })).status).toBe(403);
    expect((await saldo(id, tokenAdmin, { accion: 'CONFIRMAR_TELEFONICA', verificadorId: adminId })).status).toBe(403);
    expect((await saldo(id, tokenOperativo, { accion: 'GESTIONAR', importeDeclarado: 50 })).status).toBe(403);
    expect((await pedir(`/${id}/saldo`, null, { method: 'PATCH', body: { accion: 'GESTIONAR', importeDeclarado: 50 } })).status).toBe(401);
    expect(await instantanea(id)).toEqual(antes);
  });
});

describe('F1: solicitudes simultáneas', () => {
  it('con el anticipo PENDIENTE, las cuatro operaciones de saldo a la vez responden 409 y no alteran nada', async () => {
    const id = await cotizacionConAnticipo('PENDIENTE');
    const antes = await instantanea(id);

    const respuestas = await Promise.all(OPERACIONES_SALDO.map((op) => saldo(id, op.token(), op.cuerpo())));

    expect(respuestas.map((r) => r.status)).toEqual([409, 409, 409, 409]);
    expect(await instantanea(id)).toEqual(antes);
  });

  it('con el anticipo VALIDADO, dos VALIDAR simultáneos: exactamente uno tiene éxito (200) y el otro recibe 409', async () => {
    const id = await cotizacionConAnticipo('VALIDADO');

    const respuestas = await Promise.all([
      saldo(id, tokenAdmin, { accion: 'VALIDAR', metodo: 'EFECTIVO' }),
      saldo(id, tokenAdmin, { accion: 'VALIDAR', metodo: 'EFECTIVO' }),
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await filaCotizacion(id)).toMatchObject({ estado_saldo: 'VALIDADO', metodo_saldo: 'EFECTIVO' });
    const pagosSaldo = (await filasPago(id)).filter((p) => p.tipo_pago === 'SALDO');
    expect(pagosSaldo).toHaveLength(1);
    expect(pagosSaldo[0]).toMatchObject({ estado: 'VALIDADO', vigente: true });
  });
});
