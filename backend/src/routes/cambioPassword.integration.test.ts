// Fase 2C — cambio seguro de contraseña: PATCH /api/auth/password (HTTP real) contra
// `nextproject_test` (mismo guard que el resto de pruebas de integración).
// Cada prueba usa su propio usuario ficticio (el límite de intentos es por usuario); todos se
// borran al terminar por ID (no tienen datos asociados). El correo se sustituye siempre: nunca
// se envía nada real a Brevo.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { authRouter } from './auth.routes.js';
import * as emailService from '../services/email.service.js';
import {
  cambiarPassword,
  PasswordActualIncorrectaError,
  reiniciarLimitadorPasswordParaPruebas,
} from '../services/cambioPassword.service.js';

const PASSWORD_INICIAL = 'Clave-Inicial-Prueba-77!';
const PASSWORD_NUEVA = 'Nueva-Clave-De-Prueba-2026';

let server: http.Server;
let baseUrl: string;
let rolAdminId: string;
const usuariosCreados: string[] = [];
let correoSpy: MockInstance<typeof emailService.enviarAvisoCambioPassword>;

async function crearUsuario(nombre = 'Zacarias Tester'): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `cambio-password.${randomUUID()}@nextproject-test.local`;
  await pool.query(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id) VALUES ($1, $2, $3, $4, $5)`,
    [id, nombre, email, bcrypt.hashSync(PASSWORD_INICIAL, 4), rolAdminId]
  );
  usuariosCreados.push(id);
  return { id, email };
}

async function iniciarSesion(email: string, password: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function tokenDe(email: string): Promise<string> {
  const res = await iniciarSesion(email, PASSWORD_INICIAL);
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

function cambiar(token: string | null, cuerpo: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/password`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(cuerpo),
  });
}

function me(token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
}

const valido = () => ({ passwordActual: PASSWORD_INICIAL, passwordNueva: PASSWORD_NUEVA, confirmacion: PASSWORD_NUEVA });

async function filaUsuario(id: string) {
  const r = await pool.query<{ password_hash: string; session_version: number }>(
    'SELECT password_hash, session_version FROM usuarios WHERE id = $1',
    [id]
  );
  return r.rows[0];
}

