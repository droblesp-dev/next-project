// "PC-2026-01 — Etapa 2: Backend" + "PC-2026-01 — Implementación completa
// de Gestión de Cuentas Bancarias" (autorizaciones explícitas): valida el
// repositorio/servicio/controller de cuentas_bancarias (V14) y su
// extensión con el catálogo de bancos + visibilidad del titular (V15), y
// la restricción de permisos (ADMIN exclusivo) a nivel de middleware.
// Pruebas de integración reales contra `nextproject_test` — mismo guard
// obligatorio que el resto de *.integration.test.ts, nunca se ejecuta
// contra `nextproject`.
import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { pool } from '../config/db.js';
import { RegistroLimpieza } from '../config/testCleanup.js';
import { requireRole } from '../middleware/auth.middleware.js';
import {
  listarCuentasBancarias,
  listarCuentasActivasPublico,
  obtenerCuentaBancaria,
  crearCuentaBancaria,
  editarCuentaBancaria,
  cambiarActivoCuentaBancaria,
  CuentaBancariaNoEncontradaError,
  TipoCuentaInvalidoError,
  DatosCuentaBancariaInvalidosError,
  BancoRequeridoError,
  BancoCatalogoInvalidoError,
} from '../services/cuentasBancarias.service.js';
import { listarBancosCatalogo, TipoEntidadInvalidoError } from '../services/bancosCatalogo.service.js';

let creadoPorId: string;

// Limpieza por IDs de TODO lo que crea este archivo (solo ello; nunca por
// patrón de nombre). Se registra en cuanto se crea, antes de las aserciones.
const registro = new RegistroLimpieza();

// Una entidad del catálogo se registra solo si se puede DEMOSTRAR que es de
// esta prueba: la creó el usuario propio de este archivo (creado_por). Las
// entidades sembradas u otras preexistentes tienen otro creado_por y nunca se
// registran.
async function registrarEntidadSiEsPropia(entidadId: string | null | undefined): Promise<void> {
  if (!entidadId) return;
  const r = await pool.query<{ creado_por: string }>('SELECT creado_por FROM bancos_catalogo WHERE id = $1', [entidadId]);
  if (r.rows[0]?.creado_por === creadoPorId) registro.registrarEntidad(entidadId);
}

// Mismo contrato que crearCuentaBancaria, pero registra la cuenta (y su entidad
// si es propia) para limpiarlas al terminar.
async function crearRegistrando(...args: Parameters<typeof crearCuentaBancaria>) {
  const resultado = await crearCuentaBancaria(...args);
  registro.registrarCuenta(resultado.cuenta.id);
  await registrarEntidadSiEsPropia(resultado.cuenta.banco_catalogo_id);
  return resultado;
}

afterAll(async () => {
  // Una transacción: primero cuentas, después entidades. Si hay dependencias
  // inesperadas (pagos, cuentas ajenas sobre una entidad propia) revierte y lanza.
  const registradas = { cuentas: registro.cuentasRegistradas.length, entidades: registro.entidadesRegistradas.length };
  const resultado = await registro.limpiar(pool);
  // Todo lo registrado se eliminó realmente (ni de más ni de menos).
  expect(resultado).toEqual({ cuentasEliminadas: registradas.cuentas, entidadesEliminadas: registradas.entidades });
});

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  const rol = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'ADMIN'`);
  const sufijo = randomUUID();
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), 'Prueba Cuentas Bancarias (creado_por)', $1, 'placeholder-no-usado-para-login', $2)
     RETURNING id`,
    [`cuentas-bancarias.creado-por.${sufijo}@nextproject-test.local`, rol.rows[0].id]
  );
  creadoPorId = inserted.rows[0].id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function bancoUnico(etiqueta: string) {
  return `Banco Prueba ${etiqueta} ${randomUUID().slice(0, 8)}`;
}

