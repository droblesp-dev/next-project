// Aislamiento de las pruebas de integración de logos, contra `nextproject_test`
// (mismo guard obligatorio que el resto de *.integration.test.ts):
//   - cada archivo de prueba trabaja en una carpeta temporal propia de logos;
//   - los logos que una fila referencia existen como PNG reales;
//   - la limpieza por IDs elimina solo lo registrado y no toca datos anteriores;
//   - si hay dependencias no previstas, no elimina nada y lo reporta.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { pool } from './db.js';
import { LOGOS_BANCOS_DIR } from './uploadsLogosBancos.js';
import { LimpiezaBloqueadaError, RegistroLimpieza } from './testCleanup.js';
import { esCarpetaTemporalDePruebas, escribirLogoDePrueba, esPngValido } from './testLogosTemp.js';
import { crearCuentaBancaria } from '../services/cuentasBancarias.service.js';

// Todo lo que crean estas pruebas y NO se limpia dentro de un caso concreto se
// limpia aquí, al terminar (también solo por ID).
const registroFinal = new RegistroLimpieza();
afterAll(async () => {
  await registroFinal.limpiar(pool);
});

async function usuarioExistente(): Promise<string> {
  const r = await pool.query<{ id: string }>('SELECT id FROM usuarios LIMIT 1');
  if (!r.rows[0]) throw new Error('La base de pruebas no tiene ningún usuario para usar como creado_por.');
  return r.rows[0].id;
}

const nombreUnico = (etiqueta: string) => `Banco Aislamiento ${etiqueta} ${randomUUID().slice(0, 8)}`;

async function crearCuentaConEntidadNueva(etiqueta: string, creadoPor: string) {
  const { cuenta } = await crearCuentaBancaria(
    {
      bancoPersonalizadoNombre: nombreUnico(etiqueta),
      titular: `Titular ${etiqueta}`,
      tipoCuenta: 'AHORROS',
      numeroCuenta: randomUUID().slice(0, 12),
    },
    creadoPor
  );
  return { cuentaId: cuenta.id, entidadId: cuenta.banco_catalogo_id! };
}

