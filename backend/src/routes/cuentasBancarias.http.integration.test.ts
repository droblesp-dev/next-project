// "PC-2026-01 — Implementación completa de Gestión de Cuentas Bancarias"
// (autorización explícita): valida el contrato HTTP real (multipart,
// catálogo de bancos, logo, deduplicación, visibilidad del titular) de
// `cuentasBancariasRouter` — no solo el servicio, también el cableado real
// de multer + Express. Mismo patrón que
// routes/codigoSolicitudSeguridad.integration.test.ts y
// routes/usuariosAdminsActivos.integration.test.ts: servidor HTTP real y
// efímero montando el router ya exportado, sin tocar server.ts, sin
// supertest. Pruebas de integración reales contra `nextproject_test` —
// mismo guard obligatorio que el resto de *.integration.test.ts, nunca se
// ejecuta contra `nextproject`.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { LOGOS_BANCOS_DIR } from '../config/uploadsLogosBancos.js';
import { RegistroLimpieza } from '../config/testCleanup.js';
import { esCarpetaTemporalDePruebas, esPngValido } from '../config/testLogosTemp.js';
import { cuentasBancariasRouter } from './cuentasBancarias.routes.js';

let server: http.Server;
let baseUrl: string;
let adminToken: string;
let comercialToken: string;

// IDs de las cuentas y entidades que crea este archivo: se limpian al terminar
// (solo ellos; nunca por patrón). Se registran EN CUANTO se crean, antes de las
// aserciones, para que la limpieza también ocurra si una aserción falla.
const registro = new RegistroLimpieza();