beforeAll(async () => {
  // Cualquier llamada de red que no sea al servidor local de la prueba se sustituye por una respuesta vacía.
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(input).startsWith('http://127.0.0.1')
      ? original(input, init)
      : Promise.resolve(new Response('{}', { status: 200 }))
  );

  await pool.query(
    `INSERT INTO roles (id, nombre) VALUES (gen_random_uuid(), 'ADMIN') ON CONFLICT (nombre) DO NOTHING`
  );
  rolAdminId = (await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'ADMIN'`)).rows[0].id;

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  reiniciarLimitadorPasswordParaPruebas();
  correoSpy = vi.spyOn(emailService, 'enviarAvisoCambioPassword').mockResolvedValue({ estado: 'sent' });
});

afterEach(() => {
  correoSpy.mockRestore();
});

afterAll(async () => {
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    vi.restoreAllMocks();
    if (usuariosCreados.length > 0) {
      await pool.query('DELETE FROM usuarios WHERE id = ANY($1::uuid[])', [usuariosCreados]);
    }
  }
});

describe('Cambio correcto: token nuevo e invalidación de sesiones anteriores', () => {
  it('cambia la contraseña, devuelve un token nuevo y sube la versión de sesión', async () => {
    const u = await crearUsuario();
    const tokenViejo = await tokenDe(u.email);
    expect((jwt.decode(tokenViejo) as { sv?: number }).sv).toBe(0);
    const antes = await filaUsuario(u.id);

    const res = await cambiar(tokenViejo, valido());
    expect(res.status).toBe(200);
    const data = (await res.json()) as { token: string; usuario: { id: string; email: string } };
    expect(data.token).not.toBe(tokenViejo);
    expect(data.usuario.id).toBe(u.id);
    expect((jwt.decode(data.token) as { sv?: number }).sv).toBe(1);

    const despues = await filaUsuario(u.id);
    expect(despues.session_version).toBe(1);
    expect(despues.password_hash).not.toBe(antes.password_hash);
    expect(await bcrypt.compare(PASSWORD_NUEVA, despues.password_hash)).toBe(true);
    expect(await bcrypt.compare(PASSWORD_INICIAL, despues.password_hash)).toBe(false);
  });

  it('el token anterior queda rechazado (401), el nuevo funciona y el login usa la contraseña nueva', async () => {
    const u = await crearUsuario();
    const tokenViejo = await tokenDe(u.email);
    expect((await me(tokenViejo)).status).toBe(200);

    const data = (await (await cambiar(tokenViejo, valido())).json()) as { token: string };

    expect((await me(tokenViejo)).status).toBe(401);
    expect((await me(data.token)).status).toBe(200);
    expect((await iniciarSesion(u.email, PASSWORD_INICIAL)).status).toBe(401);
    const nuevo = await iniciarSesion(u.email, PASSWORD_NUEVA);
    expect(nuevo.status).toBe(200);
    expect((jwt.decode(((await nuevo.json()) as { token: string }).token) as { sv?: number }).sv).toBe(1);
  });

  it('otra sesión abierta del mismo usuario también queda invalidada', async () => {
    const u = await crearUsuario();
    const sesionA = await tokenDe(u.email);
    const sesionB = await tokenDe(u.email);
    await cambiar(sesionA, valido());
    expect((await me(sesionB)).status).toBe(401);
  });

  it('un JWT anterior a V18 (sin «sv») vale como versión 0: funciona hasta el primer cambio y luego se rechaza', async () => {
    const u = await crearUsuario();
    const tokenLegado = jwt.sign({ sub: u.id, rol: 'ADMIN' }, env.jwtSecret, { expiresIn: '1h' });
    expect((jwt.decode(tokenLegado) as { sv?: number }).sv).toBeUndefined();
    expect((await me(tokenLegado)).status).toBe(200);

    const res = await cambiar(tokenLegado, valido());
    expect(res.status).toBe(200);
    expect((await me(tokenLegado)).status).toBe(401);
  });
});

describe('Validaciones y permisos', () => {
  it('sin sesión o con un token inválido responde 401 y no cambia nada', async () => {
    const u = await crearUsuario();
    expect((await cambiar(null, valido())).status).toBe(401);
    expect((await cambiar('token-falso', valido())).status).toBe(401);
    expect((await filaUsuario(u.id)).session_version).toBe(0);
  });

  it('solo afecta a la cuenta del token: un «usuarioId» en el cuerpo se ignora', async () => {
    const yo = await crearUsuario();
    const otro = await crearUsuario();
    const otroAntes = await filaUsuario(otro.id);
    const res = await cambiar(await tokenDe(yo.email), { ...valido(), usuarioId: otro.id, id: otro.id });
    expect(res.status).toBe(200);
    expect(await filaUsuario(otro.id)).toEqual(otroAntes);
    expect((await filaUsuario(yo.id)).session_version).toBe(1);
  });

  it('contraseña actual incorrecta: 400 (no 401, para no cerrar la sesión) y no cambia nada', async () => {
    const u = await crearUsuario();
    const token = await tokenDe(u.email);
    const res = await cambiar(token, { ...valido(), passwordActual: 'No-Es-La-Actual-123' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe('La contraseña actual no es correcta.');
    expect((await filaUsuario(u.id)).session_version).toBe(0);
    expect((await me(token)).status).toBe(200);
    expect(correoSpy).not.toHaveBeenCalled();
  });

  it('faltan campos o tienen un tipo inválido: 400', async () => {
    const token = await tokenDe((await crearUsuario()).email);
    expect((await cambiar(token, {})).status).toBe(400);
    expect((await cambiar(token, { ...valido(), confirmacion: undefined })).status).toBe(400);
    expect((await cambiar(token, { ...valido(), passwordNueva: 12345678901234 })).status).toBe(400);
  });

  it('la confirmación distinta de la nueva: 400', async () => {
    const u = await crearUsuario();
    const res = await cambiar(await tokenDe(u.email), { ...valido(), confirmacion: 'Otra-Distinta-De-La-Nueva-1' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/no coinciden/);
    expect((await filaUsuario(u.id)).session_version).toBe(0);
  });

  it('la nueva contraseña igual a la actual: 400', async () => {
    const u = await crearUsuario();
    const res = await cambiar(await tokenDe(u.email), {
      passwordActual: PASSWORD_INICIAL,
      passwordNueva: PASSWORD_INICIAL,
      confirmacion: PASSWORD_INICIAL,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/distinta de la actual/);
    expect((await filaUsuario(u.id)).session_version).toBe(0);
  });

  it('una contraseña DÉBIL se rechaza con 400 y detalle de los problemas', async () => {
    const u = await crearUsuario();
    const token = await tokenDe(u.email);
    for (const debil of ['Co1!', 'Password12345', 'aaaaaaaaaaaa', '123456789012']) {
      const res = await cambiar(token, { passwordActual: PASSWORD_INICIAL, passwordNueva: debil, confirmacion: debil });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { nivel: string; problemas: string[]; detalles: string[] };
      expect(data.nivel).toBe('DEBIL');
      expect(data.problemas.length).toBeGreaterThan(0);
      expect(data.detalles.length).toBe(data.problemas.length);
    }
    expect((await filaUsuario(u.id)).session_version).toBe(0);
  });

  it('una contraseña MEDIA también se rechaza (solo se acepta la fuerte)', async () => {
    const u = await crearUsuario();
    const token = await tokenDe(u.email);
    // 13 caracteres con poca variedad, y 11 caracteres limpios (MEDIA «en camino», sin llegar a 12)
    for (const media of ['holaholahola1', 'Zx9!Qm2#Lp7', 'Corta1!']) {
      const res = await cambiar(token, { passwordActual: PASSWORD_INICIAL, passwordNueva: media, confirmacion: media });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { nivel: string }).nivel).toBe('MEDIA');
    }
    expect((await filaUsuario(u.id)).session_version).toBe(0);
  });

  it('rechaza una contraseña que contiene el nombre del usuario', async () => {
    const u = await crearUsuario('Sergio Floreán');
    const conNombre = 'Zq#SergioFloreanLargo99';
    const res = await cambiar(await tokenDe(u.email), { passwordActual: PASSWORD_INICIAL, passwordNueva: conNombre, confirmacion: conNombre });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { problemas: string[] }).problemas).toContain('CONTIENE_DATOS');
  });

  it('rechaza más de 72 bytes aunque sea larga y variada', async () => {
    const u = await crearUsuario();
    const larga = 'Ñandú-Tornillo-Cóndor-Quebrada-Roble-Piedra-Montaña-Río-Sol-Luna-2026';
    expect(new TextEncoder().encode(larga).length).toBeGreaterThan(72);
    const res = await cambiar(await tokenDe(u.email), { passwordActual: PASSWORD_INICIAL, passwordNueva: larga, confirmacion: larga });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { problemas: string[]; detalles: string[] };
    expect(data.problemas).toContain('MAX_BYTES');
    // el usuario recibe un mensaje claro, sin términos técnicos
    expect(data.detalles).toContain('La contraseña es demasiado larga. Acórtala un poco');
    expect(data.detalles.join(' ')).not.toMatch(/bytes?/i);
  });
});

describe('Límite de intentos fallidos de contraseña actual', () => {
  it('tras 5 fallos en 15 minutos responde 429 con Retry-After, incluso con la contraseña correcta', async () => {
    const u = await crearUsuario();
    const token = await tokenDe(u.email);
    for (let i = 0; i < 5; i++) {
      const res = await cambiar(token, { ...valido(), passwordActual: `Incorrecta-${i}-Larga-Prueba` });
      expect(res.status).toBe(400);
    }
    const bloqueado = await cambiar(token, valido());
    expect(bloqueado.status).toBe(429);
    expect(Number(bloqueado.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await filaUsuario(u.id)).session_version).toBe(0);
  });

  it('el límite es por usuario: otro usuario no queda bloqueado', async () => {
    const a = await crearUsuario();
    const b = await crearUsuario();
    const tokenA = await tokenDe(a.email);
    for (let i = 0; i < 5; i++) await cambiar(tokenA, { ...valido(), passwordActual: `Incorrecta-${i}-Larga-Prueba` });
    expect((await cambiar(tokenA, valido())).status).toBe(429);
    expect((await cambiar(await tokenDe(b.email), valido())).status).toBe(200);
  });

  it('pasada la ventana de 15 minutos se puede volver a intentar (reloj simulado en el servicio)', async () => {
    const u = await crearUsuario();
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < 5; i++) {
      await expect(
        cambiarPassword({ usuarioId: u.id, passwordActual: 'Incorrecta-Larga-123', passwordNueva: PASSWORD_NUEVA, confirmacion: PASSWORD_NUEVA }, () => t0 + i)
      ).rejects.toBeInstanceOf(PasswordActualIncorrectaError);
    }
    await expect(
      cambiarPassword({ usuarioId: u.id, ...{ passwordActual: PASSWORD_INICIAL, passwordNueva: PASSWORD_NUEVA, confirmacion: PASSWORD_NUEVA } }, () => t0 + 60_000)
    ).rejects.toThrow('Demasiados intentos fallidos.');
    const ok = await cambiarPassword(
      { usuarioId: u.id, passwordActual: PASSWORD_INICIAL, passwordNueva: PASSWORD_NUEVA, confirmacion: PASSWORD_NUEVA },
      () => t0 + 16 * 60 * 1000
    );
    expect(ok.token).toBeTruthy();
  });

  it('un cambio correcto reinicia el contador de fallos', async () => {
    const u = await crearUsuario();
    const token = await tokenDe(u.email);
    for (let i = 0; i < 3; i++) await cambiar(token, { ...valido(), passwordActual: `Incorrecta-${i}-Larga-Prueba` });
    const ok = await cambiar(token, valido());
    expect(ok.status).toBe(200);
  });
});

describe('Aviso por correo y registros', () => {
  it('envía el aviso al usuario solo cuando el cambio se completa', async () => {
    const u = await crearUsuario('Ana Aviso Correo');
    await cambiar(await tokenDe(u.email), valido());
    expect(correoSpy).toHaveBeenCalledTimes(1);
    expect(correoSpy).toHaveBeenCalledWith({ destinatarioNombre: 'Ana Aviso Correo', destinatarioEmail: u.email });
  });

  it('si el envío del correo falla, el cambio igualmente se completa', async () => {
    correoSpy.mockResolvedValue({ estado: 'failed', error: 'Brevo caído' });
    const u = await crearUsuario();
    const res = await cambiar(await tokenDe(u.email), valido());
    expect(res.status).toBe(200);
    expect((await filaUsuario(u.id)).session_version).toBe(1);
  });

  it('el log de auditoría registra quién, resultado y fecha, sin contraseñas ni tokens', async () => {
    const lineas: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lineas.push(args.map(String).join(' '));
    });
    try {
      const u = await crearUsuario();
      const token = await tokenDe(u.email);
      await cambiar(token, { ...valido(), passwordActual: 'Incorrecta-Larga-Secreta-9' });
      const data = (await (await cambiar(token, valido())).json()) as { token: string };

      const auditoria = lineas.filter((l) => l.startsWith('[AUDITORIA]'));
      expect(auditoria.length).toBe(2);
      expect(auditoria.join('\n')).toContain(u.id);
      expect(auditoria.join('\n')).toContain('password_actual_incorrecta');
      expect(auditoria.join('\n')).toContain('"resultado":"ok"');

      const todo = lineas.join('\n');
      for (const secreto of [PASSWORD_INICIAL, PASSWORD_NUEVA, 'Incorrecta-Larga-Secreta-9', token, data.token]) {
        expect(todo).not.toContain(secreto);
      }
    } finally {
      log.mockRestore();
    }
  });
});
