// #7 (nextproject_test, real): participantes del chat en solicitudes sin orden, regla de acceso con orden y reasignación,
// contadores de mensajes pendientes y marcadores de lectura independientes por usuario.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Puerta para simular una respuesta lenta de la IA: mientras `esperar` exista, la IA no responde.
const puertaIa = vi.hoisted(() => ({ esperar: null as Promise<void> | null, entro: null as (() => void) | null }));

vi.mock('./ia/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ia/index.js')>();
  return {
    ...original,
    obtenerProveedorIa: () => ({
      generar: async () => {
        puertaIa.entro?.();
        if (puertaIa.esperar) await puertaIa.esperar;
        return { texto: 'Respuesta ficticia de NexIA' };
      },
    }),
    asegurarProveedorConfigurado: () => undefined,
  };
});

import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { solicitudesRouter } from '../routes/solicitudes.routes.js';
import { reiniciarCacheEsquemaChat } from '../repositories/chatEsquema.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import { crearCotizacion } from './cotizaciones.service.js';
import { asignarResponsable, crearOrden } from './ordenes.service.js';
import * as ordenesRepo from '../repositories/ordenes.repository.js';
import { crearMensaje, listarMensajes, SinAccesoChatError } from './solicitudMensajes.service.js';
import { incorporarParticipante, retirarParticipante, reclamarHilo, verParticipantes, HiloConComercialError, UltimoParticipanteError } from './chatParticipantes.service.js';
import { marcarLeido, obtenerPendientes, MensajeNoValidoError } from './chatLecturas.service.js';

type Rol = 'ADMIN' | 'COMERCIAL' | 'OPERATIVO';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
let server: http.Server;
let baseUrl: string;

