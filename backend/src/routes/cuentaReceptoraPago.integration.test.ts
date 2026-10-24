// PC-2026-01: selección y registro de la cuenta receptora al gestionar un pago.
//   - GET /api/cotizaciones/cuentas-receptoras (ADMIN y COMERCIAL; solo id, banco,
//     tipo y número de las cuentas ACTIVAS).
//   - PATCH /:id/anticipo (GESTIONAR) con `cuentaBancariaId`: guarda la cuenta y
//     su copia (snapshot), que luego aparece en el historial y no cambia aunque la
//     cuenta se edite o desactive.
// Pruebas de integración reales contra `nextproject_test` (mismo guard que el
// resto de *.integration.test.ts). Servidor HTTP efímero con el router real.
// Limpieza por IDs (RegistroLimpieza): las transferencias, cuentas y entidades
// que crea este archivo. La solicitud, el cliente, la cotización y los usuarios
// ficticios que usa no están cubiertos por RegistroLimpieza y quedan (como en el
// resto de pruebas de pagos).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { RegistroLimpieza } from '../config/testCleanup.js';
import { cotizacionesRouter } from './cotizaciones.routes.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from '../services/solicitudes.service.js';
import { crearCotizacion, cambiarEstadoCotizacion } from '../services/cotizaciones.service.js';
import {
  crearCuentaBancaria,
  editarCuentaBancaria,
  cambiarActivoCuentaBancaria,
} from '../services/cuentasBancarias.service.js';
import { registrarGestionPago } from '../services/transferenciasPago.service.js';

let server: http.Server;
let baseUrl: string;
let adminId: string;
let comercialId: string;
let tokenAdmin: string;
let tokenComercial: string;
let tokenOperativo: string;
let cotizacionId: string;
let restaurarFetch: () => void;

const registro = new RegistroLimpieza();
const cotizacionesCreadas: string[] = [];

type CuentaFila = { id: string; banco: string; tipo_cuenta: string; numero_cuenta: string };
type Transferencia = {
  id: string;
  tipo_pago: string;
  estado: string;
  vigente: boolean;
  cuenta_bancaria_id: string | null;
  banco_cuenta_snapshot: string | null;
  titular_cuenta_snapshot: string | null;
  tipo_cuenta_snapshot: string | null;
  numero_cuenta_snapshot: string | null;
};

function firmar(sub: string, rol: string): string {
  return jwt.sign({ sub, rol }, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

async function crearUsuario(rolNombre: string, etiqueta: string): Promise<string> {
  const rol = await pool.query<{ id: string }>('SELECT id FROM roles WHERE nombre = $1', [rolNombre]);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), $1, $2, 'placeholder', $3) RETURNING id`,
    [`Prueba cuenta receptora (${etiqueta})`, `cuenta-receptora.${etiqueta}.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  return u.rows[0].id;
}

// Cuenta de prueba: se registra para limpieza, y su entidad solo si se puede
// demostrar que es de esta prueba (la creó el usuario admin propio de este archivo).
async function crearCuenta(etiqueta: string, opciones: { titular?: string; numero?: string } = {}) {
  const { cuenta } = await crearCuentaBancaria(
    {
      bancoPersonalizadoNombre: `Banco Receptora ${etiqueta} ${randomUUID().slice(0, 8)}`,
      titular: opciones.titular ?? `Titular ${etiqueta}`,
      tipoCuenta: 'AHORROS',
      numeroCuenta: opciones.numero ?? randomUUID().slice(0, 12),
    },
    adminId
  );
  registro.registrarCuenta(cuenta.id);
  const e = await pool.query<{ creado_por: string }>('SELECT creado_por FROM bancos_catalogo WHERE id = $1', [
    cuenta.banco_catalogo_id,
  ]);
  if (e.rows[0]?.creado_por === adminId) registro.registrarEntidad(cuenta.banco_catalogo_id);
  return cuenta;
}