// Registra la cuenta y la entidad del catálogo creadas por una respuesta de POST.
// Todas las pruebas de este archivo crean la entidad con un nombre único
// (bancoPersonalizadoNombre), así que la entidad pertenece a la propia prueba.
async function registrarCreacion(res: Response): Promise<void> {
  const cuerpo = (await res.clone().json().catch(() => null)) as {
    cuenta?: { id?: string; banco_catalogo_id?: string | null };
  } | null;
  registro.registrarCuenta(cuerpo?.cuenta?.id);
  registro.registrarEntidad(cuerpo?.cuenta?.banco_catalogo_id);
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cuentas-bancarias', cuentasBancariasRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  const rolAdmin = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'ADMIN'`);
  const rolComercial = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'COMERCIAL'`);
  const sufijo = randomUUID();

  const admin = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), 'Prueba HTTP Cuentas (admin)', $1, 'placeholder', $2) RETURNING id`,
    [`cuentas-http.admin.${sufijo}@nextproject-test.local`, rolAdmin.rows[0].id]
  );
  const comercial = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), 'Prueba HTTP Cuentas (comercial)', $1, 'placeholder', $2) RETURNING id`,
    [`cuentas-http.comercial.${sufijo}@nextproject-test.local`, rolComercial.rows[0].id]
  );

  adminToken = jwt.sign({ sub: admin.rows[0].id, rol: 'ADMIN' }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
  comercialToken = jwt.sign({ sub: comercial.rows[0].id, rol: 'COMERCIAL' }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
});

afterAll(async () => {
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    // Si hay dependencias inesperadas, limpiar() revierte y lanza (no fuerza nada).
    await registro.limpiar(pool);
  }
});

function nombreBancoUnico(etiqueta: string) {
  return `Banco HTTP ${etiqueta} ${randomUUID().slice(0, 8)}`;
}

// PNG 1x1 real (firma válida) — usado para probar la ruta de éxito de
// carga de logo con contenido real, no solo un mimetype declarado.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function construirMultipart(campos: Record<string, string>, archivo?: { campo: string; nombre: string; tipo: string; datos: Buffer }) {
  const boundary = `----nextprojectTestBoundary${randomUUID()}`;
  const partes: Buffer[] = [];
  for (const [clave, valor] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${clave}"\r\n\r\n${valor}\r\n`));
  }
  if (archivo) {
    partes.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${archivo.campo}"; filename="${archivo.nombre}"\r\nContent-Type: ${archivo.tipo}\r\n\r\n`
      ),
      archivo.datos,
      Buffer.from('\r\n')
    );
  }
  partes.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(partes), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('cuentasBancariasRouter — contrato HTTP real (multipart, catálogo, logo), nextproject_test', () => {
  it('GET /catalogo-bancos requiere ADMIN y nunca requireRole la confunde con /:id', async () => {
    const resSinAuth = await fetch(`${baseUrl}/api/cuentas-bancarias/catalogo-bancos`);
    expect(resSinAuth.status).toBe(401);

    const resComercial = await fetch(`${baseUrl}/api/cuentas-bancarias/catalogo-bancos`, {
      headers: { Authorization: `Bearer ${comercialToken}` },
    });
    expect(resComercial.status).toBe(403);

    const resAdmin = await fetch(`${baseUrl}/api/cuentas-bancarias/catalogo-bancos`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(resAdmin.status).toBe(200);
    const data = (await resAdmin.json()) as { bancos: { id: string; nombre: string; logo_url: string | null }[] };
    expect(Array.isArray(data.bancos)).toBe(true);
  });

  it('POST /: crea una cuenta con banco personalizado (multipart) y la expone con logo_url en el listado', async () => {
    const nombreBanco = nombreBancoUnico('CREAR');
    const { body, contentType } = construirMultipart({
      bancoPersonalizadoNombre: nombreBanco,
      titular: 'Centro de Mecanizado Industrial',
      tipoCuenta: 'AHORROS',
      numeroCuenta: '9999',
      activo: 'true',
      titularVisibleCliente: 'true',
    });

    const resCrear = await fetch(`${baseUrl}/api/cuentas-bancarias`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': contentType },
      body,
    });
    await registrarCreacion(resCrear);
    expect(resCrear.status).toBe(201);
    const dataCrear = (await resCrear.json()) as { cuenta: { id: string; banco: string; banco_catalogo_id: string } };
    expect(dataCrear.cuenta.banco).toBe(nombreBanco);

    const resListar = await fetch(`${baseUrl}/api/cuentas-bancarias`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const dataListar = (await resListar.json()) as { cuentas: { id: string; logo_url: string | null }[] };
    const fila = dataListar.cuentas.find((c) => c.id === dataCrear.cuenta.id);
    expect(fila).toBeDefined();
    expect(fila!.logo_url).toBeNull();
  });

  it('POST /: adjuntar un logo PNG real con contenido válido lo acepta y lo expone en logo_url', async () => {
    const nombreBanco = nombreBancoUnico('LOGO');
    const { body, contentType } = construirMultipart(
      { bancoPersonalizadoNombre: nombreBanco, titular: 'T', tipoCuenta: 'AHORROS', numeroCuenta: '1' },
      { campo: 'logo', nombre: 'logo.png', tipo: 'image/png', datos: PNG_1X1 }
    );

    const response = await fetch(`${baseUrl}/api/cuentas-bancarias`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': contentType },
      body,
    });
    await registrarCreacion(response);
    expect(response.status).toBe(201);
    const data = (await response.json()) as { cuenta: { id: string } };

    const resListar = await fetch(`${baseUrl}/api/cuentas-bancarias`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const dataListar = (await resListar.json()) as { cuentas: { id: string; logo_url: string | null }[] };
    const fila = dataListar.cuentas.find((c) => c.id === data.cuenta.id);

    // El logo se escribió en la carpeta TEMPORAL configurada por el setup (nunca
    // en la compartida) y es un PNG real mientras la fila lo referencia.
    expect(esCarpetaTemporalDePruebas(LOGOS_BANCOS_DIR)).toBe(true);
    const archivo = path.join(LOGOS_BANCOS_DIR, path.basename(fila!.logo_url!));
    expect(fs.existsSync(archivo)).toBe(true);
    expect(esPngValido(fs.readFileSync(archivo))).toBe(true);
    expect(fila?.logo_url).toMatch(/^\/uploads\/logos-bancos\/.+\.png$/);
  });

  it('POST /: un archivo cuyo contenido real no es PNG/JPEG (aunque declare serlo) se rechaza con 400', async () => {
    const nombreBanco = nombreBancoUnico('FALSO');
    const contenidoFalso = Buffer.from('esto no es una imagen, es texto plano');
    const { body, contentType } = construirMultipart(
      { bancoPersonalizadoNombre: nombreBanco, titular: 'T', tipoCuenta: 'AHORROS', numeroCuenta: '1' },
      { campo: 'logo', nombre: 'logo.png', tipo: 'image/png', datos: contenidoFalso }
    );

    const response = await fetch(`${baseUrl}/api/cuentas-bancarias`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': contentType },
      body,
    });
    expect(response.status).toBe(400);
    const data = (await response.json()) as { message: string };
    expect(data.message).toMatch(/contenido del archivo/i);
  });

  it('POST /: sin banco (ni catálogo ni personalizado) responde 400', async () => {
    const { body, contentType } = construirMultipart({ titular: 'T', tipoCuenta: 'AHORROS', numeroCuenta: '1' });
    const response = await fetch(`${baseUrl}/api/cuentas-bancarias`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': contentType },
      body,
    });
    expect(response.status).toBe(400);
  });

  it('PATCH /:id: edita titular y puede quitar el logo previamente asignado', async () => {
    const nombreBanco = nombreBancoUnico('QUITAR');
    const { body: bodyCrear, contentType: ctCrear } = construirMultipart(
      { bancoPersonalizadoNombre: nombreBanco, titular: 'Original', tipoCuenta: 'AHORROS', numeroCuenta: '1' },
      { campo: 'logo', nombre: 'logo.png', tipo: 'image/png', datos: PNG_1X1 }
    );
    const resCrear = await fetch(`${baseUrl}/api/cuentas-bancarias`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': ctCrear },
      body: bodyCrear,
    });
    await registrarCreacion(resCrear);
    const dataCrear = (await resCrear.json()) as { cuenta: { id: string; banco_catalogo_id: string } };

    const { body: bodyEditar, contentType: ctEditar } = construirMultipart({
      bancoCatalogoId: dataCrear.cuenta.banco_catalogo_id,
      titular: 'Editado',
      tipoCuenta: 'AHORROS',
      numeroCuenta: '1',
      quitarLogo: 'true',
    });
    const resEditar = await fetch(`${baseUrl}/api/cuentas-bancarias/${dataCrear.cuenta.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': ctEditar },
      body: bodyEditar,
    });
    expect(resEditar.status).toBe(200);
    const dataEditar = (await resEditar.json()) as { cuenta: { titular: string } };
    expect(dataEditar.cuenta.titular).toBe('Editado');

    const resListar = await fetch(`${baseUrl}/api/cuentas-bancarias`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const dataListar = (await resListar.json()) as { cuentas: { id: string; logo_url: string | null }[] };
    const fila = dataListar.cuentas.find((c) => c.id === dataCrear.cuenta.id);
    expect(fila?.logo_url).toBeNull();
  });

  // PC-2026-01, Fase 1 ("Incorporar tipos de entidad financiera", V16):
  // contrato HTTP real del campo tipo — multipart real, servidor real.
  it('POST / con tipoEntidad=COOPERATIVA crea la entidad del catálogo clasificada correctamente, visible por GET /catalogo-bancos', async () => {
    const nombreCoop = nombreBancoUnico('COOP');
    const { body, contentType } = construirMultipart({
      bancoPersonalizadoNombre: nombreCoop,
      tipoEntidad: 'COOPERATIVA',
      titular: 'T',
      tipoCuenta: 'AHORROS',
      numeroCuenta: '1',
    });
    const resCrear = await fetch(`${baseUrl}/api/cuentas-bancarias`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': contentType },
      body,
    });
    await registrarCreacion(resCrear);
    expect(resCrear.status).toBe(201);

    const resCatalogo = await fetch(`${baseUrl}/api/cuentas-bancarias/catalogo-bancos`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const dataCatalogo = (await resCatalogo.json()) as { bancos: { nombre: string; tipo: string }[] };
    const fila = dataCatalogo.bancos.find((b) => b.nombre === nombreCoop);
    expect(fila?.tipo).toBe('COOPERATIVA');
  });

  it('POST / con un tipoEntidad inválido responde 400 y no crea nada', async () => {
    const nombreInvalido = nombreBancoUnico('TIPOINVALIDO');
    const { body, contentType } = construirMultipart({
      bancoPersonalizadoNombre: nombreInvalido,
      tipoEntidad: 'FINTECH',
      titular: 'T',
      tipoCuenta: 'AHORROS',
      numeroCuenta: '1',
    });
    const response = await fetch(`${baseUrl}/api/cuentas-bancarias`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': contentType },
      body,
    });
    expect(response.status).toBe(400);

    const resCatalogo = await fetch(`${baseUrl}/api/cuentas-bancarias/catalogo-bancos`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const dataCatalogo = (await resCatalogo.json()) as { bancos: { nombre: string }[] };
    expect(dataCatalogo.bancos.some((b) => b.nombre === nombreInvalido)).toBe(false);
  });

  it('COMERCIAL recibe 403 al intentar crear una cuenta bancaria', async () => {
    const { body, contentType } = construirMultipart({
      bancoPersonalizadoNombre: nombreBancoUnico('COMERCIAL'),
      titular: 'T',
      tipoCuenta: 'AHORROS',
      numeroCuenta: '1',
    });
    const response = await fetch(`${baseUrl}/api/cuentas-bancarias`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${comercialToken}`, 'Content-Type': contentType },
      body,
    });
    expect(response.status).toBe(403);
  });

  // Fase A: datos demasiado largos devuelven 400 con mensaje claro (antes
  // llegaban a PostgreSQL y terminaban en un 500 genérico).
  describe('límites de longitud (Fase A)', () => {
    async function crearConCampos(campos: Record<string, string>) {
      const { body, contentType } = construirMultipart(campos);
      return fetch(`${baseUrl}/api/cuentas-bancarias`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': contentType },
        body,
      });
    }
    const base = () => ({
      bancoPersonalizadoNombre: nombreBancoUnico('LIMITES'),
      titular: 'Centro de Mecanizado Industrial',
      tipoCuenta: 'AHORROS',
      numeroCuenta: '1234',
    });

    it('POST / con titular de 61 caracteres responde 400 con mensaje claro', async () => {
      const res = await crearConCampos({ ...base(), titular: 'T'.repeat(61) });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { message: string };
      expect(data.message).toMatch(/titular.*60/);
    });

    it('POST / con número de cuenta de 21 caracteres responde 400', async () => {
      const res = await crearConCampos({ ...base(), numeroCuenta: '9'.repeat(21) });
      expect(res.status).toBe(400);
      const data = (await res.json()) as { message: string };
      expect(data.message).toMatch(/numeroCuenta.*20/);
    });

    it('POST / con nombre de banco personalizado de 101 caracteres responde 400 y no crea la entidad', async () => {
      const nombreLargo = 'B'.repeat(101);
      const res = await crearConCampos({ ...base(), bancoPersonalizadoNombre: nombreLargo });
      expect(res.status).toBe(400);
      const resCatalogo = await fetch(`${baseUrl}/api/cuentas-bancarias/catalogo-bancos`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const dataCatalogo = (await resCatalogo.json()) as { bancos: { nombre: string }[] };
      expect(dataCatalogo.bancos.some((b) => b.nombre === nombreLargo)).toBe(false);
    });

    it('PATCH /:id con titular de 61 caracteres responde 400 (no 500)', async () => {
      const { body, contentType } = construirMultipart({ ...base(), titular: 'T'.repeat(61) });
      const res = await fetch(`${baseUrl}/api/cuentas-bancarias/${randomUUID()}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': contentType },
        body,
      });
      expect(res.status).toBe(400);
    });
  });
});