describe('cuentasBancarias — servicio y repositorio (V14+V15), nextproject_test, real', () => {
  it('crea una cuenta bancaria con un banco personalizado y la devuelve con activo=true por defecto', async () => {
    const nombreBanco = bancoUnico('A');
    const { cuenta, archivoLogoAEscribir } = await crearRegistrando(
      {
        bancoPersonalizadoNombre: nombreBanco,
        titular: 'Centro de Mecanizado Industrial',
        tipoCuenta: 'AHORROS',
        numeroCuenta: '2201234567',
      },
      creadoPorId
    );

    expect(cuenta.banco).toBe(nombreBanco);
    expect(cuenta.activo).toBe(true);
    expect(cuenta.creado_por).toBe(creadoPorId);
    expect(cuenta.banco_catalogo_id).not.toBeNull();
    expect(cuenta.titular_visible_cliente).toBe(true);
    expect(archivoLogoAEscribir).toBeNull();

    const releida = await obtenerCuentaBancaria(cuenta.id);
    expect(releida.id).toBe(cuenta.id);

    const catalogo = await listarBancosCatalogo();
    expect(catalogo.some((b) => b.id === cuenta.banco_catalogo_id)).toBe(true);
  });

  it('un banco personalizado con el mismo nombre normalizado reutiliza la entidad del catálogo (sin duplicar)', async () => {
    const nombreBanco = bancoUnico('DEDUP');
    const { cuenta: cuenta1 } = await crearRegistrando(
      { bancoPersonalizadoNombre: nombreBanco, titular: 'T1', tipoCuenta: 'AHORROS', numeroCuenta: '1' },
      creadoPorId
    );
    // Mismo nombre, con espacios extra y mayúsculas distintas.
    const { cuenta: cuenta2 } = await crearRegistrando(
      { bancoPersonalizadoNombre: `  ${nombreBanco.toUpperCase()}  `, titular: 'T2', tipoCuenta: 'CORRIENTE', numeroCuenta: '2' },
      creadoPorId
    );

    expect(cuenta2.banco_catalogo_id).toBe(cuenta1.banco_catalogo_id);
  });

  it('crear una cuenta con bancoCatalogoId reutiliza esa entidad exacta', async () => {
    const nombreBanco = bancoUnico('REF');
    const { cuenta: primera } = await crearRegistrando(
      { bancoPersonalizadoNombre: nombreBanco, titular: 'T', tipoCuenta: 'AHORROS', numeroCuenta: '1' },
      creadoPorId
    );
    const { cuenta: segunda } = await crearRegistrando(
      { bancoCatalogoId: primera.banco_catalogo_id!, titular: 'T2', tipoCuenta: 'AHORROS', numeroCuenta: '2' },
      creadoPorId
    );

    expect(segunda.banco_catalogo_id).toBe(primera.banco_catalogo_id);
    expect(segunda.banco).toBe(nombreBanco);
  });

  it('bancoCatalogoId inexistente lanza BancoCatalogoInvalidoError', async () => {
    await expect(
      crearRegistrando(
        { bancoCatalogoId: randomUUID(), titular: 'T', tipoCuenta: 'AHORROS', numeroCuenta: '1' },
        creadoPorId
      )
    ).rejects.toBeInstanceOf(BancoCatalogoInvalidoError);
  });

  it('exige exactamente un banco: rechaza si no se envía ninguno, y si se envían ambos', async () => {
    await expect(
      crearRegistrando({ titular: 'T', tipoCuenta: 'AHORROS', numeroCuenta: '1' }, creadoPorId)
    ).rejects.toBeInstanceOf(BancoRequeridoError);

    await expect(
      crearRegistrando(
        { bancoCatalogoId: randomUUID(), bancoPersonalizadoNombre: 'X', titular: 'T', tipoCuenta: 'AHORROS', numeroCuenta: '1' },
        creadoPorId
      )
    ).rejects.toBeInstanceOf(BancoRequeridoError);
  });

  it('rechaza un tipoCuenta inválido antes de llegar a PostgreSQL', async () => {
    await expect(
      crearRegistrando(
        { bancoPersonalizadoNombre: bancoUnico('TIPO'), titular: 'X', tipoCuenta: 'EMPRESARIAL', numeroCuenta: '001' },
        creadoPorId
      )
    ).rejects.toBeInstanceOf(TipoCuentaInvalidoError);
  });

  it('rechaza datos vacíos (titular/numeroCuenta)', async () => {
    await expect(
      crearRegistrando(
        { bancoPersonalizadoNombre: bancoUnico('VACIO'), titular: '  ', tipoCuenta: 'AHORROS', numeroCuenta: '001' },
        creadoPorId
      )
    ).rejects.toBeInstanceOf(DatosCuentaBancariaInvalidosError);
  });

  it('edita una cuenta existente, conserva su id y puede ocultar el titular al cliente', async () => {
    const nombreBanco = bancoUnico('EDIT');
    const { cuenta } = await crearRegistrando(
      { bancoPersonalizadoNombre: nombreBanco, titular: 'Titular A', tipoCuenta: 'CORRIENTE', numeroCuenta: '999' },
      creadoPorId
    );

    const { cuenta: editada } = await editarCuentaBancaria(
      cuenta.id,
      {
        bancoCatalogoId: cuenta.banco_catalogo_id!,
        titular: 'Titular B (corregido)',
        tipoCuenta: 'CORRIENTE',
        numeroCuenta: '999',
        titularVisibleCliente: false,
      },
      creadoPorId
    );

    expect(editada.id).toBe(cuenta.id);
    expect(editada.titular).toBe('Titular B (corregido)');
    expect(editada.titular_visible_cliente).toBe(false);
  });

  it('activa/desactiva una cuenta y afecta el listado público de activas', async () => {
    const nombreBanco = bancoUnico('ACTIVO');
    const { cuenta } = await crearRegistrando(
      { bancoPersonalizadoNombre: nombreBanco, titular: 'Titular', tipoCuenta: 'AHORROS', numeroCuenta: '123' },
      creadoPorId
    );

    let activas = await listarCuentasActivasPublico();
    expect(activas.some((c) => c.banco === nombreBanco)).toBe(true);

    await cambiarActivoCuentaBancaria(cuenta.id, false);

    activas = await listarCuentasActivasPublico();
    expect(activas.some((c) => c.banco === nombreBanco)).toBe(false);
  });

  it('el listado público oculta el titular cuando titular_visible_cliente=false, y expone logo_url', async () => {
    const nombreBanco = bancoUnico('OCULTO');
    const { cuenta } = await crearRegistrando(
      {
        bancoPersonalizadoNombre: nombreBanco,
        titular: 'Titular Secreto',
        tipoCuenta: 'AHORROS',
        numeroCuenta: '456',
        titularVisibleCliente: false,
      },
      creadoPorId
    );

    const activas = await listarCuentasActivasPublico();
    const fila = activas.find((c) => c.banco === nombreBanco);
    expect(fila).toBeDefined();
    expect(fila!.titular).toBeNull();
    expect(fila!.logo_url).toBeNull();
    expect(Object.keys(fila!).sort()).toEqual(['banco', 'logo_url', 'numero_cuenta', 'titular', 'tipo_cuenta'].sort());

    // Limpieza mínima: no afecta otras pruebas (cuenta propia, banco único).
    await cambiarActivoCuentaBancaria(cuenta.id, false);
  });

  it('operar sobre un id inexistente lanza CuentaBancariaNoEncontradaError', async () => {
    const idFalso = randomUUID();
    await expect(obtenerCuentaBancaria(idFalso)).rejects.toBeInstanceOf(CuentaBancariaNoEncontradaError);
    await expect(cambiarActivoCuentaBancaria(idFalso, true)).rejects.toBeInstanceOf(CuentaBancariaNoEncontradaError);
  });

  it('listarCuentasBancarias() incluye cuentas inactivas (vista administrativa completa)', async () => {
    const nombreBanco = bancoUnico('INACTIVO');
    const { cuenta } = await crearRegistrando(
      { bancoPersonalizadoNombre: nombreBanco, titular: 'T', tipoCuenta: 'AHORROS', numeroCuenta: '1' },
      creadoPorId
    );
    await cambiarActivoCuentaBancaria(cuenta.id, false);

    const todas = await listarCuentasBancarias();
    expect(todas.some((c) => c.id === cuenta.id && c.activo === false)).toBe(true);
  });

  it('permisos: requireRole(ADMIN) — la ruta de cuentas bancarias rechaza a COMERCIAL y OPERATIVO, acepta a ADMIN', () => {
    const middleware = requireRole('ADMIN');

    const reqAdmin = { user: { sub: 'a', rol: 'ADMIN' } } as unknown as Request;
    const reqComercial = { user: { sub: 'b', rol: 'COMERCIAL' } } as unknown as Request;
    const reqOperativo = { user: { sub: 'c', rol: 'OPERATIVO' } } as unknown as Request;

    const next = vi.fn();
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as Response;

    middleware(reqAdmin, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    vi.resetAllMocks();
    const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next2 = vi.fn();
    middleware(reqComercial, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.status).toHaveBeenCalledWith(403);

    const res3 = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next3 = vi.fn();
    middleware(reqOperativo, res3, next3);
    expect(next3).not.toHaveBeenCalled();
    expect(res3.status).toHaveBeenCalledWith(403);
  });

  // PC-2026-01, Fase 1 ("Incorporar tipos de entidad financiera", V16):
  // catálogo único para bancos y cooperativas de ahorro y crédito.
  describe('tipo de entidad (BANCO/COOPERATIVA)', () => {
    it('una entidad personalizada sin tipoEntidad explícito se clasifica como BANCO por defecto', async () => {
      const nombreBanco = bancoUnico('TIPO-DEFECTO');
      const { cuenta } = await crearRegistrando(
        { bancoPersonalizadoNombre: nombreBanco, titular: 'T', tipoCuenta: 'AHORROS', numeroCuenta: '1' },
        creadoPorId
      );
      const catalogo = await listarBancosCatalogo();
      const entidad = catalogo.find((b) => b.id === cuenta.banco_catalogo_id);
      expect(entidad?.tipo).toBe('BANCO');
    });

    it('una entidad personalizada con tipoEntidad=COOPERATIVA se clasifica correctamente', async () => {
      const nombreCoop = bancoUnico('COOP');
      const { cuenta } = await crearRegistrando(
        {
          bancoPersonalizadoNombre: nombreCoop,
          tipoEntidad: 'COOPERATIVA',
          titular: 'T',
          tipoCuenta: 'AHORROS',
          numeroCuenta: '1',
        },
        creadoPorId
      );
      const catalogo = await listarBancosCatalogo();
      const entidad = catalogo.find((b) => b.id === cuenta.banco_catalogo_id);
      expect(entidad?.tipo).toBe('COOPERATIVA');
    });

    it('un tipoEntidad inválido se rechaza con TipoEntidadInvalidoError, sin crear nada', async () => {
      const nombreInvalido = bancoUnico('INVALIDO');
      await expect(
        crearRegistrando(
          {
            bancoPersonalizadoNombre: nombreInvalido,
            tipoEntidad: 'FINTECH',
            titular: 'T',
            tipoCuenta: 'AHORROS',
            numeroCuenta: '1',
          },
          creadoPorId
        )
      ).rejects.toBeInstanceOf(TipoEntidadInvalidoError);

      const catalogo = await listarBancosCatalogo();
      expect(catalogo.some((b) => b.nombre === nombreInvalido)).toBe(false);
    });

    it('reutilizar una entidad existente por bancoCatalogoId nunca cambia su tipo ya asignado', async () => {
      const nombreCoop = bancoUnico('COOP-REF');
      const { cuenta: primera } = await crearRegistrando(
        { bancoPersonalizadoNombre: nombreCoop, tipoEntidad: 'COOPERATIVA', titular: 'T', tipoCuenta: 'AHORROS', numeroCuenta: '1' },
        creadoPorId
      );
      // Reutiliza la misma entidad por id, sin enviar tipoEntidad (como
      // hace el formulario real al seleccionar una entidad ya existente).
      const { cuenta: segunda } = await crearRegistrando(
        { bancoCatalogoId: primera.banco_catalogo_id!, titular: 'T2', tipoCuenta: 'AHORROS', numeroCuenta: '2' },
        creadoPorId
      );
      expect(segunda.banco_catalogo_id).toBe(primera.banco_catalogo_id);

      const catalogo = await listarBancosCatalogo();
      const entidad = catalogo.find((b) => b.id === primera.banco_catalogo_id);
      expect(entidad?.tipo).toBe('COOPERATIVA');
    });

    it('listarBancosCatalogo() expone el campo tipo en cada entidad', async () => {
      const catalogo = await listarBancosCatalogo();
      expect(catalogo.length).toBeGreaterThan(0);
      for (const banco of catalogo) {
        expect(['BANCO', 'COOPERATIVA']).toContain(banco.tipo);
      }
    });

    // Requisito explícito de la Fase 1: los 17 bancos ya sembrados
    // (scripts/seed-bancos-catalogo.ts) deben seguir clasificados como
    // BANCO tras aplicar V16 — nunca se les asignó tipoEntidad al
    // sembrarlos, así que dependen exactamente del DEFAULT 'BANCO'.
    it('los 17 bancos del catálogo oficial (sembrados antes de V16) están clasificados como BANCO', async () => {
      const NOMBRES_SEMBRADOS = [
        'Banco Pichincha',
        'Banco del Pacífico',
        'Banco de Guayaquil',
        'Produbanco',
        'Banco Bolivariano',
        'Banco Internacional',
        'Banco del Austro',
        'Banco Diners Club',
        'Banco General Rumiñahui',
        'Banco de Machala',
        'Banco de Loja',
        'Banco Solidario',
        'Banco Amazonas',
        'Banco Coopnacional',
        'Banco Capital',
        'Banco del Litoral',
        'Delbank',
      ];
      const catalogo = await listarBancosCatalogo();
      const encontrados = NOMBRES_SEMBRADOS.map((nombre) => catalogo.find((b) => b.nombre === nombre));
      expect(encontrados.every((b) => b !== undefined)).toBe(true);
      expect(encontrados.every((b) => b?.tipo === 'BANCO')).toBe(true);
    });
  });
});
