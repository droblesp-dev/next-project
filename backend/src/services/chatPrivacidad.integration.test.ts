// #8 (nextproject_test, real): privacidad de las respuestas de NexIA y exclusión de ADMIN del chat.
//  - La respuesta de NexIA solo la ve su destinatario; la pregunta sigue siendo compartida.
//  - El contexto que recibe la IA para un usuario no incluye las respuestas privadas de otros.
//  - Las respuestas históricas sin destinatario no las ve nadie y no entran en ningún contexto de IA.
//  - La ficha técnica solo usa mensajes compartidos (ninguna respuesta de NexIA).
//  - ADMIN recibe 403 en el chat por API.
// La IA se simula (nunca se llama a un proveedor externo) y registra los prompts recibidos.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const promptsIa: string[] = [];
let contadorRespuestas = 0;

vi.mock('./ia/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ia/index.js')>();
  return {
    ...original,
    obtenerProveedorIa: () => ({
      generar: async ({ prompt }: { prompt: string }) => {
        promptsIa.push(prompt);
        contadorRespuestas += 1;
        return { texto: `RESPUESTA-PRIVADA-${contadorRespuestas}\nINCONSISTENCIAS: Ninguna` };
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
import { crearMensaje, listarMensajes } from './solicitudMensajes.service.js';
import { generarFicha } from './fichaTecnica.service.js';

type Rol = 'ADMIN' | 'COMERCIAL' | 'OPERATIVO';

let server: http.Server;
let baseUrl: string;
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

async function crearUsuario(clave: string, rol: Rol): Promise<void> {
  const r = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [rol]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
    [`Prueba chat ${clave}`, `chat-priv.${clave.toLowerCase()}.${randomUUID()}@nextproject-test.local`, r.rows[0].id]
  );
  ids[clave] = u.rows[0].id;
  tokens[clave] = jwt.sign({ sub: u.rows[0].id, rol }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  await crearUsuario('ADMIN', 'ADMIN');
  await crearUsuario('COM_A', 'COMERCIAL');
  await crearUsuario('COM_B', 'COMERCIAL');
  await crearUsuario('OPE', 'OPERATIVO');
  reiniciarCacheEsquemaChat();
  const app = express();
  app.use(express.json());
  app.use('/api/solicitudes', solicitudesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  promptsIa.length = 0;
});

async function solicitudNueva(): Promise<string> {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba privacidad chat',
      empresa: null,
      email: `chat-priv.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio privacidad chat',
      descripcion: 'Registro ficticio de integracion (privacidad del chat).',
      cantidad: 1,
    },
    `chat-priv-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  return s.solicitud.id;
}

// Simula una respuesta HISTÓRICA de NexIA (sin destinatario). Las restricciones de V25b son NOT VALID y rechazan ese
// tipo de fila nueva, así que se retiran y se reponen dentro de una transacción únicamente para crear el dato de prueba.
const CHECKS_NEXIA = `
  ALTER TABLE solicitud_mensajes ADD CONSTRAINT chk_solicitud_mensajes_destinatario CHECK (
    (autor_tipo = 'NEXIA' AND destinatario_id IS NOT NULL) OR (autor_tipo <> 'NEXIA' AND destinatario_id IS NULL)
  ) NOT VALID;
  ALTER TABLE solicitud_mensajes ADD CONSTRAINT chk_solicitud_mensajes_contenido_privado CHECK (
    (autor_tipo = 'NEXIA' AND contenido_privado IS NOT NULL AND btrim(contenido_privado) <> '')
    OR (autor_tipo <> 'NEXIA' AND contenido_privado IS NULL)
  ) NOT VALID;`;

async function insertarRespuestaHistorica(solicitudId: string, texto: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existe = await client.query(`SELECT 1 FROM pg_constraint WHERE conname = 'chk_solicitud_mensajes_destinatario'`);
    if (existe.rowCount) {
      await client.query('ALTER TABLE solicitud_mensajes DROP CONSTRAINT chk_solicitud_mensajes_destinatario');
      await client.query('ALTER TABLE solicitud_mensajes DROP CONSTRAINT IF EXISTS chk_solicitud_mensajes_contenido_privado');
    }
    await client.query(
      `INSERT INTO solicitud_mensajes (id, solicitud_id, autor_id, autor_tipo, contenido) VALUES (gen_random_uuid(), $1, NULL, 'NEXIA', $2)`,
      [solicitudId, texto]
    );
    if (existe.rowCount) {
      await client.query(CHECKS_NEXIA);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const com = (clave: string) => ({ id: ids[clave], rol: 'COMERCIAL' });

describe('#8 — privacidad de las respuestas de NexIA', () => {
  it('la respuesta solo la ve su destinatario; la pregunta es compartida', async () => {
    const sol = await solicitudNueva();
    const r = await crearMensaje(sol, com('COM_A'), 'nexia resume esta solicitud');
    expect(r.respuestaNexia?.destinatario_id).toBe(ids.COM_A);

    const deA = (await listarMensajes(sol, com('COM_A'))).mensajes;
    const deB = (await listarMensajes(sol, com('COM_B'))).mensajes;
    const deOpe = (await listarMensajes(sol, { id: ids.OPE, rol: 'OPERATIVO' })).mensajes;

    expect(deA.map((m) => m.autor_tipo)).toEqual(['COMERCIAL', 'NEXIA']);
    expect(deB.map((m) => m.autor_tipo)).toEqual(['COMERCIAL']);
    expect(deOpe.map((m) => m.autor_tipo)).toEqual(['COMERCIAL']);
  });

  it('el contexto de NexIA para B no incluye la respuesta privada de A', async () => {
    const sol = await solicitudNueva();
    await crearMensaje(sol, com('COM_A'), 'nexia pregunta de A');
    const respuestaA = promptsIa.length === 1 ? 'RESPUESTA-PRIVADA-' : 'x';
    const textoA = (await listarMensajes(sol, com('COM_A'))).mensajes.find((m) => m.autor_tipo === 'NEXIA')!.contenido;
    promptsIa.length = 0;

    await crearMensaje(sol, com('COM_B'), 'nexia pregunta de B');
    expect(promptsIa).toHaveLength(1);
    expect(promptsIa[0]).toContain('pregunta de A'); // la pregunta de A es compartida
    expect(promptsIa[0]).not.toContain(textoA.split('\n')[0]); // pero su respuesta privada no
    expect(respuestaA).toBeTruthy();

    // y un nuevo mensaje de A sí recibe como contexto su propia respuesta
    promptsIa.length = 0;
    await crearMensaje(sol, com('COM_A'), 'nexia otra pregunta de A');
    expect(promptsIa[0]).toContain(textoA.split('\n')[0]);
  });

  it('una respuesta histórica sin destinatario no la ve nadie ni entra en el contexto de IA', async () => {
    const sol = await solicitudNueva();
    await insertarRespuestaHistorica(sol, 'RESPUESTA-HISTORICA-SIN-DESTINATARIO');
    await crearMensaje(sol, com('COM_A'), 'mensaje compartido de A');

    for (const usuario of [com('COM_A'), com('COM_B'), { id: ids.OPE, rol: 'OPERATIVO' }]) {
      const { mensajes } = await listarMensajes(sol, usuario);
      expect(mensajes.some((m) => m.contenido.includes('HISTORICA'))).toBe(false);
    }
    await crearMensaje(sol, com('COM_B'), 'nexia dame contexto');
    expect(promptsIa[0]).not.toContain('RESPUESTA-HISTORICA-SIN-DESTINATARIO');
  });

  it('la ficha técnica solo usa mensajes compartidos: ninguna respuesta de NexIA, privada o histórica', async () => {
    const sol = await solicitudNueva();
    await insertarRespuestaHistorica(sol, 'RESPUESTA-HISTORICA-FICHA');
    await crearMensaje(sol, com('COM_A'), 'nexia pregunta con respuesta privada');
    const privada = (await listarMensajes(sol, com('COM_A'))).mensajes.find((m) => m.autor_tipo === 'NEXIA')!.contenido.split('\n')[0];
    await crearMensaje(sol, { id: ids.OPE, rol: 'OPERATIVO' }, 'medida compartida: 50 mm');

    const cot = await crearCotizacion({ solicitudId: sol, valor: 100, descripcion: null, creadoPor: ids.COM_A, anticipoPorcentaje: 0 });
    await pool.query(`UPDATE cotizaciones SET estado = 'ACEPTADA' WHERE id = $1`, [cot.id]);
    const o = await pool.query<{ id: string }>(
      `INSERT INTO ordenes (id, cotizacion_id, responsable_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
      [cot.id, ids.OPE]
    );
    promptsIa.length = 0;
    await generarFicha(o.rows[0].id);

    expect(promptsIa).toHaveLength(1);
    expect(promptsIa[0]).toContain('medida compartida: 50 mm');
    expect(promptsIa[0]).toContain('pregunta con respuesta privada'); // la pregunta es compartida
    expect(promptsIa[0]).not.toContain(privada);
    expect(promptsIa[0]).not.toContain('RESPUESTA-HISTORICA-FICHA');
    expect(promptsIa[0]).not.toContain('[NEXIA]');
  });
});

describe('#8 — privacidad por construcción frente a versiones anteriores del backend', () => {
  it('el texto de una respuesta privada no está en `contenido`: una instancia anterior que lea la fila solo ve un marcador', async () => {
    const sol = await solicitudNueva();
    await crearMensaje(sol, com('COM_A'), 'nexia pregunta con respuesta privada');
    const textoPrivado = (await listarMensajes(sol, com('COM_A'))).mensajes.find((m) => m.autor_tipo === 'NEXIA')!.contenido;
    expect(textoPrivado).toContain('RESPUESTA-PRIVADA-');

    // Lo que leería un backend anterior a V25: la columna `contenido` de TODAS las filas, sin filtrar por destinatario.
    const comoInstanciaAntigua = await pool.query(`SELECT contenido FROM solicitud_mensajes WHERE solicitud_id = $1`, [sol]);
    for (const fila of comoInstanciaAntigua.rows) {
      expect(fila.contenido).not.toContain('RESPUESTA-PRIVADA-');
    }
    const nexia = await pool.query(
      `SELECT contenido, contenido_privado, destinatario_id FROM solicitud_mensajes WHERE solicitud_id = $1 AND autor_tipo = 'NEXIA'`,
      [sol]
    );
    expect(nexia.rows[0].contenido).toBe('Respuesta privada de NexIA: solo visible para su destinatario.');
    expect(nexia.rows[0].contenido_privado).toBe(textoPrivado);
    expect(nexia.rows[0].destinatario_id).toBe(ids.COM_A);
  });

  it('la base rechaza una respuesta de NexIA sin destinatario o sin texto privado (una instancia antigua no puede crear respuestas nuevas)', async () => {
    const sol = await solicitudNueva();
    await expect(
      pool.query(`INSERT INTO solicitud_mensajes (id, solicitud_id, autor_id, autor_tipo, contenido) VALUES (gen_random_uuid(), $1, NULL, 'NEXIA', 'texto')`, [sol])
    ).rejects.toThrow();
  });
});

describe('#8/#7 — todos los puntos de lectura respetan la privacidad (HTTP)', () => {
  it('GET de mensajes: cada usuario recibe solo lo suyo; ninguna respuesta privada ni histórica llega a otro usuario', async () => {
    const sol = await solicitudNueva();
    await insertarRespuestaHistorica(sol, 'RESPUESTA-HISTORICA-HTTP');
    await crearMensaje(sol, com('COM_A'), 'nexia consulta privada de A');
    await crearMensaje(sol, { id: ids.OPE, rol: 'OPERATIVO' }, 'mensaje compartido de operativo');
    const get = async (clave: string) => {
      const res = await fetch(`${baseUrl}/api/solicitudes/${sol}/mensajes`, { headers: { Authorization: `Bearer ${tokens[clave]}` } });
      return { status: res.status, texto: await res.text() };
    };
    const a = await get('COM_A');
    const b = await get('COM_B');
    const ope = await get('OPE');
    const admin = await get('ADMIN');

    expect(a.status).toBe(200);
    expect(a.texto).toContain('RESPUESTA-PRIVADA-');
    for (const otro of [b, ope]) {
      expect(otro.status).toBe(200);
      expect(otro.texto).not.toContain('RESPUESTA-PRIVADA-');
      expect(otro.texto).not.toContain('Respuesta privada de NexIA');
      expect(otro.texto).toContain('consulta privada de A'); // la pregunta es compartida
    }
    for (const todos of [a, b, ope]) {
      expect(todos.texto).not.toContain('HISTORICA');
    }
    expect(admin.status).toBe(403);
    expect(admin.texto).not.toContain('consulta privada');
  });

  it('la respuesta que devuelve el POST al invocador no se entrega a nadie más y la que recibe el compartido no incluye texto privado', async () => {
    const sol = await solicitudNueva();
    const res = await fetch(`${baseUrl}/api/solicitudes/${sol}/mensajes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.COM_A}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contenido: 'nexia respuesta por POST' }),
    });
    expect(res.status).toBe(201);
    const cuerpo = (await res.json()) as { mensaje: { contenido: string }; respuesta_nexia: { contenido: string; destinatario_id: string } };
    expect(cuerpo.respuesta_nexia.contenido).toContain('RESPUESTA-PRIVADA-');
    expect(cuerpo.respuesta_nexia.destinatario_id).toBe(ids.COM_A);
    expect(cuerpo.mensaje.contenido).toBe('nexia respuesta por POST');
  });
});

describe('#7 — ADMIN fuera del chat', () => {
  it('ADMIN recibe 403 al leer y al escribir; COMERCIAL y OPERATIVO acceden', async () => {
    const sol = await solicitudNueva();
    const headers = (clave: string) => ({ Authorization: `Bearer ${tokens[clave]}`, 'Content-Type': 'application/json' });

    const lecturaAdmin = await fetch(`${baseUrl}/api/solicitudes/${sol}/mensajes`, { headers: headers('ADMIN') });
    expect(lecturaAdmin.status).toBe(403);
    const envioAdmin = await fetch(`${baseUrl}/api/solicitudes/${sol}/mensajes`, {
      method: 'POST',
      headers: headers('ADMIN'),
      body: JSON.stringify({ contenido: 'hola' }),
    });
    expect(envioAdmin.status).toBe(403);

    for (const clave of ['COM_A', 'OPE']) {
      const res = await fetch(`${baseUrl}/api/solicitudes/${sol}/mensajes`, { headers: headers(clave) });
      expect(res.status).toBe(200);
    }
  });
});

describe('regresión del chat', () => {
  it('rechaza mensajes vacíos o de más de 2000 caracteres y queda en solo lectura con la solicitud cancelada', async () => {
    const sol = await solicitudNueva();
    await expect(crearMensaje(sol, com('COM_A'), '   ')).rejects.toThrow();
    await expect(crearMensaje(sol, com('COM_A'), 'x'.repeat(2001))).rejects.toThrow();
    await pool.query(`UPDATE solicitudes SET estado = 'CANCELADA' WHERE id = $1`, [sol]);
    await expect(crearMensaje(sol, com('COM_A'), 'hola')).rejects.toThrow();
    expect((await listarMensajes(sol, com('COM_A'))).modo).toBe('SOLO_LECTURA');
  });
});
