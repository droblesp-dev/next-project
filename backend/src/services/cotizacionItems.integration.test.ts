// Requerimiento 4 (V28), nextproject_test real: líneas de detalle de las cotizaciones.
// REQUIERE que V28__cotizacion_items.sql esté aplicada en la base de pruebas. Si la tabla no existe, TODO este archivo se omite
// (aviso en consola): no se declara como pasado nada que no se haya ejecutado. La migración no se aplica desde las pruebas.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { cotizacionesRouter } from '../routes/cotizaciones.routes.js';
import { reiniciarCacheEsquemaCotizaciones } from '../repositories/cotizacionesEsquema.js';
import * as itemsRepo from '../repositories/cotizacionItems.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import {
  cambiarEstadoCotizacion,
  CotizacionNoEditableError,
  crearCotizacion,
  editarCotizacionBorrador,
  obtenerLineasDeCotizacion,
} from './cotizaciones.service.js';
import { buscarIds } from './busqueda.service.js';

const disponible = (await pool.query<{ t: boolean }>(`SELECT to_regclass('public.cotizacion_items') IS NOT NULL AS t`)).rows[0].t;
if (!disponible) {
  console.warn('[cotizacionItems.integration] OMITIDO: la tabla cotizacion_items no existe (V28 no aplicada en la base de pruebas).');
}

type Rol = 'ADMIN' | 'COMERCIAL' | 'OPERATIVO';
const ids = {} as Record<Rol, string>;
const tokens = {} as Record<Rol, string>;
let server: http.Server;
let baseUrl: string;

const LINEAS = [
  { descripcion: 'Torneado de eje', cantidad: '10', precio_unitario: '12.50' },
  { descripcion: 'Acabado superficial', cantidad: '2.5', precio_unitario: '10.00' },
];

