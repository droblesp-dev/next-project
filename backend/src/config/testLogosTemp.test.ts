import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolverDirLogosBancos } from './uploadsLogosBancos.js';
import {
  CarpetaTemporalInvalidaError,
  crearCarpetaTemporalLogos,
  esCarpetaTemporalDePruebas,
  escribirLogoDePrueba,
  esPngValido,
  limpiarCarpetaTemporalLogos,
  PNG_1X1_VALIDO,
  PREFIJO_CARPETA_TEMPORAL_LOGOS,
  rutaCompartidaPorDefecto,
} from './testLogosTemp.js';
import { LimpiezaBloqueadaError, RegistroLimpieza } from './testCleanup.js';

// Pruebas UNITARIAS (sin PostgreSQL): configuración de la carpeta de logos,
// carpeta temporal de pruebas y salvaguardas de la limpieza por IDs.

const creadasPorEstaPrueba: string[] = [];
afterEach(() => {
  // Red de seguridad: borra solo las carpetas temporales que creó esta prueba.
  for (const dir of creadasPorEstaPrueba.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('configuración de la carpeta de logos (producción conserva su ruta)', () => {
  const porDefecto = path.resolve(process.cwd(), 'uploads', 'logos-bancos');

  it('sin variable de entorno (o vacía / solo espacios) la ruta es exactamente la de siempre', () => {
    expect(resolverDirLogosBancos(undefined, process.cwd())).toBe(porDefecto);
    expect(resolverDirLogosBancos('', process.cwd())).toBe(porDefecto);
    expect(resolverDirLogosBancos('   ', process.cwd())).toBe(porDefecto);
  });

  it('la ruta compartida que usa el helper de pruebas coincide con la predeterminada de producción', () => {
    expect(rutaCompartidaPorDefecto()).toBe(resolverDirLogosBancos(undefined, process.cwd()));
  });

  it('con LOGOS_BANCOS_DIR usa esa carpeta, resuelta a ruta absoluta', () => {
    const otra = path.join(os.tmpdir(), 'otra-carpeta-de-logos');
    expect(resolverDirLogosBancos(otra, process.cwd())).toBe(path.resolve(otra));
    expect(path.isAbsolute(resolverDirLogosBancos('relativa/logos', process.cwd()))).toBe(true);
  });

  it('el módulo real, sin LOGOS_BANCOS_DIR, exporta la ruta predeterminada; con ella, la configurada', async () => {
    delete process.env.LOGOS_BANCOS_DIR;
    vi.resetModules();
    const sinVariable = await import('./uploadsLogosBancos.js');
    expect(sinVariable.LOGOS_BANCOS_DIR).toBe(porDefecto);

    const otra = path.join(os.tmpdir(), 'nextproject-prueba-config-logos');
    vi.stubEnv('LOGOS_BANCOS_DIR', otra);
    vi.resetModules();
    const conVariable = await import('./uploadsLogosBancos.js');
    expect(conVariable.LOGOS_BANCOS_DIR).toBe(path.resolve(otra));
  });
});

describe('carpeta temporal de logos para pruebas', () => {
  it('se crea dentro de la carpeta temporal del sistema, con prefijo propio, y no es la compartida', () => {
    const { dir } = crearCarpetaTemporalLogos();
    creadasPorEstaPrueba.push(dir);
    expect(fs.existsSync(dir)).toBe(true);
    expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(dir).startsWith(PREFIJO_CARPETA_TEMPORAL_LOGOS)).toBe(true);
    expect(esCarpetaTemporalDePruebas(dir)).toBe(true);
    expect(esCarpetaTemporalDePruebas(resolverDirLogosBancos(undefined, process.cwd()))).toBe(false);
  });

  it('cada llamada devuelve una carpeta distinta', () => {
    const a = crearCarpetaTemporalLogos();
    const b = crearCarpetaTemporalLogos();
    creadasPorEstaPrueba.push(a.dir, b.dir);
    expect(a.dir).not.toBe(b.dir);
  });

  it('el logo de prueba es un PNG real y válido y existe mientras la carpeta existe', () => {
    const { dir } = crearCarpetaTemporalLogos();
    creadasPorEstaPrueba.push(dir);
    const ruta = escribirLogoDePrueba(dir, 'logo-de-prueba.png');
    expect(fs.existsSync(ruta)).toBe(true);
    expect(esPngValido(fs.readFileSync(ruta))).toBe(true);
    expect(esPngValido(PNG_1X1_VALIDO)).toBe(true);
    expect(esPngValido(Buffer.from('no soy una imagen'))).toBe(false);
  });

  it('limpiar elimina la carpeta y sus archivos, y es idempotente', () => {
    const { dir, limpiar } = crearCarpetaTemporalLogos();
    escribirLogoDePrueba(dir, 'a.png');
    escribirLogoDePrueba(dir, 'b.png');
    limpiar();
    expect(fs.existsSync(dir)).toBe(false);
    expect(() => limpiar()).not.toThrow();
  });

  it('rechaza borrar o escribir en cualquier ruta que no sea una carpeta temporal de pruebas (sin tocar el disco)', () => {
    const compartida = resolverDirLogosBancos(undefined, process.cwd());
    const existiaCompartida = fs.existsSync(compartida);
    const ajena = fs.mkdtempSync(path.join(os.tmpdir(), 'otra-cosa-'));
    creadasPorEstaPrueba.push(ajena);
    fs.writeFileSync(path.join(ajena, 'conservame.txt'), 'x');

    expect(() => limpiarCarpetaTemporalLogos(compartida)).toThrow(CarpetaTemporalInvalidaError);
    expect(() => limpiarCarpetaTemporalLogos(ajena)).toThrow(CarpetaTemporalInvalidaError);
    expect(() => limpiarCarpetaTemporalLogos(os.tmpdir())).toThrow(CarpetaTemporalInvalidaError);
    expect(() => escribirLogoDePrueba(compartida, 'x.png')).toThrow(CarpetaTemporalInvalidaError);

    expect(fs.existsSync(path.join(ajena, 'conservame.txt'))).toBe(true);
    expect(fs.existsSync(compartida)).toBe(existiaCompartida);
  });
});

// Doble mínimo de `pg.Pool`: registra las sentencias para comprobar qué se ejecuta.
function poolFalso(respuestas: { base?: string; pagos?: unknown[]; ajenas?: unknown[] }) {
  const sentencias: string[] = [];
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      sentencias.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.startsWith('DELETE')) return { rowCount: 1, rows: [] };
      if (sql.includes('current_database')) return { rows: [{ base: respuestas.base ?? 'nextproject_test' }] };
      if (sql.includes('FROM transferencias_pago')) return { rows: respuestas.pagos ?? [] };
      if (sql.includes('FROM cuentas_bancarias') && sql.includes('NOT (id = ANY')) return { rows: respuestas.ajenas ?? [] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: async () => client } as never, client, sentencias };
}

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