// Cotización ficticia ACEPTADA con anticipo TRANSFERENCIA pendiente. Se acepta con
// la función existente del repositorio (sin crear órdenes ni llamar a servicios
// externos). La solicitud/cliente/cotización quedan como residuo, igual que en las
// demás pruebas de pagos.
async function crearCotizacionAceptada(aceptar = true): Promise<string> {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba cuenta receptora',
      empresa: null,
      email: `cuenta-receptora.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio ficticio cuenta receptora',
      descripcion: 'Registro ficticio de integración (cuenta receptora).',
      cantidad: 1,
    },
    `cuenta-receptora-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  const c = await crearCotizacion({
    solicitudId: s.solicitud.id,
    valor: 1000,
    descripcion: null,
    creadoPor: comercialId,
    anticipoPorcentaje: 50,
    metodoAnticipo: 'TRANSFERENCIA',
  });
  await cambiarEstadoCotizacion(c.id, 'ENVIADA');
  if (aceptar) await cotizacionesRepo.marcarAceptada(c.id);
  cotizacionesCreadas.push(c.id);
  return c.id;
}

beforeAll(async () => {
  // Cualquier llamada de red que no sea al servidor local de la prueba (correo,
  // IA…) se sustituye por una respuesta vacía.
  const original = globalThis.fetch;
  const espia = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(input).startsWith('http://127.0.0.1') ? original(input, init) : Promise.resolve(new Response('{}', { status: 200 }))
  );
  restaurarFetch = () => espia.mockRestore();

  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  adminId = await crearUsuario('ADMIN', 'admin');
  comercialId = await crearUsuario('COMERCIAL', 'comercial');
  const operativoId = await crearUsuario('OPERATIVO', 'operativo');
  tokenAdmin = firmar(adminId, 'ADMIN');
  tokenComercial = firmar(comercialId, 'COMERCIAL');
  tokenOperativo = firmar(operativoId, 'OPERATIVO');

  const app = express();
  app.use(express.json());
  app.use('/api/cotizaciones', cotizacionesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  cotizacionId = await crearCotizacionAceptada();
});

afterAll(async () => {
  try {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    restaurarFetch();
    // Las transferencias se registran por la cotización que creó este archivo (propiedad
    // demostrable); después, limpieza transaccional: transferencias -> cuentas -> entidades.
    if (cotizacionesCreadas.length > 0) {
      const t = await pool.query<{ id: string }>(
        'SELECT id FROM transferencias_pago WHERE cotizacion_id = ANY($1::uuid[])',
        [cotizacionesCreadas]
      );
      for (const fila of t.rows) registro.registrarTransferencia(fila.id);
    }
    await registro.limpiar(pool);
  }
});