beforeAll(async () => {
  if (!disponible) return;
  reiniciarCacheEsquemaCotizaciones();
  await pool.query(`INSERT INTO roles (id, nombre) VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO') ON CONFLICT (nombre) DO NOTHING`);
  for (const rol of ['ADMIN', 'COMERCIAL', 'OPERATIVO'] as const) {
    const r = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [rol]);
    const u = await pool.query<{ id: string }>(
      `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id) VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
      [`Prueba lineas ${rol}`, `lineas.${rol.toLowerCase()}.${randomUUID()}@nextproject-test.local`, r.rows[0].id]
    );
    ids[rol] = u.rows[0].id;
    tokens[rol] = jwt.sign({ sub: ids[rol], rol }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
  }
  const app = express();
  app.use(express.json());
  app.use('/api/cotizaciones', cotizacionesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function solicitudNueva(): Promise<string> {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba lineas cotizacion',
      empresa: null,
      email: `lineas.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio lineas',
      descripcion: 'Registro ficticio de integracion (lineas de detalle).',
      cantidad: 1,
    },
    `lineas-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  return s.solicitud.id;
}

async function http_(clave: Rol | null, metodo: string, ruta: string, cuerpo?: unknown) {
  const res = await fetch(`${baseUrl}${ruta}`, {
    method: metodo,
    headers: { ...(clave ? { Authorization: `Bearer ${tokens[clave]}` } : {}), 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

describe.skipIf(!disponible)('líneas de detalle: creación y edición (HTTP y base de datos reales)', () => {
  beforeEach(() => reiniciarCacheEsquemaCotizaciones());

  it('crea por HTTP con líneas: guarda importes derivados y líneas exactas; el cliente no controla los importes', async () => {
    const sol = await solicitudNueva();
    const r = await http_('COMERCIAL', 'POST', '/api/cotizaciones', { solicitud_id: sol, items: LINEAS, anticipo_porcentaje: 50, metodo_anticipo: 'TRANSFERENCIA' });
    expect(r.status).toBe(201);
    expect(r.json.cotizacion).toMatchObject({ valor: '150.00', subtotal: '150.00', iva_valor: '22.50', total: '172.50', anticipo_valor: '86.25', saldo_pendiente: '86.25', estado: 'BORRADOR' });
    expect(r.json.items.map((i: any) => [i.descripcion, i.cantidad, i.precio_unitario, i.subtotal])).toEqual([
      ['Torneado de eje', '10.000', '12.50', '125.00'],
      ['Acabado superficial', '2.500', '10.00', '25.00'],
    ]);
    const suma = await pool.query(`SELECT SUM(subtotal) AS s FROM cotizacion_items WHERE cotizacion_id = $1`, [r.json.cotizacion.id]);
    expect(Number(suma.rows[0].s)).toBe(150);
  });

  it('con las líneas disponibles, crear o editar sin items se rechaza; valor e items juntos también', async () => {
    const sol = await solicitudNueva();
    expect((await http_('COMERCIAL', 'POST', '/api/cotizaciones', { solicitud_id: sol, valor: 100 })).status).toBe(400);
    expect((await http_('COMERCIAL', 'POST', '/api/cotizaciones', { solicitud_id: sol, valor: 100, items: LINEAS })).status).toBe(400);
    const creada = await http_('COMERCIAL', 'POST', '/api/cotizaciones', { solicitud_id: sol, items: LINEAS, anticipo_porcentaje: 0 });
    expect((await http_('COMERCIAL', 'PATCH', `/api/cotizaciones/${creada.json.cotizacion.id}`, { valor: 100 })).status).toBe(400);
    const mala = await http_('COMERCIAL', 'POST', '/api/cotizaciones', { solicitud_id: await solicitudNueva(), items: [{ descripcion: '', cantidad: 0, precio_unitario: -1 }] });
    expect(mala.status).toBe(400);
    expect(mala.json.detalles.length).toBeGreaterThanOrEqual(3);
  });

  it('el redondeo coincide con la restricción de la base: 2,675 × 1,00 = 2,68 (con coma flotante habría sido 2,67)', async () => {
    const sol = await solicitudNueva();
    const r = await http_('COMERCIAL', 'POST', '/api/cotizaciones', { solicitud_id: sol, items: [{ descripcion: 'Medio centavo', cantidad: '2.675', precio_unitario: '1.00' }], anticipo_porcentaje: 0 });
    expect(r.status).toBe(201);
    expect(r.json.items[0].subtotal).toBe('2.68');
    expect(r.json.cotizacion.subtotal).toBe('2.68');
  });

  it('la base rechaza una línea cuyo subtotal no coincide con cantidad × precio, o con cantidad cero', async () => {
    const sol = await solicitudNueva();
    const cot = await crearCotizacion({ solicitudId: sol, lineas: LINEAS, descripcion: null, creadoPor: ids.COMERCIAL, anticipoPorcentaje: 0 });
    const intento = (cant: string, precio: string, subtotal: string) =>
      pool.query(
        `INSERT INTO cotizacion_items (cotizacion_id, orden, descripcion, descripcion_normalizada, cantidad, precio_unitario, subtotal) VALUES ($1, 9, 'x', 'x', $2, $3, $4)`,
        [cot.id, cant, precio, subtotal]
      );
    await expect(intento('1', '10.00', '9.99')).rejects.toThrow();
    await expect(intento('0', '10.00', '0.00')).rejects.toThrow();
    await expect(intento('1', '-1.00', '-1.00')).rejects.toThrow();
  });

  it('editar un borrador reemplaza las líneas, recalcula los importes y reinicia la vigencia', async () => {
    const sol = await solicitudNueva();
    const creada = await http_('COMERCIAL', 'POST', '/api/cotizaciones', { solicitud_id: sol, items: LINEAS, anticipo_porcentaje: 0, dias_vigencia: 15 });
    const id = creada.json.cotizacion.id;
    await pool.query(`UPDATE cotizaciones SET fecha_vigencia = now() + interval '1 day' WHERE id = $1`, [id]);
    const e = await http_('COMERCIAL', 'PATCH', `/api/cotizaciones/${id}`, { items: [{ descripcion: 'Fresado', cantidad: 4, precio_unitario: 25 }], anticipo_porcentaje: 0, dias_vigencia: 30 });
    expect(e.status).toBe(200);
    expect(e.json.items.map((i: any) => i.descripcion)).toEqual(['Fresado']);
    expect(e.json.cotizacion).toMatchObject({ subtotal: '100.00', iva_valor: '15.00', total: '115.00' });
    const dias = await pool.query(`SELECT EXTRACT(EPOCH FROM (fecha_vigencia - now())) / 86400 AS d FROM cotizaciones WHERE id = $1`, [id]);
    expect(Number(dias.rows[0].d)).toBeGreaterThan(29); // la vigencia se reinició
  });

  it('desde ENVIADA las líneas son inmutables: el backend rechaza editar y la base rechaza INSERT, UPDATE y DELETE', async () => {
    const sol = await solicitudNueva();
    const creada = await http_('COMERCIAL', 'POST', '/api/cotizaciones', { solicitud_id: sol, items: LINEAS, anticipo_porcentaje: 0 });
    const id = creada.json.cotizacion.id;
    await cambiarEstadoCotizacion(id, 'ENVIADA');
    const e = await http_('COMERCIAL', 'PATCH', `/api/cotizaciones/${id}`, { items: LINEAS });
    expect(e.status).toBe(409);
    await expect(pool.query(`UPDATE cotizacion_items SET cantidad = 99, subtotal = 1237.50 WHERE cotizacion_id = $1`, [id])).rejects.toThrow(/BORRADOR/);
    await expect(pool.query(`DELETE FROM cotizacion_items WHERE cotizacion_id = $1`, [id])).rejects.toThrow(/BORRADOR/);
    await expect(
      pool.query(`INSERT INTO cotizacion_items (cotizacion_id, orden, descripcion, descripcion_normalizada, cantidad, precio_unitario, subtotal) VALUES ($1, 5, 'x', 'x', 1, 1, 1)`, [id])
    ).rejects.toThrow(/BORRADOR/);
    expect((await obtenerLineasDeCotizacion(id)).map((i) => i.subtotal)).toEqual(['125.00', '25.00']); // intactas
  });
});

describe.skipIf(!disponible)('líneas de detalle: concurrencia entre editar y enviar', () => {
  async function borrador(): Promise<string> {
    const cot = await crearCotizacion({ solicitudId: await solicitudNueva(), lineas: LINEAS, descripcion: null, creadoPor: ids.COMERCIAL, anticipoPorcentaje: 0 });
    return cot.id;
  }

  it('si el ENVÍO gana, la edición posterior se rechaza y las líneas no cambian', async () => {
    const id = await borrador();
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`UPDATE cotizaciones SET estado = 'ENVIADA' WHERE id = $1`, [id]); // envío en curso, sin confirmar
      let termino = false;
      const edicion = editarCotizacionBorrador(id, { lineas: [{ descripcion: 'Otra', cantidad: 1, precio_unitario: 1 }], descripcion: null, anticipoPorcentaje: 0 }).then(
        () => ((termino = true), 'EDITADA'),
        (e: unknown) => ((termino = true), e instanceof CotizacionNoEditableError ? 'RECHAZADA' : Promise.reject(e))
      );
      await new Promise((r) => setTimeout(r, 400));
      expect(termino).toBe(false); // la edición espera al envío (bloqueo de la fila)
      await holder.query('COMMIT');
      expect(await edicion).toBe('RECHAZADA');
    } finally {
      holder.release();
    }
    expect((await obtenerLineasDeCotizacion(id)).map((i) => i.descripcion)).toEqual(['Torneado de eje', 'Acabado superficial']);
  });

  it('si la EDICIÓN gana, el envío espera y la cotización enviada tiene exactamente las líneas nuevas, coherentes con sus importes', async () => {
    const id = await borrador();
    const holder = await pool.connect();
    let envio: Promise<unknown>;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT estado FROM cotizaciones WHERE id = $1 FOR UPDATE', [id]); // edición en curso
      let termino = false;
      envio = cambiarEstadoCotizacion(id, 'ENVIADA').then((r) => ((termino = true), r));
      await new Promise((r) => setTimeout(r, 400));
      expect(termino).toBe(false); // el envío espera a la edición
      await itemsRepo.reemplazar(holder, id, [{ orden: 1, descripcion: 'Línea nueva', cantidad: '3.000', precioUnitario: '7.00', subtotal: '21.00' }]);
      await holder.query(`UPDATE cotizaciones SET valor = 21, subtotal = 21, iva_valor = 3.15, total = 24.15, anticipo_valor = 0, saldo_pendiente = 24.15 WHERE id = $1`, [id]);
      await holder.query('COMMIT');
    } finally {
      holder.release();
    }
    await envio!;
    const fila = await pool.query(`SELECT estado, subtotal FROM cotizaciones WHERE id = $1`, [id]);
    expect(fila.rows[0].estado).toBe('ENVIADA');
    const lineas = await obtenerLineasDeCotizacion(id);
    expect(lineas.map((i) => i.descripcion)).toEqual(['Línea nueva']);
    expect(lineas.reduce((n, i) => n + Number(i.subtotal), 0)).toBe(Number(fila.rows[0].subtotal));
  });
});

describe.skipIf(!disponible)('líneas de detalle: permisos por rol', () => {
  it('sin sesión 401; OPERATIVO 403 (crear, editar y buscador); COMERCIAL y ADMIN autorizados como el resto del módulo', async () => {
    const sol = await solicitudNueva();
    const cuerpo = { solicitud_id: sol, items: LINEAS, anticipo_porcentaje: 0 };
    expect((await http_(null, 'POST', '/api/cotizaciones', cuerpo)).status).toBe(401);
    expect((await http_('OPERATIVO', 'POST', '/api/cotizaciones', cuerpo)).status).toBe(403);
    expect((await http_(null, 'GET', '/api/cotizaciones/items/sugerencias?q=torneado')).status).toBe(401);
    expect((await http_('OPERATIVO', 'GET', '/api/cotizaciones/items/sugerencias?q=torneado')).status).toBe(403);
    const creada = await http_('COMERCIAL', 'POST', '/api/cotizaciones', cuerpo);
    expect(creada.status).toBe(201);
    expect((await http_('OPERATIVO', 'PATCH', `/api/cotizaciones/${creada.json.cotizacion.id}`, { items: LINEAS })).status).toBe(403);
    expect((await http_('ADMIN', 'GET', `/api/cotizaciones/${creada.json.cotizacion.id}`)).json.items).toHaveLength(2);
    expect((await http_('ADMIN', 'GET', '/api/cotizaciones/items/sugerencias?q=torneado')).status).toBe(200);
  });
});

describe.skipIf(!disponible)('líneas de detalle: buscador de conceptos y búsqueda global', () => {
  it('sugiere conceptos de cotizaciones ENVIADA/ACEPTADA/RECHAZADA/VENCIDA (nunca borradores ni canceladas), compartidos entre roles', async () => {
    const marca = `Concepto-${randomUUID().slice(0, 8)}`;
    const nueva = async (estado: string | null) => {
      const cot = await crearCotizacion({ solicitudId: await solicitudNueva(), lineas: [{ descripcion: `${marca} ${estado ?? 'BORRADOR'}`, cantidad: 1, precio_unitario: 33.5 }], descripcion: null, creadoPor: ids.COMERCIAL, anticipoPorcentaje: 0 });
      if (estado === 'ENVIADA') await cambiarEstadoCotizacion(cot.id, 'ENVIADA');
      if (estado === 'CANCELADA') await cambiarEstadoCotizacion(cot.id, 'CANCELADA');
      if (estado === 'VENCIDA') {
        await cambiarEstadoCotizacion(cot.id, 'ENVIADA');
        await cambiarEstadoCotizacion(cot.id, 'VENCIDA');
      }
      return cot.id;
    };
    await nueva(null);
    await nueva('CANCELADA');
    await nueva('ENVIADA');
    await nueva('VENCIDA');
    const comercial = await http_('COMERCIAL', 'GET', `/api/cotizaciones/items/sugerencias?q=${encodeURIComponent(marca.toLowerCase())}`);
    expect(comercial.status).toBe(200);
    expect(comercial.json.disponible).toBe(true);
    expect(comercial.json.sugerencias.map((s: any) => s.descripcion).sort()).toEqual([`${marca} ENVIADA`, `${marca} VENCIDA`]);
    expect(comercial.json.sugerencias[0]).toMatchObject({ ultimo_precio_unitario: '33.50', veces_usado: 1 });
    const admin = await http_('ADMIN', 'GET', `/api/cotizaciones/items/sugerencias?q=${encodeURIComponent(marca)}`);
    expect(admin.json.sugerencias).toHaveLength(2); // compartido
    expect((await http_('COMERCIAL', 'GET', '/api/cotizaciones/items/sugerencias?q=a')).json.sugerencias).toEqual([]); // menos de 2 caracteres
  });

  it('la búsqueda global de cotizaciones también encuentra por descripción de línea (sin tildes ni mayúsculas)', async () => {
    const marca = `Rectificado${randomUUID().slice(0, 6)}`;
    const cot = await crearCotizacion({ solicitudId: await solicitudNueva(), lineas: [{ descripcion: `${marca} de cigüeñal`, cantidad: 1, precio_unitario: 10 }], descripcion: null, creadoPor: ids.COMERCIAL, anticipoPorcentaje: 0 });
    reiniciarCacheEsquemaCotizaciones();
    expect(await buscarIds('cotizaciones', `${marca.toUpperCase()} DE CIGUENAL`, { sub: ids.COMERCIAL, rol: 'COMERCIAL' })).toContain(cot.id);
    expect(await buscarIds('cotizaciones', `${marca} inexistente`, { sub: ids.COMERCIAL, rol: 'COMERCIAL' })).not.toContain(cot.id);
  });
});

describe.skipIf(!disponible)('cotizaciones históricas: conservan sus importes sin modificaciones automáticas', () => {
  it('una cotización creada con el camino anterior (valor) no gana líneas, conserva todos sus importes y se lee con items vacíos', async () => {
    const cot = await crearCotizacion({ solicitudId: await solicitudNueva(), valor: 300, descripcion: 'histórica', creadoPor: ids.COMERCIAL, anticipoPorcentaje: 50, metodoAnticipo: 'EFECTIVO' });
    const antes = (await pool.query(`SELECT * FROM cotizaciones WHERE id = $1`, [cot.id])).rows[0];
    expect(await obtenerLineasDeCotizacion(cot.id)).toEqual([]);
    const detalle = await http_('COMERCIAL', 'GET', `/api/cotizaciones/${cot.id}`);
    expect(detalle.json.items).toEqual([]);
    expect(detalle.json.cotizacion).toMatchObject({ valor: '300.00', subtotal: '300.00', iva_valor: '45.00', total: '345.00', anticipo_valor: '172.50', saldo_pendiente: '172.50' });
    const despues = (await pool.query(`SELECT * FROM cotizaciones WHERE id = $1`, [cot.id])).rows[0];
    expect(despues).toEqual(antes); // nada se modificó al leerla
    expect((await pool.query(`SELECT count(*)::int n FROM cotizacion_items WHERE cotizacion_id = $1`, [cot.id])).rows[0].n).toBe(0);
  });

  it('un borrador histórico sin líneas solo gana líneas cuando el usuario confirma la edición con líneas', async () => {
    const cot = await crearCotizacion({ solicitudId: await solicitudNueva(), valor: 200, descripcion: null, creadoPor: ids.COMERCIAL, anticipoPorcentaje: 0 });
    await http_('COMERCIAL', 'GET', `/api/cotizaciones/${cot.id}`);
    expect(await obtenerLineasDeCotizacion(cot.id)).toEqual([]);
    const e = await http_('COMERCIAL', 'PATCH', `/api/cotizaciones/${cot.id}`, { items: [{ descripcion: 'Servicio', cantidad: 1, precio_unitario: 200 }], anticipo_porcentaje: 0 });
    expect(e.status).toBe(200);
    expect(e.json.items).toHaveLength(1);
    expect(e.json.cotizacion.total).toBe('230.00');
  });

  it('pagos, anticipos y saldos usan los importes derivados de las líneas ya guardados', async () => {
    const cot = await crearCotizacion({ solicitudId: await solicitudNueva(), lineas: LINEAS, descripcion: null, creadoPor: ids.COMERCIAL, anticipoPorcentaje: 75, metodoAnticipo: 'TRANSFERENCIA' });
    const fila = (await pool.query(`SELECT total, anticipo_valor, saldo_pendiente, estado_anticipo FROM cotizaciones WHERE id = $1`, [cot.id])).rows[0];
    expect(Number(fila.total)).toBe(172.5);
    expect(Number(fila.anticipo_valor)).toBe(129.38); // round2(172,50 × 0,75) como siempre
    expect(Number(fila.anticipo_valor) + Number(fila.saldo_pendiente)).toBeCloseTo(172.5, 2);
    expect(fila.estado_anticipo).toBe('PENDIENTE');
  });
});
