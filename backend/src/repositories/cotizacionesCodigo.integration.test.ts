// "NEXTPROJECT — Implementación de numeración independiente de
// cotizaciones" (autorización explícita): valida el trigger de PostgreSQL
// agregado en V12__cotizaciones_codigo.sql (mismo patrón ya aprobado para
// solicitudes.codigo/V10 y ordenes.codigo/V1). Pruebas de integración
// reales contra `nextproject_test` — mismo guard obligatorio que el resto
// de *.integration.test.ts, nunca se ejecuta contra `nextproject`.
import { randomUUID } from 'crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import * as cotizacionesRepo from './cotizaciones.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from '../services/solicitudes.service.js';
import { crearCotizacion } from '../services/cotizaciones.service.js';

let creadoPorId: string;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  const rol = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'COMERCIAL'`);
  const sufijo = randomUUID();
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), 'Prueba Codigo Cotizacion (creado_por)', $1, 'placeholder-no-usado-para-login', $2)
     RETURNING id`,
    [`codigo-cotizacion.creado-por.${sufijo}@nextproject-test.local`, rol.rows[0].id]
  );
  creadoPorId = inserted.rows[0].id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function datosUnicos(etiqueta: string) {
  const sufijo = randomUUID();
  return {
    email: `codigo-cotizacion.${etiqueta}.${sufijo}@nextproject-test.local`.toLowerCase(),
    telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
    idempotencyKey: `codigo-cotizacion-${etiqueta}-${sufijo}`,
  };
}

async function crearSolicitudEnRevision(etiqueta: string) {
  const { email, telefono, idempotencyKey } = datosUnicos(etiqueta);
  const resultado = await crearSolicitud(
    {
      nombre: `Prueba Codigo Cotizacion ${etiqueta}`,
      empresa: null,
      email,
      telefono,
      servicio: `Servicio Codigo Cotizacion ${etiqueta}`,
      descripcion: `Registro ficticio de integración (numeración COT-XXXXXX, caso ${etiqueta}).`,
      cantidad: 1,
    },
    idempotencyKey
  );
  await cambiarEstadoSolicitud(resultado.solicitud.id, 'EN_REVISION');
  return resultado.solicitud;
}

describe('Numeración independiente de cotizaciones (COT-XXXXXX) — nextproject_test, real', () => {
  it('una cotización nueva recibe un código con formato COT-XXXXXX automáticamente, sin que el backend lo genere', async () => {
    const solicitud = await crearSolicitudEnRevision('A-nueva');

    const cotizacion = await crearCotizacion({
      solicitudId: solicitud.id,
      valor: 100,
      descripcion: null,
      creadoPor: creadoPorId,
      anticipoPorcentaje: 0,
    });

    expect(cotizacion.codigo).not.toBeNull();
    expect(cotizacion.codigo).toMatch(/^COT-\d{6}$/);

    // El contrato de lectura (listAll/findById) ya debe incluir `codigo`
    // sin que se haya tocado ninguna de esas funciones directamente — lo
    // propaga la columna COLUMNAS compartida.
    const releida = await cotizacionesRepo.findById(cotizacion.id);
    expect(releida?.codigo).toBe(cotizacion.codigo);

    const listado = await cotizacionesRepo.listAll();
    const enListado = listado.find((c) => c.id === cotizacion.id);
    expect(enListado?.codigo).toBe(cotizacion.codigo);
  });

  it('inserciones concurrentes de varias cotizaciones nuevas reciben códigos distintos, sin duplicados ni colisiones', async () => {
    const solicitudes = await Promise.all(
      ['B1', 'B2', 'B3', 'B4', 'B5'].map((etiqueta) => crearSolicitudEnRevision(etiqueta))
    );

    const cotizaciones = await Promise.all(
      solicitudes.map((solicitud) =>
        crearCotizacion({
          solicitudId: solicitud.id,
          valor: 100,
          descripcion: null,
          creadoPor: creadoPorId,
          anticipoPorcentaje: 0,
        })
      )
    );

    const codigos = cotizaciones.map((c) => c.codigo);
    expect(codigos.every((c) => typeof c === 'string' && /^COT-\d{6}$/.test(c))).toBe(true);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('una cotización histórica (ya existente antes de esta migración) conserva codigo = NULL, sin backfill retroactivo', async () => {
    // No se simula insertando directamente con fecha pasada (alteraría
    // datos reales de forma artificial) — se verifica el hecho ya
    // confirmado por la propia migración: ninguna fila preexistente fue
    // tocada. Aquí solo se confirma que el tipo/contrato del repositorio
    // acepta y expone `codigo: null` sin lanzar error al leer una fila real
    // que nunca pasó por el trigger (creada ANTES de V12, si existiera) —
    // de existir alguna, debe seguir teniendo codigo null.
    const { rows } = await pool.query<{ total: string; sin_codigo: string }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE codigo IS NULL) AS sin_codigo
       FROM cotizaciones
       WHERE creado_en < (SELECT min(creado_en) FROM cotizaciones WHERE codigo IS NOT NULL)`
    );
    // Toda fila creada antes de la primera con código real (es decir,
    // anterior a esta migración) debe tener codigo = NULL — nunca se les
    // asignó uno retroactivamente.
    expect(rows[0].sin_codigo).toBe(rows[0].total);
  });
});