async function crearUsuario(clave: string, rol: Rol): Promise<void> {
  const r = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [rol]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
    [`Prueba chat ${clave}`, `chat-part.${clave.toLowerCase()}.${randomUUID()}@nextproject-test.local`, r.rows[0].id]
  );
  ids[clave] = u.rows[0].id;
  tokens[clave] = jwt.sign({ sub: u.rows[0].id, rol }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

const U = (clave: string) => ({ id: ids[clave], rol: clave.startsWith('COM') ? 'COMERCIAL' : clave.startsWith('OPE') ? 'OPERATIVO' : 'ADMIN' });
const modoOriginal = env.chat.participantesModo;
const desdeOriginal = env.chat.pendientesDesde;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  await crearUsuario('ADMIN', 'ADMIN');
  await crearUsuario('COM_A', 'COMERCIAL');
  await crearUsuario('COM_B', 'COMERCIAL');
  await crearUsuario('OPE_1', 'OPERATIVO');
  await crearUsuario('OPE_2', 'OPERATIVO');
  reiniciarCacheEsquemaChat();
  const app = express();
  app.use(express.json());
  app.use('/api/solicitudes', solicitudesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  env.chat.participantesModo = modoOriginal;
  env.chat.pendientesDesde = desdeOriginal;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  env.chat.participantesModo = 'ESTRICTO';
  env.chat.pendientesDesde = new Date('2020-01-01T00:00:00Z');
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function solicitudNueva(): Promise<string> {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba participantes chat',
      empresa: null,
      email: `chat-part.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio participantes chat',
      descripcion: 'Registro ficticio de integracion (participantes del chat).',
      cantidad: 1,
    },
    `chat-part-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  return s.solicitud.id;
}

async function conOrden(solicitudId: string, responsable: string): Promise<string> {
  const cot = await crearCotizacion({ solicitudId, valor: 100, descripcion: null, creadoPor: ids.COM_A, anticipoPorcentaje: 0 });
  await pool.query(`UPDATE cotizaciones SET estado = 'ACEPTADA' WHERE id = $1`, [cot.id]);
  const o = await pool.query<{ id: string }>(
    `INSERT INTO ordenes (id, cotizacion_id, responsable_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
    [cot.id, ids[responsable]]
  );
  return o.rows[0].id;
}

describe('participantes del chat en solicitudes sin orden (modo estricto)', () => {
  it('el primer COMERCIAL que escribe queda como participante; quien no participa recibe 403', async () => {
    const sol = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'primer mensaje de A');

    const vistaA = await verParticipantes(sol, U('COM_A'));
    expect(vistaA).toMatchObject({ regimen: 'PARTICIPANTES', participa: true, puede_gestionar: true });
    expect(vistaA.participantes.map((p) => p.usuario_id)).toEqual([ids.COM_A]);

    await expect(listarMensajes(sol, U('COM_B'))).rejects.toBeInstanceOf(SinAccesoChatError);
    await expect(listarMensajes(sol, U('OPE_1'))).rejects.toBeInstanceOf(SinAccesoChatError);
    await expect(crearMensaje(sol, U('OPE_1'), 'intruso')).rejects.toBeInstanceOf(SinAccesoChatError);
    // quien no participa no ve quiénes participan; COM_B tampoco puede reclamar (ya hay COMERCIAL)
    expect(await verParticipantes(sol, U('COM_B'))).toMatchObject({ participa: false, reclamable: false, participantes: [] });
    await expect(reclamarHilo(sol, U('COM_B'))).rejects.toBeInstanceOf(HiloConComercialError);
  });

  it('un participante COMERCIAL incorpora y retira; no se puede retirar al último; la reincorporación conserva el historial', async () => {
    const sol = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'hola');
    expect((await incorporarParticipante(sol, U('COM_A'), ids.OPE_1)).incorporado).toBe(true);
    expect((await incorporarParticipante(sol, U('COM_A'), ids.OPE_1)).incorporado).toBe(false); // idempotente

    expect((await listarMensajes(sol, U('OPE_1'))).mensajes).toHaveLength(1);
    await crearMensaje(sol, U('OPE_1'), 'respuesta de operativo');

    // OPERATIVO no gestiona participantes; ADMIN tampoco
    await expect(incorporarParticipante(sol, U('OPE_1'), ids.OPE_2)).rejects.toBeInstanceOf(SinAccesoChatError);

    await retirarParticipante(sol, U('COM_A'), ids.OPE_1);
    await expect(listarMensajes(sol, U('OPE_1'))).rejects.toBeInstanceOf(SinAccesoChatError);
    await expect(retirarParticipante(sol, U('COM_A'), ids.COM_A)).rejects.toBeInstanceOf(UltimoParticipanteError);

    await incorporarParticipante(sol, U('COM_A'), ids.OPE_1);
    const filas = await pool.query(
      `SELECT retirado_en FROM solicitud_mensajes_participantes WHERE solicitud_id = $1 AND usuario_id = $2 ORDER BY agregado_en`,
      [sol, ids.OPE_1]
    );
    expect(filas.rows).toHaveLength(2); // la fila retirada se conserva (trazabilidad) y hay una nueva activa
    expect(filas.rows[0].retirado_en).not.toBeNull();
    expect(filas.rows[1].retirado_en).toBeNull();
  });

  it('un hilo sin COMERCIAL participante vigente se puede reclamar; el reclamo no se ofrece si hay COMERCIAL', async () => {
    const sol = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'mensaje de A');
    await pool.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [ids.COM_A]);
    try {
      expect(await verParticipantes(sol, U('COM_B'))).toMatchObject({ reclamable: true, participantes: [] });
      expect((await reclamarHilo(sol, U('COM_B'))).reclamado).toBe(true);
      expect((await reclamarHilo(sol, U('COM_B'))).reclamado).toBe(false); // idempotente
      expect((await listarMensajes(sol, U('COM_B'))).mensajes.length).toBeGreaterThan(0);
    } finally {
      await pool.query('UPDATE usuarios SET activo = TRUE WHERE id = $1', [ids.COM_A]);
    }
    const origen = await pool.query(`SELECT origen FROM solicitud_mensajes_participantes WHERE solicitud_id = $1 AND usuario_id = $2`, [sol, ids.COM_B]);
    expect(origen.rows[0].origen).toBe('RECLAMO');
  });

  it('modo sombra: el acceso sigue abierto y se registra el acceso que se habría denegado, sin contenido', async () => {
    env.chat.participantesModo = 'SOMBRA';
    const sol = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'contenido secreto de prueba');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect((await listarMensajes(sol, U('OPE_1'))).mensajes).toHaveLength(1); // sigue accediendo como antes
    const eventos = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('CHAT_ACCESO_SOMBRA_DENEGADO'));
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toContain(ids.OPE_1);
    expect(eventos[0]).not.toContain('secreto');
  });
});

describe('solicitudes con orden: el acceso se deriva del responsable', () => {
  it('el nuevo responsable ve el historial completo; el anterior pierde el acceso; cada uno conserva su marcador', async () => {
    const sol = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'antes de la orden');
    const ordenId = await conOrden(sol, 'OPE_1');
    await crearMensaje(sol, U('COM_A'), 'mensaje 2 de comercial');
    const m1 = (await listarMensajes(sol, U('OPE_1'))).mensajes;
    expect(m1).toHaveLength(2);
    await marcarLeido(sol, U('OPE_1'), m1[1].id);
    await crearMensaje(sol, U('OPE_1'), 'respuesta de OPE_1');

    await expect(listarMensajes(sol, U('OPE_2'))).rejects.toBeInstanceOf(SinAccesoChatError);

    await asignarResponsable(ordenId, ids.OPE_2);

    // el nuevo responsable ve todo el historial compartido con autor y fecha originales
    const m2 = (await listarMensajes(sol, U('OPE_2'))).mensajes;
    expect(m2.map((m) => m.contenido)).toEqual(['antes de la orden', 'mensaje 2 de comercial', 'respuesta de OPE_1']);
    expect(m2[2].autor_id).toBe(ids.OPE_1);
    await expect(listarMensajes(sol, U('OPE_1'))).rejects.toBeInstanceOf(SinAccesoChatError);
    await expect(marcarLeido(sol, U('OPE_1'), m1[1].id)).rejects.toBeInstanceOf(SinAccesoChatError);

    // el nuevo responsable parte sin marcador: ve como pendientes los mensajes de COMERCIAL del hilo
    expect((await obtenerPendientes(U('OPE_2'))).por_solicitud.find((f) => f.solicitud_id === sol)?.pendientes).toBe(2);
    // y el marcador del anterior no se tocó
    const marcador = await pool.query('SELECT ultimo_leido_id FROM solicitud_mensajes_lecturas WHERE usuario_id = $1 AND solicitud_id = $2', [ids.OPE_1, sol]);
    expect(marcador.rows[0].ultimo_leido_id).toBe(m1[1].id);

    // la reasignación genera un aviso para la orden; una segunda reasignación cancela el anterior y crea otro
    const avisos = () => pool.query(`SELECT estado FROM alertas WHERE orden_id = $1 AND tipo = 'ORDEN_REASIGNADA' ORDER BY creado_en`, [ordenId]);
    expect((await avisos()).rows.map((r) => r.estado)).toEqual(['PENDIENTE']);
    await asignarResponsable(ordenId, ids.OPE_1);
    expect((await avisos()).rows.map((r) => r.estado)).toEqual(['CANCELADA', 'PENDIENTE']);
    // reasignar a la misma persona no genera otro aviso
    await asignarResponsable(ordenId, ids.OPE_1);
    expect((await avisos()).rows).toHaveLength(2);
  });

  it('COMERCIAL accede siempre y un OPERATIVO sin ser el responsable recibe 403', async () => {
    const sol = await solicitudNueva();
    await conOrden(sol, 'OPE_1');
    expect((await listarMensajes(sol, U('COM_B'))).modo).toBe('EDITABLE');
    await expect(crearMensaje(sol, U('OPE_2'), 'no soy el responsable')).rejects.toBeInstanceOf(SinAccesoChatError);
    expect(await verParticipantes(sol, U('OPE_1'))).toMatchObject({ regimen: 'ORDEN', responsable: { id: ids.OPE_1 } });
  });
});

describe('contadores y marcadores de lectura', () => {
  it('cuenta solo mensajes del rol contrario, independientes por usuario; no cuenta propios ni respuestas de NexIA', async () => {
    env.chat.participantesModo = 'SOMBRA';
    const sol = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'uno');
    await crearMensaje(sol, U('COM_A'), 'nexia dime algo'); // pregunta compartida + respuesta privada de A
    const pend = async (clave: string) => (await obtenerPendientes(U(clave))).por_solicitud.find((f) => f.solicitud_id === sol)?.pendientes ?? 0;

    expect(await pend('OPE_1')).toBe(2); // las dos preguntas/mensajes de A, nunca la respuesta de NexIA
    expect(await pend('OPE_2')).toBe(2);
    expect(await pend('COM_A')).toBe(0); // sus propios mensajes y la respuesta de NexIA no cuentan
    expect(await pend('COM_B')).toBe(0); // mismo rol que el autor: no cuenta

    const m = (await listarMensajes(sol, U('OPE_1'))).mensajes;
    const r = await marcarLeido(sol, U('OPE_1'), m[m.length - 1].id);
    expect(r).toMatchObject({ activo: true, avanzo: true, pendientes: 0 });
    expect(await pend('OPE_1')).toBe(0);
    expect(await pend('OPE_2')).toBe(2); // la lectura de OPE_1 no cambia lo pendiente de OPE_2

    await crearMensaje(sol, U('COM_A'), 'tres');
    expect(await pend('OPE_1')).toBe(1); // lo posterior al marcador sigue pendiente

    // OPERATIVO escribe: cuenta para COMERCIAL (cualquiera con acceso), no para OPERATIVO
    await crearMensaje(sol, U('OPE_1'), 'respuesta de operativo');
    expect(await pend('COM_A')).toBe(1);
    expect(await pend('COM_B')).toBe(1);
    expect(await pend('OPE_2')).toBe(3);
  });

  it('el marcador no retrocede aunque lleguen solicitudes concurrentes fuera de orden', async () => {
    env.chat.participantesModo = 'SOMBRA';
    const sol = await solicitudNueva();
    for (const t of ['a', 'b', 'c', 'd']) await crearMensaje(sol, U('COM_A'), t);
    const m = (await listarMensajes(sol, U('OPE_1'))).mensajes;

    await Promise.all([
      marcarLeido(sol, U('OPE_1'), m[3].id),
      marcarLeido(sol, U('OPE_1'), m[1].id),
      marcarLeido(sol, U('OPE_1'), m[0].id),
      marcarLeido(sol, U('OPE_1'), m[2].id),
    ]);
    const fila = await pool.query('SELECT ultimo_leido_id FROM solicitud_mensajes_lecturas WHERE usuario_id = $1 AND solicitud_id = $2', [ids.OPE_1, sol]);
    expect(fila.rows[0].ultimo_leido_id).toBe(m[3].id);
    const tarde = await marcarLeido(sol, U('OPE_1'), m[0].id);
    expect(tarde.avanzo).toBe(false);
    expect((await obtenerPendientes(U('OPE_1'))).por_solicitud.find((f) => f.solicitud_id === sol)).toBeUndefined();
  });

  it('rechaza marcar un mensaje de otra solicitud o una respuesta privada de otro usuario', async () => {
    env.chat.participantesModo = 'SOMBRA';
    const sol = await solicitudNueva();
    const otra = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'nexia pregunta privada');
    await crearMensaje(otra, U('COM_A'), 'mensaje en otra solicitud');
    const deA = (await listarMensajes(sol, U('COM_A'))).mensajes;
    const respuestaDeA = deA.find((m) => m.autor_tipo === 'NEXIA')!;
    const deOtra = (await listarMensajes(otra, U('COM_A'))).mensajes[0];

    await expect(marcarLeido(sol, U('OPE_1'), respuestaDeA.id)).rejects.toBeInstanceOf(MensajeNoValidoError);
    await expect(marcarLeido(sol, U('OPE_1'), deOtra.id)).rejects.toBeInstanceOf(MensajeNoValidoError);
    await expect(marcarLeido(sol, U('OPE_1'), 'no-es-uuid')).rejects.toBeInstanceOf(MensajeNoValidoError);
    expect((await marcarLeido(sol, U('COM_A'), respuestaDeA.id)).avanzo).toBe(true); // su destinatario sí puede
  });

  it('respeta la fecha de corte y queda inactivo sin ella; los hilos no autorizados no cuentan en modo estricto', async () => {
    env.chat.participantesModo = 'SOMBRA';
    const sol = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'mensaje anterior al corte');
    env.chat.pendientesDesde = new Date(Date.now() + 60_000); // el corte es posterior a todo lo escrito
    expect((await obtenerPendientes(U('OPE_1'))).por_solicitud.find((f) => f.solicitud_id === sol)).toBeUndefined();
    env.chat.pendientesDesde = null;
    expect(await obtenerPendientes(U('OPE_1'))).toEqual({ activo: false, total: 0, por_solicitud: [] });

    env.chat.pendientesDesde = new Date('2020-01-01T00:00:00Z');
    expect((await obtenerPendientes(U('OPE_1'))).por_solicitud.find((f) => f.solicitud_id === sol)?.pendientes).toBe(1);
    env.chat.participantesModo = 'ESTRICTO'; // OPE_1 no es participante: el hilo deja de contar
    expect((await obtenerPendientes(U('OPE_1'))).por_solicitud.find((f) => f.solicitud_id === sol)).toBeUndefined();
    await incorporarParticipante(sol, U('COM_A'), ids.OPE_1);
    expect((await obtenerPendientes(U('OPE_1'))).por_solicitud.find((f) => f.solicitud_id === sol)?.pendientes).toBe(1);
  });
});

// Carrera entre un cambio de acceso y el envío: el cambio se mantiene SIN confirmar en otra transacción mientras el envío
// intenta guardar; el envío debe esperar y, una vez confirmado el cambio, rechazarse. Nunca se guarda un mensaje de quien
// ya perdió el acceso.
async function conTransaccionPendiente(
  accion: (client: import('pg').PoolClient) => Promise<void>,
  envio: () => Promise<unknown>
): Promise<'RECHAZADO' | 'GUARDADO'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await accion(client);
    let terminado = false;
    const promesa = envio().then(
      () => {
        terminado = true;
        return 'GUARDADO' as const;
      },
      (error: unknown) => {
        terminado = true;
        if (error instanceof SinAccesoChatError || (error as Error).constructor.name === 'ChatSoloLecturaError') return 'RECHAZADO' as const;
        throw error;
      }
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(terminado).toBe(false); // el envío está esperando el bloqueo del cambio pendiente
    await client.query('COMMIT');
    return await promesa;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function conCambioPendiente(sql: string, parametros: unknown[], envio: () => Promise<unknown>): Promise<'RECHAZADO' | 'GUARDADO'> {
  return conTransaccionPendiente(async (client) => {
    await client.query(sql, parametros);
  }, envio);
}

describe('carrera entre un cambio de acceso y el envío de mensajes', () => {
  it('reasignación de la orden: el responsable anterior no puede enviar después de perder el acceso', async () => {
    const sol = await solicitudNueva();
    const ordenId = await conOrden(sol, 'OPE_1');
    await crearMensaje(sol, U('OPE_1'), 'mensaje legítimo antes de reasignar');
    const resultado = await conCambioPendiente('UPDATE ordenes SET responsable_id = $2 WHERE id = $1', [ordenId, ids.OPE_2], () =>
      crearMensaje(sol, U('OPE_1'), 'enviado durante la reasignación')
    );
    expect(resultado).toBe('RECHAZADO');
    const guardados = await pool.query(`SELECT contenido FROM solicitud_mensajes WHERE solicitud_id = $1`, [sol]);
    expect(guardados.rows.map((r) => r.contenido)).toEqual(['mensaje legítimo antes de reasignar']);
    // el nuevo responsable sí puede escribir
    await crearMensaje(sol, U('OPE_2'), 'mensaje del nuevo responsable');
  });

  it('desactivación del usuario y cambio de rol: el envío en vuelo se rechaza', async () => {
    const sol = await solicitudNueva();
    const comercial = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'COMERCIAL'`);
    const operativo = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'OPERATIVO'`);
    await crearMensaje(sol, U('COM_B'), 'hola');
    try {
      expect(await conCambioPendiente('UPDATE usuarios SET activo = FALSE WHERE id = $1', [ids.COM_B], () => crearMensaje(sol, U('COM_B'), 'tras desactivar'))).toBe('RECHAZADO');
      await pool.query('UPDATE usuarios SET activo = TRUE WHERE id = $1', [ids.COM_B]);
      expect(await conCambioPendiente('UPDATE usuarios SET rol_id = $2 WHERE id = $1', [ids.COM_B, operativo.rows[0].id], () => crearMensaje(sol, U('COM_B'), 'tras cambiar de rol'))).toBe('RECHAZADO');
    } finally {
      await pool.query('UPDATE usuarios SET activo = TRUE, rol_id = $2 WHERE id = $1', [ids.COM_B, comercial.rows[0].id]);
    }
    const guardados = await pool.query(`SELECT contenido FROM solicitud_mensajes WHERE solicitud_id = $1`, [sol]);
    expect(guardados.rows.map((r) => r.contenido)).toEqual(['hola']);
  });

  it('retiro como participante (solicitud sin orden) y cancelación de la solicitud', async () => {
    const sol = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'abre el hilo');
    await incorporarParticipante(sol, U('COM_A'), ids.OPE_1);
    await crearMensaje(sol, U('OPE_1'), 'mensaje del operativo participante');

    const retirado = await conCambioPendiente(
      `UPDATE solicitud_mensajes_participantes SET retirado_por = $3, retirado_en = CURRENT_TIMESTAMP WHERE solicitud_id = $1 AND usuario_id = $2 AND retirado_en IS NULL`,
      [sol, ids.OPE_1, ids.COM_A],
      () => crearMensaje(sol, U('OPE_1'), 'enviado durante el retiro')
    );
    expect(retirado).toBe('RECHAZADO');

    const cancelado = await conCambioPendiente(`UPDATE solicitudes SET estado = 'CANCELADA' WHERE id = $1`, [sol], () =>
      crearMensaje(sol, U('COM_A'), 'enviado durante la cancelación')
    );
    expect(cancelado).toBe('RECHAZADO');
    const guardados = await pool.query(`SELECT contenido FROM solicitud_mensajes WHERE solicitud_id = $1 ORDER BY creado_en`, [sol]);
    expect(guardados.rows.map((r) => r.contenido)).toEqual(['abre el hilo', 'mensaje del operativo participante']);
  });

  it('un envío que llega antes del cambio se guarda y el cambio se aplica después (sin pérdida)', async () => {
    const sol = await solicitudNueva();
    const ordenId = await conOrden(sol, 'OPE_1');
    const [mensaje] = await Promise.all([crearMensaje(sol, U('OPE_1'), 'primero el mensaje'), new Promise((r) => setTimeout(r, 0))]);
    expect(mensaje.mensaje.contenido).toBe('primero el mensaje');
    await asignarResponsable(ordenId, ids.OPE_2);
    await expect(crearMensaje(sol, U('OPE_1'), 'después de reasignar')).rejects.toBeInstanceOf(SinAccesoChatError);
  });
});

describe('carreras residuales: creación de la orden y respuesta de NexIA', () => {
  async function cotizacionAceptada(sol: string): Promise<string> {
    const cot = await crearCotizacion({ solicitudId: sol, valor: 100, descripcion: null, creadoPor: ids.COM_A, anticipoPorcentaje: 0 });
    await pool.query(`UPDATE cotizaciones SET estado = 'ACEPTADA' WHERE id = $1`, [cot.id]);
    return cot.id;
  }

  it('un mensaje en vuelo se guarda ANTES de que exista la orden: crear la orden espera a que el envío termine', async () => {
    const sol = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'abre el hilo');
    const cot = await cotizacionAceptada(sol);
    const emailOriginal = env.operativoPorDefectoEmail;
    const ope = await pool.query<{ email: string }>('SELECT email FROM usuarios WHERE id = $1', [ids.OPE_2]);
    env.operativoPorDefectoEmail = ope.rows[0].email;
    try {
      // Simula un envío en vuelo: toma sobre la solicitud el mismo bloqueo compartido que toma el envío.
      const enVuelo = await pool.connect();
      await enVuelo.query('BEGIN');
      await enVuelo.query('SELECT estado FROM solicitudes WHERE id = $1 FOR SHARE', [sol]);
      let creada = false;
      const promesa = crearOrden({ cotizacionId: cot, descripcion: null }).then((o) => {
        creada = true;
        return o;
      });
      await new Promise((r) => setTimeout(r, 400));
      expect(creada).toBe(false); // crear la orden espera al envío en vuelo
      await enVuelo.query('COMMIT');
      enVuelo.release();
      const orden = await promesa;
      expect(orden.responsable_id).toBe(ids.OPE_2);
    } finally {
      env.operativoPorDefectoEmail = emailOriginal;
    }
  });

  it('un mensaje que llega MIENTRAS se crea la orden espera y se rige por la orden: el operativo participante deja de poder escribir', async () => {
    const sol = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'abre el hilo');
    await incorporarParticipante(sol, U('COM_A'), ids.OPE_1);
    await crearMensaje(sol, U('OPE_1'), 'mensaje previo a la orden');
    const cot = await cotizacionAceptada(sol);

    const resultado = await conTransaccionPendiente(
      async (client) => {
        // Lo que hace crearOrden: bloquear la solicitud y crear la orden, todavía sin confirmar.
        await ordenesRepo.bloquearSolicitudDeCotizacion(client, cot);
        await ordenesRepo.create(client, { cotizacionId: cot, descripcion: null, fechaEntrega: null, responsableId: ids.OPE_2 });
      },
      () => crearMensaje(sol, U('OPE_1'), 'enviado durante la creación de la orden')
    );
    expect(resultado).toBe('RECHAZADO'); // OPE_1 ya no es el responsable
    const guardados = await pool.query(`SELECT contenido FROM solicitud_mensajes WHERE solicitud_id = $1 ORDER BY creado_en`, [sol]);
    expect(guardados.rows.map((r) => r.contenido)).toEqual(['abre el hilo', 'mensaje previo a la orden']);
    await crearMensaje(sol, U('OPE_2'), 'el responsable sí escribe');
  });

  async function invocarNexiaLenta(sol: string, usuario: { id: string; rol: string }, perderAcceso: () => Promise<void>) {
    let liberar: () => void = () => undefined;
    let avisar: () => void = () => undefined;
    const llegoALaIa = new Promise<void>((r) => (avisar = r));
    puertaIa.esperar = new Promise<void>((r) => (liberar = r));
    puertaIa.entro = avisar;
    try {
      const envio = crearMensaje(sol, usuario, 'nexia tarda en responder').then(
        () => 'GUARDADA',
        (error: unknown) => (error instanceof SinAccesoChatError ? 'RECHAZADA' : Promise.reject(error))
      );
      await llegoALaIa; // la pregunta ya se guardó y la IA está «pensando»
      await perderAcceso();
      liberar();
      return await envio;
    } finally {
      puertaIa.esperar = null;
      puertaIa.entro = null;
    }
  }

  it('si el usuario pierde el acceso mientras la IA responde, la respuesta de NexIA no se guarda ni se entrega (reasignación)', async () => {
    const sol = await solicitudNueva();
    const ordenId = await conOrden(sol, 'OPE_1');
    const resultado = await invocarNexiaLenta(sol, U('OPE_1'), async () => {
      await asignarResponsable(ordenId, ids.OPE_2);
    });
    expect(resultado).toBe('RECHAZADA');
    const filas = await pool.query(`SELECT autor_tipo FROM solicitud_mensajes WHERE solicitud_id = $1 ORDER BY creado_en`, [sol]);
    expect(filas.rows.map((r) => r.autor_tipo)).toEqual(['OPERATIVO']); // solo la pregunta; ninguna respuesta de NexIA
  });

  it('desactivación durante la respuesta de la IA: tampoco se guarda; con el acceso intacto la respuesta se guarda normalmente', async () => {
    const sol = await solicitudNueva();
    await crearMensaje(sol, U('COM_A'), 'abre el hilo');
    const resultado = await invocarNexiaLenta(sol, U('COM_A'), async () => {
      await pool.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [ids.COM_A]);
    });
    await pool.query('UPDATE usuarios SET activo = TRUE WHERE id = $1', [ids.COM_A]);
    expect(resultado).toBe('RECHAZADA');
    const tras = await pool.query(`SELECT count(*)::int AS n FROM solicitud_mensajes WHERE solicitud_id = $1 AND autor_tipo = 'NEXIA'`, [sol]);
    expect(tras.rows[0].n).toBe(0);

    const normal = await invocarNexiaLenta(sol, U('COM_A'), async () => undefined);
    expect(normal).toBe('GUARDADA');
    const respuestas = await pool.query(`SELECT destinatario_id FROM solicitud_mensajes WHERE solicitud_id = $1 AND autor_tipo = 'NEXIA'`, [sol]);
    expect(respuestas.rows).toEqual([{ destinatario_id: ids.COM_A }]);
  });
});

describe('ADMIN fuera del chat (todos los endpoints nuevos)', () => {
  it('recibe 403 en pendientes, leidos y participantes; COMERCIAL y OPERATIVO acceden', async () => {
    const sol = await solicitudNueva();
    const h = (clave: string) => ({ Authorization: `Bearer ${tokens[clave]}`, 'Content-Type': 'application/json' });
    const base = `${baseUrl}/api/solicitudes`;

    for (const [metodo, url, cuerpo] of [
      ['GET', `${base}/mensajes/pendientes`, undefined],
      ['POST', `${base}/${sol}/mensajes/leidos`, { hasta_id: randomUUID() }],
      ['GET', `${base}/${sol}/participantes`, undefined],
      ['POST', `${base}/${sol}/participantes`, { usuario_id: ids.OPE_1 }],
      ['POST', `${base}/${sol}/participantes/reclamar`, undefined],
      ['DELETE', `${base}/${sol}/participantes/${ids.OPE_1}`, undefined],
    ] as const) {
      const res = await fetch(url, { method: metodo, headers: h('ADMIN'), body: cuerpo ? JSON.stringify(cuerpo) : undefined });
      expect(res.status, `${metodo} ${url}`).toBe(403);
    }
    expect((await fetch(`${base}/mensajes/pendientes`, { headers: h('COM_A') })).status).toBe(200);
    expect((await fetch(`${base}/mensajes/pendientes`, { headers: h('OPE_1') })).status).toBe(200);
    expect((await fetch(`${base}/${sol}/participantes/no-es-uuid`, { method: 'DELETE', headers: h('COM_A') })).status).toBe(400);
  });
});
