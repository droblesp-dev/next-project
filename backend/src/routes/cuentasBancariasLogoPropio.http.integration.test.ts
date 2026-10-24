// PC-2026-01, Fase B (V17): logo PROPIO por cuenta bancaria. Dos cuentas
// comparten una entidad del catálogo que ya tiene un logo compartido; subir
// o quitar el logo de una cuenta nunca debe afectar a la otra ni al
// catálogo. Pruebas de integración reales contra `nextproject_test` (mismo
// guard obligatorio que el resto de *.integration.test.ts), con servidor
// HTTP efímero montando el router real — mismo patrón que
// cuentasBancarias.http.integration.test.ts.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { LOGOS_BANCOS_DIR } from '../config/uploadsLogosBancos.js';
import { RegistroLimpieza } from '../config/testCleanup.js';
import { esCarpetaTemporalDePruebas, escribirLogoDePrueba, esPngValido } from '../config/testLogosTemp.js';
import { listarCuentasActivasPublico } from '../services/cuentasBancarias.service.js';
import { cuentasBancariasRouter } from './cuentasBancarias.routes.js';

let server: http.Server;
let baseUrl: string;
let adminToken: string;
// IDs de todo lo que crea este archivo de pruebas: se limpian al terminar (solo ellos).
const registro = new RegistroLimpieza();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cuentas-bancarias', cuentasBancariasRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await pool.query(
    `INSERT INTO roles (id, nombre) VALUES (gen_random_uuid(), 'ADMIN') ON CONFLICT (nombre) DO NOTHING`
  );
  const rolAdmin = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'ADMIN'`);
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), 'Prueba logo propio (admin)', $1, 'placeholder', $2) RETURNING id`,
    [`logo-propio.admin.${randomUUID()}@nextproject-test.local`, rolAdmin.rows[0].id]
  );
  adminToken = jwt.sign({ sub: admin.rows[0].id, rol: 'ADMIN' }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await registro.limpiar(pool);
});