function pedir(ruta: string, token: string | null, init: { method?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}/api/cotizaciones${ruta}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function gestionar(token: string, cuerpo: Record<string, unknown>) {
  return pedir(`/${cotizacionId}/anticipo`, token, {
    method: 'PATCH',
    body: { accion: 'GESTIONAR', importeDeclarado: 500, ...cuerpo },
  });
}

async function historial(token = tokenComercial): Promise<Transferencia[]> {
  const res = await pedir(`/${cotizacionId}/transferencias`, token);
  expect(res.status).toBe(200);
  return ((await res.json()) as { transferencias: Transferencia[] }).transferencias;
}

describe('GET /api/cotizaciones/cuentas-receptoras — permisos y contrato', () => {
  it('sin token 401; OPERATIVO 403; ADMIN y COMERCIAL 200 (la ruta no se confunde con /:id)', async () => {
    expect((await pedir('/cuentas-receptoras', null)).status).toBe(401);
    expect((await pedir('/cuentas-receptoras', tokenOperativo)).status).toBe(403);
    expect((await pedir('/cuentas-receptoras', tokenAdmin)).status).toBe(200);
    expect((await pedir('/cuentas-receptoras', tokenComercial)).status).toBe(200);
  });

  it('devuelve solo id, banco, tipo y número, solo de cuentas activas', async () => {
    const activa = await crearCuenta('LISTA-ACTIVA');
    const inactiva = await crearCuenta('LISTA-INACTIVA');
    await cambiarActivoCuentaBancaria(inactiva.id, false);

    const res = await pedir('/cuentas-receptoras', tokenComercial);
    const { cuentas } = (await res.json()) as { cuentas: CuentaFila[] };

    const fila = cuentas.find((c) => c.id === activa.id);
    expect(fila).toEqual({
      id: activa.id,
      banco: activa.banco,
      tipo_cuenta: 'AHORROS',
      numero_cuenta: activa.numero_cuenta,
    });
    expect(cuentas.some((c) => c.id === inactiva.id)).toBe(false);
    // Contrato mínimo: ninguna fila lleva campos adicionales (titular, logo, estado, auditoría…).
    for (const c of cuentas) {
      expect(Object.keys(c).sort()).toEqual(['banco', 'id', 'numero_cuenta', 'tipo_cuenta']);
    }
  });

  it('ADMIN y COMERCIAL reciben el mismo contenido', async () => {
    const a = (await (await pedir('/cuentas-receptoras', tokenAdmin)).json()) as { cuentas: CuentaFila[] };
    const c = (await (await pedir('/cuentas-receptoras', tokenComercial)).json()) as { cuentas: CuentaFila[] };
    const ids = (x: { cuentas: CuentaFila[] }) => x.cuentas.map((f) => f.id).sort();
    // Pueden aparecer cuentas de otras pruebas en paralelo; lo común debe coincidir en forma.
    expect(Object.keys(a.cuentas[0] ?? {}).sort()).toEqual(Object.keys(c.cuentas[0] ?? {}).sort());
    expect(ids(a).length).toBeGreaterThan(0);
    expect(ids(c).length).toBeGreaterThan(0);
  });
});

describe('Gestión de pago con cuenta receptora (anticipo) — snapshot e historial', () => {
  it('COMERCIAL registra la cuenta elegida: se guarda su id y la copia de banco, titular, tipo y número', async () => {
    const cuenta = await crearCuenta('SNAPSHOT', { titular: 'Titular Original', numero: '1111222233' });

    const res = await gestionar(tokenComercial, { cuentaBancariaId: cuenta.id, bancoOrigen: 'Banco del Cliente' });
    expect(res.status).toBe(200);
    const { transferencia } = (await res.json()) as { transferencia: Transferencia };

    expect(transferencia.estado).toBe('PENDIENTE');
    expect(transferencia.vigente).toBe(true);
    expect(transferencia.cuenta_bancaria_id).toBe(cuenta.id);
    expect(transferencia.banco_cuenta_snapshot).toBe(cuenta.banco);
    expect(transferencia.titular_cuenta_snapshot).toBe('Titular Original');
    expect(transferencia.tipo_cuenta_snapshot).toBe('AHORROS');
    expect(transferencia.numero_cuenta_snapshot).toBe('1111222233');

    // y aparece igual en el historial
    const fila = (await historial()).find((t) => t.id === transferencia.id);
    expect(fila?.cuenta_bancaria_id).toBe(cuenta.id);
    expect(fila?.banco_cuenta_snapshot).toBe(cuenta.banco);
    expect(fila?.numero_cuenta_snapshot).toBe('1111222233');
  });

  it('el historial conserva el snapshot aunque la cuenta se edite o se desactive después', async () => {
    const cuenta = await crearCuenta('INMUTABLE', { titular: 'Titular Antes', numero: '555000111' });
    const res = await gestionar(tokenComercial, { cuentaBancariaId: cuenta.id });
    const { transferencia } = (await res.json()) as { transferencia: Transferencia };

    await editarCuentaBancaria(
      cuenta.id,
      {
        bancoCatalogoId: cuenta.banco_catalogo_id!,
        titular: 'Titular DESPUÉS del cambio',
        tipoCuenta: 'CORRIENTE',
        numeroCuenta: '999999999',
      },
      adminId
    );
    await cambiarActivoCuentaBancaria(cuenta.id, false);

    const fila = (await historial()).find((t) => t.id === transferencia.id);
    expect(fila?.cuenta_bancaria_id).toBe(cuenta.id);
    expect(fila?.titular_cuenta_snapshot).toBe('Titular Antes');
    expect(fila?.tipo_cuenta_snapshot).toBe('AHORROS');
    expect(fila?.numero_cuenta_snapshot).toBe('555000111');

    // y la cuenta desactivada ya no se ofrece como opción
    const lista = (await (await pedir('/cuentas-receptoras', tokenComercial)).json()) as { cuentas: CuentaFila[] };
    expect(lista.cuentas.some((c) => c.id === cuenta.id)).toBe(false);
  });

  it('ADMIN también puede gestionar con cuenta (permiso de GESTIONAR sin cambios)', async () => {
    const cuenta = await crearCuenta('ADMIN-GESTIONA');
    const res = await gestionar(tokenAdmin, { cuentaBancariaId: cuenta.id });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { transferencia: Transferencia }).transferencia.cuenta_bancaria_id).toBe(cuenta.id);
  });

  it('sin cuentaBancariaId el registro queda sin cuenta (campos nulos): histórico "No registrada"', async () => {
    const res = await gestionar(tokenComercial, {});
    expect(res.status).toBe(200);
    const { transferencia } = (await res.json()) as { transferencia: Transferencia };
    expect(transferencia.cuenta_bancaria_id).toBeNull();
    expect(transferencia.banco_cuenta_snapshot).toBeNull();
    expect(transferencia.titular_cuenta_snapshot).toBeNull();
    expect(transferencia.tipo_cuenta_snapshot).toBeNull();
    expect(transferencia.numero_cuenta_snapshot).toBeNull();
  });

  it('una cuenta inexistente se rechaza con 400 y no crea ningún intento', async () => {
    const antes = (await historial()).length;
    const res = await gestionar(tokenComercial, { cuentaBancariaId: randomUUID() });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/cuentaBancariaId/);
    expect((await historial()).length).toBe(antes);
  });

  it('un identificador con formato inválido se rechaza con 400 (no con un error 500)', async () => {
    const antes = (await historial()).length;
    const res = await gestionar(tokenComercial, { cuentaBancariaId: 'no-es-un-uuid' });
    expect(res.status).toBe(400);
    expect((await historial()).length).toBe(antes);
  });

  // Decisión funcional (integridad financiera): una cuenta inactiva no puede usarse para
  // registrar un pago NUEVO. Lo ya registrado conserva su copia (ver el bloque
  // "cuenta inactiva" más abajo).
  it('una cuenta desactivada se rechaza con 400 en el anticipo y no crea ningún intento', async () => {
    const cuenta = await crearCuenta('DESACTIVADA');
    await cambiarActivoCuentaBancaria(cuenta.id, false);
    const antes = (await historial()).length;
    const res = await gestionar(tokenComercial, { cuentaBancariaId: cuenta.id });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toMatch(/cuentaBancariaId/);
    expect((await historial()).length).toBe(antes);
  });

  it('OPERATIVO no puede gestionar pagos (403) y sin token 401', async () => {
    expect((await gestionar(tokenOperativo, { cuentaBancariaId: randomUUID() })).status).toBe(403);
    const sinToken = await pedir(`/${cotizacionId}/anticipo`, null, {
      method: 'PATCH',
      body: { accion: 'GESTIONAR', importeDeclarado: 1 },
    });
    expect(sinToken.status).toBe(401);
  });

  it('las reglas de rechazo y confirmación no cambian: ADMIN no rechaza (403) y COMERCIAL no confirma la acreditación (403)', async () => {
    const rechazoAdmin = await pedir(`/${cotizacionId}/anticipo`, tokenAdmin, {
      method: 'PATCH',
      body: { accion: 'RECHAZAR', motivoRechazo: 'COMPROBANTE_INCORRECTO' },
    });
    expect(rechazoAdmin.status).toBe(403);
    const validarComercial = await pedir(`/${cotizacionId}/anticipo`, tokenComercial, {
      method: 'PATCH',
      body: { accion: 'VALIDAR' },
    });
    expect(validarComercial.status).toBe(403);
  });
});

