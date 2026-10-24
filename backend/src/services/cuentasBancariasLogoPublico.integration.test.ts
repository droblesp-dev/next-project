// PC-2026-01, Fase B (V17): el DTO PÚBLICO de cotizaciones debe usar el logo
// efectivo de cada cuenta activa (propio, o heredado de la entidad) sin
// exponer nombres de campo internos. Se construye una cotización ficticia
// con token y código sintéticos en `nextproject_test` — nunca datos ni
// tokens reales. Los servicios se invocan directamente y `fetch` se
// sustituye por un doble para que no salga ningún correo ni mensaje.
import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { pool } from '../config/db.js';
import { LOGOS_BANCOS_DIR } from '../config/uploadsLogosBancos.js';
import { RegistroLimpieza } from '../config/testCleanup.js';
import { escribirLogoDePrueba, PNG_1X1_VALIDO } from '../config/testLogosTemp.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import {
  crearCotizacion,
  cambiarEstadoCotizacion,
  generarEnlaceCotizacion,
  verificarCodigoCotizacion,
} from './cotizaciones.service.js';
import { crearCuentaBancaria } from './cuentasBancarias.service.js';

let usuarioId: string;
const registro = new RegistroLimpieza();

afterAll(async () => {
  // Solo las entidades y cuentas que creó esta prueba (por ID). La solicitud, el
  // cliente y la cotización ficticios no referencian logos y no se tocan.
  await registro.limpiar(pool);
});

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  const rol = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'COMERCIAL'`);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), 'Prueba logo publico (usuario)', $1, 'placeholder-no-usado-para-login', $2) RETURNING id`,
    [`logo-publico.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  usuarioId = u.rows[0].id;
});

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function cotizacionPublicaPorTransferencia() {
  const sufijo = randomUUID();
  const resultado = await crearSolicitud(
    {
      nombre: 'Prueba logo publico',
      empresa: null,
      email: `logo-publico.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio ficticio logo publico',
      descripcion: 'Registro ficticio de integración (logo público).',
      cantidad: 1,
    },
    `logo-publico-${sufijo}`
  );
  await cambiarEstadoSolicitud(resultado.solicitud.id, 'EN_REVISION');
  const cotizacion = await crearCotizacion({
    solicitudId: resultado.solicitud.id,
    valor: 100,
    descripcion: null,
    creadoPor: usuarioId,
    anticipoPorcentaje: 50,
    metodoAnticipo: 'TRANSFERENCIA',
  });
  await cambiarEstadoCotizacion(cotizacion.id, 'ENVIADA');
  return generarEnlaceCotizacion(cotizacion.id);
}

describe('Consulta pública de cotizaciones — logo efectivo de las cuentas (Fase B), nextproject_test', () => {
  it('lista el logo propio de una cuenta y el heredado de otra, sin exponer logo_path ni logo_propio_path', async () => {
    const nombre = `Banco LogoPublico ${randomUUID().slice(0, 8)}`;
    const logoCompartido = `compartido-${randomUUID()}.png`;
    const logoPropio = `propio-${randomUUID()}.png`;
    // Archivos reales (PNG válido) en la carpeta temporal de esta ejecución.
    escribirLogoDePrueba(LOGOS_BANCOS_DIR, logoCompartido);
    escribirLogoDePrueba(LOGOS_BANCOS_DIR, logoPropio);
    const entidad = await pool.query<{ id: string }>(
      `INSERT INTO bancos_catalogo (id, nombre, nombre_normalizado, logo_path, creado_por, tipo)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'BANCO') RETURNING id`,
      [nombre, nombre.toLowerCase(), logoCompartido, usuarioId]
    );
    const entidadId = entidad.rows[0].id;
    registro.registrarEntidad(entidadId);
    const datos = (titular: string) => ({
      titular,
      tipoCuenta: 'AHORROS',
      numeroCuenta: randomUUID().slice(0, 12),
      bancoCatalogoId: entidadId,
    });
    // El archivo del logo propio ya está escrito arriba (el servicio no escribe a disco).
    const cuentaHereda = await crearCuentaBancaria({ ...datos('Hereda') }, usuarioId);
    const cuentaPropia = await crearCuentaBancaria(
      { ...datos('Propia'), logo: { nombreArchivo: logoPropio, buffer: PNG_1X1_VALIDO } },
      usuarioId
    );
    registro.registrarCuenta(cuentaHereda.cuenta.id);
    registro.registrarCuenta(cuentaPropia.cuenta.id);
    expect(fs.existsSync(path.join(LOGOS_BANCOS_DIR, logoCompartido))).toBe(true);
    expect(fs.existsSync(path.join(LOGOS_BANCOS_DIR, logoPropio))).toBe(true);

    const { token, codigo } = await cotizacionPublicaPorTransferencia();
    const publica = await verificarCodigoCotizacion(token, codigo);

    const mias = publica.cuentas_bancarias_activas.filter((c) => c.banco === nombre);
    expect(mias).toHaveLength(2);
    expect(mias.map((c) => (c.logo_url ? path.basename(c.logo_url) : null)).sort()).toEqual(
      [logoCompartido, logoPropio].sort()
    );
    for (const c of mias) {
      expect(c.logo_url).toMatch(/^\/uploads\/logos-bancos\//);
      expect(Object.keys(c).sort()).toEqual(['banco', 'logo_url', 'numero_cuenta', 'tipo_cuenta', 'titular']);
    }
    // Ningún campo interno en toda la respuesta pública.
    const json = JSON.stringify(publica);
    expect(json).not.toContain('logo_path');
    expect(json).not.toContain('logo_propio');
  });
});