describe('RegistroLimpieza — salvaguardas (pool simulado, sin base de datos)', () => {
  it('sin IDs registrados no abre ninguna conexión', async () => {
    const { pool, sentencias } = poolFalso({});
    const r = await new RegistroLimpieza().limpiar(pool);
    expect(r).toEqual({ cuentasEliminadas: 0, entidadesEliminadas: 0 });
    expect(sentencias).toHaveLength(0);
  });

  it('rechaza identificadores que no son UUID', () => {
    expect(() => new RegistroLimpieza().registrarCuenta("x'; DROP TABLE cuentas_bancarias;--")).toThrow(LimpiezaBloqueadaError);
  });

  it('borra primero cuentas y después entidades, solo por los IDs registrados, dentro de una transacción', async () => {
    const { pool, sentencias } = poolFalso({});
    const registro = new RegistroLimpieza();
    registro.registrarCuenta(ID_A);
    registro.registrarEntidad(ID_B);
    await registro.limpiar(pool);
    const borrados = sentencias.filter((s) => s.startsWith('DELETE'));
    expect(borrados).toEqual([
      'DELETE FROM cuentas_bancarias WHERE id = ANY($1::uuid[])',
      'DELETE FROM bancos_catalogo WHERE id = ANY($1::uuid[])',
    ]);
    expect(sentencias[0]).toBe('BEGIN');
    expect(sentencias[sentencias.length - 1]).toBe('COMMIT');
  });

  it('si la base conectada no es nextproject_test, no escribe nada', async () => {
    const { pool, sentencias } = poolFalso({ base: 'nextproject' });
    const registro = new RegistroLimpieza();
    registro.registrarCuenta(ID_A);
    await expect(registro.limpiar(pool)).rejects.toThrow(LimpiezaBloqueadaError);
    expect(sentencias.some((s) => s.startsWith('DELETE'))).toBe(false);
    expect(sentencias).toContain('ROLLBACK');
  });

  it('si una cuenta registrada tiene pagos asociados, no elimina nada y lo reporta', async () => {
    const { pool, sentencias } = poolFalso({ pagos: [{ id: ID_A, n: '2' }] });
    const registro = new RegistroLimpieza();
    registro.registrarCuenta(ID_A);
    await expect(registro.limpiar(pool)).rejects.toThrow(/pagos asociados/);
    expect(sentencias.some((s) => s.startsWith('DELETE'))).toBe(false);
    expect(sentencias).toContain('ROLLBACK');
  });

  it('si una cuenta NO registrada referencia una entidad registrada, no elimina nada y lo reporta', async () => {
    const { pool, sentencias } = poolFalso({ ajenas: [{ id: ID_A, banco_catalogo_id: ID_B }] });
    const registro = new RegistroLimpieza();
    registro.registrarEntidad(ID_B);
    await expect(registro.limpiar(pool)).rejects.toThrow(/NO registradas/);
    expect(sentencias.some((s) => s.startsWith('DELETE'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Salvaguarda previa al borrado de la carpeta temporal (ejecutor simulado)

import {
  buscarReferenciasATemporal,
  limpiarCarpetaTemporalSiNoHayReferencias,
  ReferenciasATemporalesError,
  type EjecutorConsultas,
} from './testLogosTemp.js';

function ejecutorFalso(opciones: { base?: string; catalogo?: string[]; cuentas?: string[] }) {
  const consultas: string[] = [];
  const ejecutor: EjecutorConsultas = {
    query: async (sql: string) => {
      consultas.push(sql);
      if (sql.includes('current_database')) return { rows: [{ base: opciones.base ?? 'nextproject_test' }] };
      if (sql.includes('FROM bancos_catalogo')) {
        return { rows: (opciones.catalogo ?? []).map((f, i) => ({ id: `cat-${i}`, logo_path: f })) };
      }
      if (sql.includes('FROM cuentas_bancarias')) {
        return { rows: (opciones.cuentas ?? []).map((f, i) => ({ id: `cta-${i}`, logo_path: f })) };
      }
      return { rows: [] };
    },
  };
  return { ejecutor, consultas };
}

describe('salvaguarda previa al borrado de la carpeta temporal', () => {
  it('sin filas que referencien sus archivos, borra la carpeta', async () => {
    const { dir } = crearCarpetaTemporalLogos();
    creadasPorEstaPrueba.push(dir);
    escribirLogoDePrueba(dir, 'a.png');
    const { ejecutor } = ejecutorFalso({});
    await limpiarCarpetaTemporalSiNoHayReferencias(dir, ejecutor);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('una carpeta vacía se borra sin consultar la base', async () => {
    const { dir } = crearCarpetaTemporalLogos();
    creadasPorEstaPrueba.push(dir);
    const { ejecutor, consultas } = ejecutorFalso({});
    await limpiarCarpetaTemporalSiNoHayReferencias(dir, ejecutor);
    expect(consultas).toHaveLength(0);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('si una cuenta referencia un archivo de la carpeta, NO la borra y falla identificando la referencia y la carpeta', async () => {
    const { dir } = crearCarpetaTemporalLogos();
    creadasPorEstaPrueba.push(dir);
    const ruta = escribirLogoDePrueba(dir, 'referenciado.png');
    const { ejecutor } = ejecutorFalso({ cuentas: ['referenciado.png'] });

    const intento = limpiarCarpetaTemporalSiNoHayReferencias(dir, ejecutor);
    await expect(intento).rejects.toThrow(ReferenciasATemporalesError);
    await expect(intento).rejects.toThrow(/cuentas_bancarias cta-0 -> referenciado\.png/);
    await expect(intento).rejects.toThrow(dir);
    // la carpeta y el archivo siguen ahí
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(ruta)).toBe(true);
  });

  it('detecta también referencias desde el catálogo y las lista todas', async () => {
    const { dir } = crearCarpetaTemporalLogos();
    creadasPorEstaPrueba.push(dir);
    escribirLogoDePrueba(dir, 'x.png');
    escribirLogoDePrueba(dir, 'y.png');
    const { ejecutor } = ejecutorFalso({ catalogo: ['x.png'], cuentas: ['y.png'] });
    const refs = await buscarReferenciasATemporal(dir, ejecutor);
    expect(refs.map((r) => `${r.tabla}:${r.logo_path}`).sort()).toEqual(['bancos_catalogo:x.png', 'cuentas_bancarias:y.png']);
  });

  it('si la base conectada no es nextproject_test, no borra la carpeta ni consulta más', async () => {
    const { dir } = crearCarpetaTemporalLogos();
    creadasPorEstaPrueba.push(dir);
    escribirLogoDePrueba(dir, 'a.png');
    const { ejecutor, consultas } = ejecutorFalso({ base: 'nextproject' });
    await expect(limpiarCarpetaTemporalSiNoHayReferencias(dir, ejecutor)).rejects.toThrow(/no "nextproject_test"/);
    expect(fs.existsSync(dir)).toBe(true);
    expect(consultas).toHaveLength(1); // solo current_database()
  });

  it('rechaza rutas que no son carpetas temporales de pruebas, sin consultar ni tocar el disco', async () => {
    const compartida = resolverDirLogosBancos(undefined, process.cwd());
    const { ejecutor, consultas } = ejecutorFalso({});
    await expect(limpiarCarpetaTemporalSiNoHayReferencias(compartida, ejecutor)).rejects.toThrow(CarpetaTemporalInvalidaError);
    expect(consultas).toHaveLength(0);
  });
});

describe('RegistroLimpieza — transferencias de pago registradas (pool simulado)', () => {
  const ID_T = '33333333-3333-4333-8333-333333333333';

  it('borra primero las transferencias registradas, luego las cuentas y por último las entidades', async () => {
    const { pool, sentencias } = poolFalso({});
    const registro = new RegistroLimpieza();
    registro.registrarTransferencia(ID_T);
    registro.registrarCuenta(ID_A);
    registro.registrarEntidad(ID_B);
    const r = await registro.limpiar(pool);
    expect(sentencias.filter((s) => s.startsWith('DELETE'))).toEqual([
      'DELETE FROM transferencias_pago WHERE id = ANY($1::uuid[])',
      'DELETE FROM cuentas_bancarias WHERE id = ANY($1::uuid[])',
      'DELETE FROM bancos_catalogo WHERE id = ANY($1::uuid[])',
    ]);
    expect(r).toEqual({ cuentasEliminadas: 1, entidadesEliminadas: 1, transferenciasEliminadas: 1 });
  });

  it('el chequeo de pagos asociados excluye solo las transferencias registradas (pasa sus IDs a la consulta)', async () => {
    const { pool, client } = poolFalso({});
    const registro = new RegistroLimpieza();
    registro.registrarTransferencia(ID_T);
    registro.registrarCuenta(ID_A);
    await registro.limpiar(pool);
    const consultaPagos = client.query.mock.calls.find((c) => String(c[0]).includes('FROM transferencias_pago'));
    expect(String(consultaPagos?.[0])).toContain('NOT (id = ANY($2::uuid[]))');
    expect(consultaPagos?.[1]).toEqual([[ID_A], [ID_T]]);
  });

  it('un pago NO registrado sobre una cuenta registrada sigue bloqueando la limpieza (sin borrar nada)', async () => {
    const { pool, sentencias } = poolFalso({ pagos: [{ id: ID_A, n: '1' }] });
    const registro = new RegistroLimpieza();
    registro.registrarTransferencia(ID_T);
    registro.registrarCuenta(ID_A);
    await expect(registro.limpiar(pool)).rejects.toThrow(/pagos asociados/);
    expect(sentencias.some((s) => s.startsWith('DELETE'))).toBe(false);
  });
});