describe('Cuenta inactiva: no se usa para pagos nuevos y el historial no cambia', () => {
  async function gestionarSaldo(token: string, cuerpo: Record<string, unknown>, id = cotizacionId) {
    return pedir(`/${id}/saldo`, token, {
      method: 'PATCH',
      body: { accion: 'GESTIONAR', importeDeclarado: 500, ...cuerpo },
    });
  }

  it('anticipo y saldo: la cuenta activa registra el pago; desactivada se rechaza (400) y reactivada vuelve a servir', async () => {
    const cuenta = await crearCuenta('ACTIVA-INACTIVA');
    for (const tramo of ['anticipo', 'saldo'] as const) {
      const enviar = (token: string) =>
        tramo === 'anticipo'
          ? gestionar(token, { cuentaBancariaId: cuenta.id })
          : gestionarSaldo(token, { cuentaBancariaId: cuenta.id });
      const tipo = tramo === 'anticipo' ? 'ANTICIPO' : 'SALDO';

      const ok = await enviar(tokenComercial);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { transferencia: Transferencia }).transferencia.cuenta_bancaria_id).toBe(cuenta.id);

      await cambiarActivoCuentaBancaria(cuenta.id, false);
      const antes = (await historial()).filter((t) => t.tipo_pago === tipo);
      const rechazada = await enviar(tokenComercial);
      expect(rechazada.status).toBe(400);
      expect(((await rechazada.json()) as { message: string }).message).toMatch(/cuentaBancariaId/);
      expect((await enviar(tokenAdmin)).status).toBe(400);
      // ningún intento nuevo ni cambio de vigencia
      expect((await historial()).filter((t) => t.tipo_pago === tipo)).toEqual(antes);

      await cambiarActivoCuentaBancaria(cuenta.id, true);
      expect((await enviar(tokenComercial)).status).toBe(200);
    }
  });

  it('desactivar una cuenta no modifica las transferencias ya registradas con ella', async () => {
    const cuenta = await crearCuenta('HISTORICO', { titular: 'Titular Historico', numero: '424242424' });
    const res = await gestionar(tokenComercial, { cuentaBancariaId: cuenta.id });
    const { transferencia } = (await res.json()) as { transferencia: Transferencia };
    const filaBd = async () =>
      (await pool.query('SELECT * FROM transferencias_pago WHERE id = $1', [transferencia.id])).rows[0];
    const antes = await filaBd();

    await cambiarActivoCuentaBancaria(cuenta.id, false);

    expect(await filaBd()).toEqual(antes);
    expect(antes.cuenta_bancaria_id).toBe(cuenta.id);
    expect(antes.numero_cuenta_snapshot).toBe('424242424');
  });

  it('permisos y conflictos conservan su código aunque la cuenta esté inactiva', async () => {
    const cuenta = await crearCuenta('PERMISOS');
    await cambiarActivoCuentaBancaria(cuenta.id, false);
    // 401 y 403 se evalúan antes que la cuenta
    const sinToken = await pedir(`/${cotizacionId}/anticipo`, null, {
      method: 'PATCH',
      body: { accion: 'GESTIONAR', importeDeclarado: 5, cuentaBancariaId: cuenta.id },
    });
    expect(sinToken.status).toBe(401);
    expect((await gestionar(tokenOperativo, { cuentaBancariaId: cuenta.id })).status).toBe(403);
    // cotización inexistente: 404; cotización no aceptada: 409 (la cotización se valida primero)
    expect((await gestionarSaldo(tokenComercial, { cuentaBancariaId: cuenta.id }, randomUUID())).status).toBe(404);
    const noAceptada = await crearCotizacionAceptada(false);
    expect((await gestionarSaldo(tokenComercial, { cuentaBancariaId: cuenta.id }, noAceptada)).status).toBe(409);
  });
});

describe('Gestión de pago con cuenta receptora (saldo) — servicio', () => {
  it('un pago de SALDO guarda la cuenta elegida y su copia, separado del anticipo', async () => {
    const cuenta = await crearCuenta('SALDO', { titular: 'Titular Saldo', numero: '777888999' });
    const t = await registrarGestionPago({
      cotizacionId,
      tipoPago: 'SALDO',
      importeDeclarado: 500,
      cuentaBancariaId: cuenta.id,
      gestionadoPor: comercialId,
    });
    expect(t.tipo_pago).toBe('SALDO');
    expect(t.cuenta_bancaria_id).toBe(cuenta.id);
    expect(t.banco_cuenta_snapshot).toBe(cuenta.banco);
    expect(t.titular_cuenta_snapshot).toBe('Titular Saldo');
    expect(t.numero_cuenta_snapshot).toBe('777888999');

    // el anticipo vigente no se ve afectado por el pago de saldo
    const anticipos = (await historial()).filter((x) => x.tipo_pago === 'ANTICIPO' && x.vigente);
    expect(anticipos.length).toBeLessThanOrEqual(1);
  });
});
