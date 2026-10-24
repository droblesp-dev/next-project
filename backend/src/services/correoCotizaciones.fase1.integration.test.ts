// Fase 1 (autorización explícita — "Implementación Fase 1: envío
// automático de cotizaciones por correo") — pruebas de integración reales
// contra `nextproject_test`. Mismo guard obligatorio que el resto de
// *.integration.test.ts; nunca se ejecuta contra `nextproject`.
//
// Nunca se llama a la Brevo real: `global.fetch` se intercepta de forma
// puntual (vi.spyOn + mockRestore en cada prueba) para simular cada
// resultado (éxito, fallo HTTP, error de red) de forma determinista y sin
// depender de credenciales reales ni de la disponibilidad de Brevo. Todo
// lo demás (BD, servicio, controlador, repositorio) es código real.
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import * as clientesRepo from '../repositories/clientes.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import { crearCotizacion, cambiarEstadoCotizacion } from './cotizaciones.service.js';
import { generarEnlaceController } from '../controllers/cotizaciones.controller.js';
import { enviarConfirmacionSolicitud } from './email.service.js';

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
     VALUES (gen_random_uuid(), 'Prueba Fase1 (creado_por)', $1, 'placeholder-no-usado-para-login', $2)
     RETURNING id`,
    [`fase1.creado-por.${sufijo}@nextproject-test.local`, rol.rows[0].id]
  );
  creadoPorId = inserted.rows[0].id;
});

function datosUnicos(etiqueta: string) {
  const sufijo = randomUUID();
  return {
    email: `fase1.${etiqueta}.${sufijo}@nextproject-test.local`.toLowerCase(),
    telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
    idempotencyKey: `fase1-${etiqueta}-${sufijo}`,
  };
}

// Construye solicitud + cliente + cotización ENVIADA, reutilizando las
// funciones reales de servicio (mismo patrón ya usado en los archivos de
// prueba de C2/C2.2). `emailCliente` opcional: si se pasa, se crea el
// cliente directamente por repositorio (bypass de crearSolicitud) para
// poder fijar un email vacío — el único caso que crearSolicitud() no
// permite construir, porque siempre normaliza un email no vacío recibido.
async function crearCotizacionEnviada(etiqueta: string, emailClienteVacio = false) {
  if (emailClienteVacio) {
    const { telefono } = datosUnicos(etiqueta);
    const cliente = await clientesRepo.create(pool, {
      nombre: `Prueba Fase1 ${etiqueta}`,
      empresa: null,
      email: '',
      telefono,
    });
    const solicitud = await solicitudesRepo.create(pool, {
      clienteId: cliente.id,
      servicio: `Servicio Fase1 ${etiqueta}`,
      descripcion: `Registro ficticio de integración (Fase1, caso ${etiqueta}).`,
      cantidad: 1,
      fechaRequerida: null,
    });
    await cambiarEstadoSolicitud(solicitud.id, 'EN_REVISION');
    const cotizacion = await crearCotizacion({
      solicitudId: solicitud.id,
      valor: 100,
      descripcion: null,
      creadoPor: creadoPorId,
      anticipoPorcentaje: 0,
    });
    const enviada = await cambiarEstadoCotizacion(cotizacion.id, 'ENVIADA');
    return { solicitud, cotizacion: enviada, clienteEmail: '' };
  }

  const { email, telefono, idempotencyKey } = datosUnicos(etiqueta);
  const resultado = await crearSolicitud(
    {
      nombre: `Prueba Fase1 ${etiqueta}`,
      empresa: null,
      email,
      telefono,
      servicio: `Servicio Fase1 ${etiqueta}`,
      descripcion: `Registro ficticio de integración (Fase1, caso ${etiqueta}).`,
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
  const enviada = await cambiarEstadoCotizacion(cotizacion.id, 'ENVIADA');
  return { solicitud: resultado.solicitud, cotizacion: enviada, clienteEmail: email };
}

// Fake mínimo de Response de Express — captura status/body sin levantar
// ningún servidor HTTP real. El controlador real (generarEnlaceController)
// se invoca tal cual.
function crearRespuestaFake() {
  const estado: { status: number; body: unknown } = { status: 0, body: undefined };
  const res = {
    status(codigo: number) {
      estado.status = codigo;
      return res;
    },
    json(payload: unknown) {
      estado.body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, estado };
}

describe('Fase 1 — envío automático del enlace de cotización por correo (nextproject_test, real)', () => {
  it('1) envío exitoso: emailEnviado=sent y el correo real se dirige al cliente correcto', async () => {
    const { cotizacion, clienteEmail } = await crearCotizacionEnviada('T1');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cuerpoEnviado: any = null;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementationOnce(async (_url, opciones) => {
      cuerpoEnviado = JSON.parse((opciones as { body: string }).body);
      return new Response(JSON.stringify({ messageId: 'msg-fase1-t1' }), { status: 201 });
    });

    try {
      const { res, estado } = crearRespuestaFake();
      await generarEnlaceController({ params: { id: cotizacion.id } } as unknown as Request, res);

      expect(estado.status).toBe(201);
      expect((estado.body as { emailEnviado?: string }).emailEnviado).toBe('sent');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(cuerpoEnviado?.to?.[0]?.email).toBe(clienteEmail);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('2) Brevo responde con error HTTP: el enlace sigue siendo válido y el resultado se informa como "failed"', async () => {
    const { cotizacion } = await crearCotizacionEnviada('T2');

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Solicitud inválida' }), { status: 400 }));

    let tokenGenerado: string | undefined;
    try {
      const { res, estado } = crearRespuestaFake();
      await generarEnlaceController({ params: { id: cotizacion.id } } as unknown as Request, res);

      const body = estado.body as { token?: string; codigo?: string; emailEnviado?: string };
      expect(estado.status).toBe(201);
      expect(body.emailEnviado).toBe('failed');
      expect(typeof body.token).toBe('string');
      expect(typeof body.codigo).toBe('string');
      tokenGenerado = body.token;
    } finally {
      fetchSpy.mockRestore();
    }

    // El enlace generado sigue siendo real y válido: el hash del código de
    // acceso quedó persistido en PostgreSQL independientemente del fallo
    // de Brevo (consulta de solo lectura, no se depende del token en sí).
    const hash = await cotizacionesRepo.obtenerHashCodigoAcceso(cotizacion.id);
    expect(hash).not.toBeNull();
    expect(tokenGenerado).toBeTruthy();
  });

  it('3) cliente sin correo (email vacío): no se intenta enviar, y el enlace no se pierde', async () => {
    const { cotizacion } = await crearCotizacionEnviada('T3', true);

    const fetchSpy = vi.spyOn(global, 'fetch');

    try {
      const { res, estado } = crearRespuestaFake();
      await generarEnlaceController({ params: { id: cotizacion.id } } as unknown as Request, res);

      const body = estado.body as { token?: string; codigo?: string; emailEnviado?: string };
      expect(estado.status).toBe(201);
      expect(body.emailEnviado).toBe('skipped');
      expect(typeof body.token).toBe('string');
      expect(typeof body.codigo).toBe('string');
      // No se intenta ningún envío: fetch nunca se invoca para este caso.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('4) error inesperado del servicio de correo (red/timeout): no revierte la generación del enlace', async () => {
    const { cotizacion } = await crearCotizacionEnviada('T4');

    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Fallo de red simulado (Fase1 #4)'));

    try {
      const { res, estado } = crearRespuestaFake();
      await generarEnlaceController({ params: { id: cotizacion.id } } as unknown as Request, res);

      const body = estado.body as { token?: string; codigo?: string; emailEnviado?: string };
      expect(estado.status).toBe(201);
      expect(body.emailEnviado).toBe('failed');
      expect(typeof body.token).toBe('string');
      expect(typeof body.codigo).toBe('string');
    } finally {
      fetchSpy.mockRestore();
    }

    const hash = await cotizacionesRepo.obtenerHashCodigoAcceso(cotizacion.id);
    expect(hash).not.toBeNull();
  });

  it('5) regeneración: cada correo enviado corresponde exactamente al enlace devuelto en esa misma llamada', async () => {
    // NOTA (investigado antes de escribir esta prueba, no asumido): si las
    // dos llamadas ocurren dentro del mismo segundo de reloj, jwt.sign()
    // puede producir el MISMO token (mismo payload + mismo `iat` implícito
    // + mismo secreto ⇒ misma firma) — propiedad ya existente de
    // generarEnlaceCotizacion(), no introducida por esta fase. Por eso esta
    // prueba NO asume que el segundo token deba ser distinto del primero;
    // en cambio, verifica lo que de verdad garantiza "usa el enlace
    // vigente": que el CÓDIGO (aleatorio real, crypto.randomInt) cambió, y
    // que el correo de CADA llamada contiene el token que ESA MISMA llamada
    // devolvió (autoconsistencia, nunca uno de otra llamada).
    const { cotizacion } = await crearCotizacionEnviada('T5');

    const cuerpos: string[] = [];
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (_url, opciones) => {
      cuerpos.push((opciones as { body: string }).body);
      return new Response(JSON.stringify({ messageId: 'msg-fase1-t5' }), { status: 201 });
    });

    let primerCodigo: string | undefined;
    let segundoCodigo: string | undefined;
    try {
      const { res: res1, estado: estado1 } = crearRespuestaFake();
      await generarEnlaceController({ params: { id: cotizacion.id } } as unknown as Request, res1);
      const body1 = estado1.body as { token?: string; codigo?: string };
      primerCodigo = body1.codigo;

      const { res: res2, estado: estado2 } = crearRespuestaFake();
      await generarEnlaceController({ params: { id: cotizacion.id } } as unknown as Request, res2);
      const body2 = estado2.body as { token?: string; codigo?: string };
      segundoCodigo = body2.codigo;

      expect(primerCodigo).toBeTruthy();
      expect(segundoCodigo).toBeTruthy();
      expect(segundoCodigo).not.toBe(primerCodigo);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Autoconsistencia: el correo de la PRIMERA llamada contiene el
      // token de la PRIMERA; el de la SEGUNDA, el de la SEGUNDA.
      const cuerpoPrimerEnvio = JSON.parse(cuerpos[0]) as { textContent: string };
      const cuerpoSegundoEnvio = JSON.parse(cuerpos[1]) as { textContent: string };
      expect(cuerpoPrimerEnvio.textContent).toContain(encodeURIComponent(body1.token as string));
      expect(cuerpoSegundoEnvio.textContent).toContain(encodeURIComponent(body2.token as string));
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('6) enviarConfirmacionSolicitud (sin cambios) sigue funcionando igual que antes', async () => {
    // Regresión directa sobre la función NO tocada por esta fase: se
    // ejercita su camino real completo (mismo mock puntual de fetch que
    // las pruebas anteriores, nunca la red real) para confirmar que sigue
    // resolviendo 'sent' exactamente como antes de este cambio — código
    // real, no reimplementado aquí.
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ messageId: 'msg-fase1-t6' }), { status: 201 }));
    try {
      const resultado = await enviarConfirmacionSolicitud({
        destinatarioEmail: 'fase1.regresion@nextproject-test.local',
        destinatarioNombre: 'Prueba Fase1 Regresión',
        solicitudCodigo: 'SOL-000000',
      });
      expect(resultado.estado).toBe('sent');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