// PNG 1x1 real (firma válida).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function construirMultipart(campos: Record<string, string>, conLogo = false) {
  const boundary = `----nextprojectTestBoundary${randomUUID()}`;
  const partes: Buffer[] = [];
  for (const [clave, valor] of Object.entries(campos)) {
    partes.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${clave}"\r\n\r\n${valor}\r\n`));
  }
  if (conLogo) {
    partes.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="logo"; filename="l.png"\r\nContent-Type: image/png\r\n\r\n`
      ),
      PNG_1X1,
      Buffer.from('\r\n')
    );
  }
  partes.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(partes), contentType: `multipart/form-data; boundary=${boundary}` };
}

const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const archivoDe = (logoUrl: string | null) => (logoUrl ? path.basename(logoUrl) : null);

// Entidad del catálogo con un logo COMPARTIDO: el archivo es un PNG real y válido
// escrito en la carpeta temporal de esta ejecución (nunca en la compartida), de
// modo que la fila nunca referencia un archivo inexistente.
async function crearEntidadConLogoCompartido() {
  const nombre = `Banco LogoPropio ${randomUUID().slice(0, 8)}`;
  const logoCompartido = `compartido-${randomUUID()}.png`;
  escribirLogoDePrueba(LOGOS_BANCOS_DIR, logoCompartido);
  const entidad = await pool.query<{ id: string }>(
    `INSERT INTO bancos_catalogo (id, nombre, nombre_normalizado, logo_path, creado_por, tipo)
     SELECT gen_random_uuid(), $1, $2, $3, id, 'BANCO' FROM usuarios LIMIT 1 RETURNING id`,
    [nombre, nombre.toLowerCase(), logoCompartido]
  );
  registro.registrarEntidad(entidad.rows[0].id);
  return { entidadId: entidad.rows[0].id, nombre, logoCompartido };
}

async function crearCuenta(entidadId: string, titular: string, conLogo = false) {
  const { body, contentType } = construirMultipart(
    { bancoCatalogoId: entidadId, titular, tipoCuenta: 'AHORROS', numeroCuenta: randomUUID().slice(0, 12) },
    conLogo
  );
  const res = await fetch(`${baseUrl}/api/cuentas-bancarias`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': contentType },
    body,
  });
  expect(res.status).toBe(201);
  const id = ((await res.json()) as { cuenta: { id: string } }).cuenta.id;
  registro.registrarCuenta(id);
  return id;
}

async function editarCuenta(id: string, entidadId: string, extra: Record<string, string>, conLogo = false) {
  const { body, contentType } = construirMultipart(
    { bancoCatalogoId: entidadId, titular: 'Editado', tipoCuenta: 'AHORROS', numeroCuenta: '1', ...extra },
    conLogo
  );
  const res = await fetch(`${baseUrl}/api/cuentas-bancarias/${id}`, {
    method: 'PATCH',
    headers: { ...auth(), 'Content-Type': contentType },
    body,
  });
  expect(res.status).toBe(200);
}

type Fila = { id: string; logo_url: string | null; logo_propio: boolean };
async function leerCuenta(id: string): Promise<Fila> {
  const res = await fetch(`${baseUrl}/api/cuentas-bancarias`, { headers: auth() });
  const data = (await res.json()) as { cuentas: Fila[] };
  return data.cuentas.find((c) => c.id === id)!;
}

async function logoCatalogoBD(entidadId: string) {
  const r = await pool.query<{ logo_path: string | null }>(`SELECT logo_path FROM bancos_catalogo WHERE id = $1`, [
    entidadId,
  ]);
  return r.rows[0].logo_path;
}

describe('logo propio por cuenta (Fase B, V17), nextproject_test', () => {
  it('las pruebas trabajan en una carpeta temporal propia y los logos referenciados existen como PNG reales', async () => {
    expect(esCarpetaTemporalDePruebas(LOGOS_BANCOS_DIR)).toBe(true);
    const { entidadId, logoCompartido } = await crearEntidadConLogoCompartido();
    const ruta = path.join(LOGOS_BANCOS_DIR, logoCompartido);
    expect(fs.existsSync(ruta)).toBe(true);
    expect(esPngValido(fs.readFileSync(ruta))).toBe(true);
    expect(await logoCatalogoBD(entidadId)).toBe(logoCompartido);
    // y un logo propio subido por la API también queda como archivo real en esa carpeta
    const a = await crearCuenta(entidadId, 'A', true);
    const propio = archivoDe((await leerCuenta(a)).logo_url)!;
    expect(esPngValido(fs.readFileSync(path.join(LOGOS_BANCOS_DIR, propio)))).toBe(true);
  });

  it('las cuentas sin logo propio muestran el logo heredado de su entidad (logo_propio=false)', async () => {
    const { entidadId, logoCompartido } = await crearEntidadConLogoCompartido();
    const a = await crearCuenta(entidadId, 'A');
    const fila = await leerCuenta(a);
    expect(fila.logo_propio).toBe(false);
    expect(archivoDe(fila.logo_url)).toBe(logoCompartido);
  });

  it('subir un logo a la cuenta A no cambia el de la cuenta B ni el del catálogo', async () => {
    const { entidadId, logoCompartido } = await crearEntidadConLogoCompartido();
    const a = await crearCuenta(entidadId, 'A');
    const b = await crearCuenta(entidadId, 'B');

    await editarCuenta(a, entidadId, {}, true);

    const filaA = await leerCuenta(a);
    expect(filaA.logo_propio).toBe(true);
    expect(archivoDe(filaA.logo_url)).not.toBe(logoCompartido);
    expect(fs.existsSync(path.join(LOGOS_BANCOS_DIR, archivoDe(filaA.logo_url)!))).toBe(true);

    const filaB = await leerCuenta(b);
    expect(filaB.logo_propio).toBe(false);
    expect(archivoDe(filaB.logo_url)).toBe(logoCompartido);
    expect(await logoCatalogoBD(entidadId)).toBe(logoCompartido);

    const resCat = await fetch(`${baseUrl}/api/cuentas-bancarias/catalogo-bancos`, { headers: auth() });
    const cat = (await resCat.json()) as { bancos: { id: string; logo_url: string | null }[] };
    expect(archivoDe(cat.bancos.find((x) => x.id === entidadId)!.logo_url)).toBe(logoCompartido);
  });

  it('quitar el logo propio de A solo desasocia A: vuelve al heredado, B y el catálogo no cambian y ningún archivo se borra', async () => {
    const { entidadId, logoCompartido } = await crearEntidadConLogoCompartido();
    const a = await crearCuenta(entidadId, 'A', true);
    const b = await crearCuenta(entidadId, 'B', true);
    const archivoPropioA = archivoDe((await leerCuenta(a)).logo_url)!;
    const archivoPropioB = archivoDe((await leerCuenta(b)).logo_url)!;
    expect(archivoPropioA).not.toBe(archivoPropioB);

    await editarCuenta(a, entidadId, { quitarLogo: 'true' });

    const filaA = await leerCuenta(a);
    expect(filaA.logo_propio).toBe(false);
    expect(archivoDe(filaA.logo_url)).toBe(logoCompartido);
    const filaB = await leerCuenta(b);
    expect(filaB.logo_propio).toBe(true);
    expect(archivoDe(filaB.logo_url)).toBe(archivoPropioB);
    expect(await logoCatalogoBD(entidadId)).toBe(logoCompartido);
    // Política prudente: ningún archivo se elimina automáticamente.
    expect(fs.existsSync(path.join(LOGOS_BANCOS_DIR, archivoPropioA))).toBe(true);
    expect(fs.existsSync(path.join(LOGOS_BANCOS_DIR, archivoPropioB))).toBe(true);
  });

  it('quitarLogo en una cuenta que solo hereda no hace nada: el logo compartido sigue intacto para todas', async () => {
    const { entidadId, logoCompartido } = await crearEntidadConLogoCompartido();
    const a = await crearCuenta(entidadId, 'A');
    const b = await crearCuenta(entidadId, 'B');

    await editarCuenta(a, entidadId, { quitarLogo: 'true' });

    expect(archivoDe((await leerCuenta(a)).logo_url)).toBe(logoCompartido);
    expect(archivoDe((await leerCuenta(b)).logo_url)).toBe(logoCompartido);
    expect(await logoCatalogoBD(entidadId)).toBe(logoCompartido);
  });

  it('editar otros campos conserva el logo propio (no se pierde al guardar sin tocar el logo)', async () => {
    const { entidadId } = await crearEntidadConLogoCompartido();
    const a = await crearCuenta(entidadId, 'A', true);
    const antes = archivoDe((await leerCuenta(a)).logo_url);
    await editarCuenta(a, entidadId, { titular: 'Solo titular' });
    const despues = await leerCuenta(a);
    expect(despues.logo_propio).toBe(true);
    expect(archivoDe(despues.logo_url)).toBe(antes);
  });

  it('crear una cuenta con logo sobre una entidad existente no modifica el logo del catálogo', async () => {
    const { entidadId, logoCompartido } = await crearEntidadConLogoCompartido();
    const a = await crearCuenta(entidadId, 'A', true);
    expect((await leerCuenta(a)).logo_propio).toBe(true);
    expect(await logoCatalogoBD(entidadId)).toBe(logoCompartido);
  });

  it('una entidad personalizada nueva con logo lo guarda en la cuenta, no en el catálogo', async () => {
    const nombre = `Banco NuevaEnt ${randomUUID().slice(0, 8)}`;
    const { body, contentType } = construirMultipart(
      { bancoPersonalizadoNombre: nombre, titular: 'T', tipoCuenta: 'AHORROS', numeroCuenta: '7' },
      true
    );
    const res = await fetch(`${baseUrl}/api/cuentas-bancarias`, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': contentType },
      body,
    });
    expect(res.status).toBe(201);
    const { cuenta } = (await res.json()) as { cuenta: { id: string; banco_catalogo_id: string } };
    registro.registrarCuenta(cuenta.id);
    registro.registrarEntidad(cuenta.banco_catalogo_id);
    expect((await leerCuenta(cuenta.id)).logo_propio).toBe(true);
    expect(await logoCatalogoBD(cuenta.banco_catalogo_id)).toBeNull();
  });

  it('cambiar la cuenta a otra entidad sin archivo nuevo desasocia su logo propio anterior', async () => {
    const e1 = await crearEntidadConLogoCompartido();
    const e2 = await crearEntidadConLogoCompartido();
    const a = await crearCuenta(e1.entidadId, 'A', true);
    await editarCuenta(a, e2.entidadId, {});
    const fila = await leerCuenta(a);
    expect(fila.logo_propio).toBe(false);
    expect(archivoDe(fila.logo_url)).toBe(e2.logoCompartido);
    expect(await logoCatalogoBD(e1.entidadId)).toBe(e1.logoCompartido);
  });

  it('la consulta pública de cuentas activas usa el logo efectivo (propio, o heredado si no hay)', async () => {
    const { entidadId, nombre, logoCompartido } = await crearEntidadConLogoCompartido();
    const a = await crearCuenta(entidadId, 'A', true);
    await crearCuenta(entidadId, 'B');
    const propioA = archivoDe((await leerCuenta(a)).logo_url);
    const publicas = (await listarCuentasActivasPublico()).filter((c) => c.banco === nombre);
    expect(publicas.map((c) => archivoDe(c.logo_url)).sort()).toEqual([logoCompartido, propioA].sort());
    for (const c of publicas) expect(Object.keys(c)).not.toContain('logo_path');
  });

  it('las respuestas de cuenta individual no exponen el nombre de archivo del logo propio', async () => {
    const { entidadId } = await crearEntidadConLogoCompartido();
    const a = await crearCuenta(entidadId, 'A', true);
    const res = await fetch(`${baseUrl}/api/cuentas-bancarias/${a}`, { headers: auth() });
    const { cuenta } = (await res.json()) as { cuenta: Record<string, unknown> };
    expect(cuenta.logo_propio).toBe(true);
    expect('logo_propio_path' in cuenta).toBe(false);
    expect('logo_path' in cuenta).toBe(false);
  });
});