async function existe(tabla: 'cuentas_bancarias' | 'bancos_catalogo', id: string): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM ${tabla} WHERE id = $1`, [id]);
  return r.rowCount === 1;
}

describe('aislamiento de las pruebas de logos, nextproject_test', () => {
  it('la base conectada es nextproject_test', async () => {
    const r = await pool.query<{ base: string }>('SELECT current_database() AS base');
    expect(r.rows[0].base).toBe('nextproject_test');
  });

  it('LOGOS_BANCOS_DIR es una carpeta temporal propia de esta ejecución (no la compartida) y existe', () => {
    expect(process.env.LOGOS_BANCOS_DIR).toBe(LOGOS_BANCOS_DIR);
    expect(esCarpetaTemporalDePruebas(LOGOS_BANCOS_DIR)).toBe(true);
    expect(fs.existsSync(LOGOS_BANCOS_DIR)).toBe(true);
    expect(LOGOS_BANCOS_DIR).not.toBe(path.resolve(process.cwd(), 'uploads', 'logos-bancos'));
  });

  it('un logo referenciado por una fila existe como PNG real mientras está referenciado', async () => {
    const creadoPor = await usuarioExistente();
    const archivo = `aislamiento-${randomUUID()}.png`;
    escribirLogoDePrueba(LOGOS_BANCOS_DIR, archivo);
    const nombre = nombreUnico('LOGO');
    const e = await pool.query<{ id: string }>(
      `INSERT INTO bancos_catalogo (id, nombre, nombre_normalizado, logo_path, creado_por, tipo)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'BANCO') RETURNING id`,
      [nombre, nombre.toLowerCase(), archivo, creadoPor]
    );
    registroFinal.registrarEntidad(e.rows[0].id);

    const ref = await pool.query<{ logo_path: string }>('SELECT logo_path FROM bancos_catalogo WHERE id = $1', [e.rows[0].id]);
    const ruta = path.join(LOGOS_BANCOS_DIR, ref.rows[0].logo_path);
    expect(fs.existsSync(ruta)).toBe(true);
    expect(esPngValido(fs.readFileSync(ruta))).toBe(true);
  });

  it('la limpieza elimina solo lo registrado, sin afectar a un registro de control ni a los datos anteriores', async () => {
    const creadoPor = await usuarioExistente();

    // Datos anteriores a esta prueba: se verifica que siguen existiendo al final.
    const previasCuentas = (await pool.query<{ id: string }>('SELECT id FROM cuentas_bancarias')).rows.map((r) => r.id);
    const previasEntidades = (await pool.query<{ id: string }>('SELECT id FROM bancos_catalogo')).rows.map((r) => r.id);

    const propia = await crearCuentaConEntidadNueva('PROPIA', creadoPor);
    const control = await crearCuentaConEntidadNueva('CONTROL', creadoPor);
    registroFinal.registrarCuenta(control.cuentaId);
    registroFinal.registrarEntidad(control.entidadId);

    const registro = new RegistroLimpieza();
    registro.registrarCuenta(propia.cuentaId);
    registro.registrarEntidad(propia.entidadId);
    const resultado = await registro.limpiar(pool);

    expect(resultado).toEqual({ cuentasEliminadas: 1, entidadesEliminadas: 1 });
    expect(await existe('cuentas_bancarias', propia.cuentaId)).toBe(false);
    expect(await existe('bancos_catalogo', propia.entidadId)).toBe(false);
    // el registro de control (no registrado en este `registro`) sigue intacto
    expect(await existe('cuentas_bancarias', control.cuentaId)).toBe(true);
    expect(await existe('bancos_catalogo', control.entidadId)).toBe(true);
    // y ningún dato anterior desapareció
    const cuentasAhora = new Set((await pool.query<{ id: string }>('SELECT id FROM cuentas_bancarias')).rows.map((r) => r.id));
    const entidadesAhora = new Set((await pool.query<{ id: string }>('SELECT id FROM bancos_catalogo')).rows.map((r) => r.id));
    expect(previasCuentas.filter((id) => !cuentasAhora.has(id))).toEqual([]);
    expect(previasEntidades.filter((id) => !entidadesAhora.has(id))).toEqual([]);
  });

  it('si una cuenta no registrada depende de una entidad registrada, no elimina nada y lo reporta', async () => {
    const creadoPor = await usuarioExistente();
    const base = await crearCuentaConEntidadNueva('DEPENDIENTE', creadoPor);
    // segunda cuenta (no registrada en `registro`) sobre la MISMA entidad
    const { cuenta: ajena } = await crearCuentaBancaria(
      {
        bancoCatalogoId: base.entidadId,
        titular: 'Cuenta ajena',
        tipoCuenta: 'AHORROS',
        numeroCuenta: randomUUID().slice(0, 12),
      },
      creadoPor
    );
    // Al final se limpia todo lo creado aquí (por ID).
    registroFinal.registrarCuenta(base.cuentaId);
    registroFinal.registrarCuenta(ajena.id);
    registroFinal.registrarEntidad(base.entidadId);

    const registro = new RegistroLimpieza();
    registro.registrarCuenta(base.cuentaId);
    registro.registrarEntidad(base.entidadId);
    await expect(registro.limpiar(pool)).rejects.toThrow(LimpiezaBloqueadaError);

    // la transacción se revirtió: ni la cuenta registrada ni la entidad se borraron
    expect(await existe('cuentas_bancarias', base.cuentaId)).toBe(true);
    expect(await existe('cuentas_bancarias', ajena.id)).toBe(true);
    expect(await existe('bancos_catalogo', base.entidadId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Salvaguarda previa al borrado de la carpeta temporal, con la base real de pruebas.
import { crearCarpetaTemporalLogos, limpiarCarpetaTemporalSiNoHayReferencias, ReferenciasATemporalesError } from './testLogosTemp.js';

describe('salvaguarda de la carpeta temporal contra referencias en la base, nextproject_test', () => {
  it('con una fila que referencia un archivo de la carpeta, no la borra y falla con la referencia; tras limpiar la fila, la borra', async () => {
    const creadoPor = await usuarioExistente();
    const carpeta = crearCarpetaTemporalLogos();
    try {
      const archivo = `salvaguarda-${randomUUID()}.png`;
      escribirLogoDePrueba(carpeta.dir, archivo);
      const nombre = nombreUnico('SALVAGUARDA');
      const e = await pool.query<{ id: string }>(
        `INSERT INTO bancos_catalogo (id, nombre, nombre_normalizado, logo_path, creado_por, tipo)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'BANCO') RETURNING id`,
        [nombre, nombre.toLowerCase(), archivo, creadoPor]
      );
      const registro = new RegistroLimpieza();
      registro.registrarEntidad(e.rows[0].id);
      registroFinal.registrarEntidad(e.rows[0].id); // red de seguridad si algo falla antes

      // Con la fila viva, la salvaguarda impide borrar la carpeta y nombra la fila.
      const intento = limpiarCarpetaTemporalSiNoHayReferencias(carpeta.dir, pool);
      await expect(intento).rejects.toThrow(ReferenciasATemporalesError);
      await expect(intento).rejects.toThrow(e.rows[0].id);
      await expect(intento).rejects.toThrow(archivo);
      expect(fs.existsSync(path.join(carpeta.dir, archivo))).toBe(true);

      // Tras limpiar la fila por ID, ya no hay referencias y la carpeta se borra.
      await registro.limpiar(pool);
      await limpiarCarpetaTemporalSiNoHayReferencias(carpeta.dir, pool);
      expect(fs.existsSync(carpeta.dir)).toBe(false);
    } finally {
      // Solo borra si quedó viva (idempotente) y nunca fuera de las carpetas temporales de pruebas.
      carpeta.limpiar();
    }
  });
});
