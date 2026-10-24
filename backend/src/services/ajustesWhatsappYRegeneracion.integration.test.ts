// "Autorización de dos ajustes puntuales" (autorización explícita):
// A) WhatsApp en el correo de enlace de cotización disponible.
// B) Regeneración manual del código de acceso para cotizaciones ACEPTADAS.
// Pruebas de integración reales contra `nextproject_test`. Mismo guard
// obligatorio que el resto de *.integration.test.ts; nunca se ejecuta
// contra `nextproject`. Nunca se llama a Brevo real: `global.fetch` se
// intercepta puntualmente.
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import { requireRole } from '../middleware/auth.middleware.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import {
  crearCotizacion,
  cambiarEstadoCotizacion,
  generarEnlaceCotizacion,
  aceptarCotizacionPublica,
  rechazarCotizacionPublica,
  verificarCodigoCotizacion,
  CotizacionNoDisponibleError,
} from './cotizaciones.service.js';
import { generarEnlaceController } from '../controllers/cotizaciones.controller.js';

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
     VALUES (gen_random_uuid(), 'Prueba Ajustes (creado_por)', $1, 'placeholder-no-usado-para-login', $2)
     RETURNING id`,
    [`ajustes.creado-por.${sufijo}@nextproject-test.local`, rol.rows[0].id]
  );
  creadoPorId = inserted.rows[0].id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function datosUnicos(etiqueta: string) {
  const sufijo = randomUUID();
  return {
    email: `ajustes.${etiqueta}.${sufijo}@nextproject-test.local`.toLowerCase(),
    telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
    idempotencyKey: `ajustes-${etiqueta}-${sufijo}`,
  };
}

async function crearCotizacionEnviada(etiqueta: string) {
  const { email, telefono, idempotencyKey } = datosUnicos(etiqueta);
  const resultado = await crearSolicitud(
    {
      nombre: `Prueba Ajustes ${etiqueta}`,
      empresa: null,
      email,
      telefono,
      servicio: `Servicio Ajustes ${etiqueta}`,
      descripcion: `Registro ficticio de integración (Ajustes, caso ${etiqueta}).`,
      cantidad: 1,
    },
    idempotencyKey
  );
  await cambiarEstadoSolicitud(resultado.solicitud.id, 'EN_REVISION');
  const cotizacion = await crearCotizacion({
    solicitudId: resultado.solicitud.id,
    valor: 100,
    descripcion: null,
    creadoPor: creadoPorId,
    anticipoPorcentaje: 0,
  });
  return { solicitud: resultado.solicitud, cotizacion, clienteEmail: email };
}

function mockFetchExitoso() {
  return vi.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ messageId: 'msg-ajustes' }), { status: 201 }));
}

describe('Ajuste A — WhatsApp en el correo de enlace de cotización disponible (nextproject_test, real)', () => {
  it('el correo de enlace disponible incluye el enlace oficial de WhatsApp, sin el código de acceso dentro de él', async () => {
    const fetchSpy = mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('A1');
    await cambiarEstadoCotizacion(cotizacion.id, 'ENVIADA');

    const { codigo } = await generarEnlaceCotizacion(cotizacion.id);

    // generarEnlaceCotizacion() en sí no envía correo -- lo hace el
    // controller, que es el punto real donde se ejercita
    // enviarEnlaceCotizacion(). Se invoca aquí para capturar el cuerpo real.
    const { res, estado } = (() => {
      const estadoLocal: { status: number; body: unknown } = { status: 0, body: undefined };
      const resLocal = {
        status(c: number) {
          estadoLocal.status = c;
          return resLocal;
        },
        json(p: unknown) {
          estadoLocal.body = p;
          return resLocal;
        },
      } as unknown as Response;
      return { res: resLocal, estado: estadoLocal };
    })();
    await generarEnlaceController({ params: { id: cotizacion.id } } as unknown as Request, res);
    expect(estado.status).toBe(201);

    const ultimaLlamada = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    const cuerpo = JSON.parse((ultimaLlamada[1] as { body: string }).body) as { textContent: string };
    expect(cuerpo.textContent).toContain('https://wa.me/');
    const enlaceMatch = cuerpo.textContent.match(/https:\/\/wa\.me\/\S+/);
    expect(enlaceMatch).not.toBeNull();
    expect(enlaceMatch?.[0]).not.toContain(codigo);
  });
});

describe('Ajuste B — regeneración manual del código para cotizaciones ACEPTADAS (nextproject_test, real)', () => {
  it('sigue funcionando para ENVIADA (regresión, sin cambios)', async () => {
    const { cotizacion } = await crearCotizacionEnviada('B-ENVIADA');
    await cambiarEstadoCotizacion(cotizacion.id, 'ENVIADA');
    const { codigo } = await generarEnlaceCotizacion(cotizacion.id);
    expect(codigo).toMatch(/^\d{6}$/);
  });

  it('nueva capacidad: funciona para ACEPTADA sin alterar estado, valor, anticipo, saldo ni comprobantes, y sin crear órdenes', async () => {
    const { cotizacion } = await crearCotizacionEnviada('B-ACEPTADA');
    await cambiarEstadoCotizacion(cotizacion.id, 'ENVIADA');
    const { token: tokenAceptacion, codigo: codigoAceptacion } = await generarEnlaceCotizacion(cotizacion.id);
    await aceptarCotizacionPublica(tokenAceptacion, codigoAceptacion);

    const antes = await cotizacionesRepo.findById(cotizacion.id);
    expect(antes?.estado).toBe('ACEPTADA');
    const ordenesAntes = await pool.query('SELECT id FROM ordenes WHERE cotizacion_id = $1', [cotizacion.id]);
    const totalOrdenesAntes = ordenesAntes.rowCount ?? 0;

    const { token: tokenNuevo, codigo: codigoNuevo } = await generarEnlaceCotizacion(cotizacion.id);

    const despues = await cotizacionesRepo.findById(cotizacion.id);
    expect(despues?.estado).toBe(antes?.estado);
    expect(despues?.valor).toBe(antes?.valor);
    expect(despues?.anticipo_valor).toBe(antes?.anticipo_valor);
    expect(despues?.anticipo_porcentaje).toBe(antes?.anticipo_porcentaje);
    expect(despues?.estado_anticipo).toBe(antes?.estado_anticipo);
    expect(despues?.saldo_pendiente).toBe(antes?.saldo_pendiente);
    expect(despues?.estado_saldo).toBe(antes?.estado_saldo);
    expect(despues?.comprobante_recibido).toBe(antes?.comprobante_recibido);

    // El código nuevo funciona de verdad (extremo a extremo).
    const publicaConCodigoNuevo = await verificarCodigoCotizacion(tokenNuevo, codigoNuevo);
    expect(publicaConCodigoNuevo.id).toBe(cotizacion.id);

    // generarEnlaceCotizacion() no crea ni modifica ninguna orden: el
    // conteo de órdenes de esta cotización debe ser IDÉNTICO antes y
    // después de regenerar el código (NO_APLICA ya intentó crear una
    // automáticamente al ACEPTAR -- falla por falta de OPERATIVO
    // configurado en nextproject_test, comportamiento ya conocido de fases
    // previas y ajeno a esta prueba; lo que se verifica aquí es que la
    // REGENERACIÓN en sí no agrega ni quita ninguna).
    const ordenesDespues = await pool.query('SELECT id FROM ordenes WHERE cotizacion_id = $1', [cotizacion.id]);
    expect(ordenesDespues.rowCount ?? 0).toBe(totalOrdenesAntes);
  });

  it('sigue bloqueada para BORRADOR, RECHAZADA, VENCIDA y CANCELADA', async () => {
    // BORRADOR: nunca se envía.
    const { cotizacion: cotBorrador } = await crearCotizacionEnviada('B-BORRADOR');
    await expect(generarEnlaceCotizacion(cotBorrador.id)).rejects.toBeInstanceOf(CotizacionNoDisponibleError);

    // RECHAZADA.
    const { cotizacion: cotRechazada } = await crearCotizacionEnviada('B-RECHAZADA');
    await cambiarEstadoCotizacion(cotRechazada.id, 'ENVIADA');
    const { token: tokenR, codigo: codigoR } = await generarEnlaceCotizacion(cotRechazada.id);
    await rechazarCotizacionPublica(tokenR, codigoR);
    await expect(generarEnlaceCotizacion(cotRechazada.id)).rejects.toBeInstanceOf(CotizacionNoDisponibleError);

    // VENCIDA (fixture directa, no se ejercita el vencimiento perezoso real).
    const { cotizacion: cotVencida } = await crearCotizacionEnviada('B-VENCIDA');
    await cambiarEstadoCotizacion(cotVencida.id, 'ENVIADA');
    await pool.query(`UPDATE cotizaciones SET estado = 'VENCIDA' WHERE id = $1`, [cotVencida.id]);
    await expect(generarEnlaceCotizacion(cotVencida.id)).rejects.toBeInstanceOf(CotizacionNoDisponibleError);

    // CANCELADA.
    const { cotizacion: cotCancelada } = await crearCotizacionEnviada('B-CANCELADA');
    await cambiarEstadoCotizacion(cotCancelada.id, 'CANCELADA');
    await expect(generarEnlaceCotizacion(cotCancelada.id)).rejects.toBeInstanceOf(CotizacionNoDisponibleError);
  });

  it('permisos: requireRole(ADMIN,COMERCIAL), la misma ruta ya existente, rechaza a OPERATIVO sin llegar a next()', async () => {
    const middleware = requireRole('ADMIN', 'COMERCIAL');
    let siguienteLlamado = false;
    const next: NextFunction = () => {
      siguienteLlamado = true;
    };
    const estado: { status: number; body: unknown } = { status: 0, body: undefined };
    const res = {
      status(c: number) {
        estado.status = c;
        return res;
      },
      json(p: unknown) {
        estado.body = p;
        return res;
      },
    } as unknown as Response;

    const reqOperativo = { user: { sub: 'x', rol: 'OPERATIVO' } } as unknown as Request;
    middleware(reqOperativo, res, next);
    expect(estado.status).toBe(403);
    expect(siguienteLlamado).toBe(false);

    const reqComercial = { user: { sub: 'y', rol: 'COMERCIAL' } } as unknown as Request;
    middleware(reqComercial, res, next);
    expect(siguienteLlamado).toBe(true);
  });
});
