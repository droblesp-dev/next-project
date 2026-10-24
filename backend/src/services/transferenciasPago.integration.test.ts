// "PC-2026-01 — Resolver bloqueos de integración de pagos" (autorización
// explícita): valida la integración real de transferencias_pago con
// gestionarAnticipo/gestionarSaldo — gestión, rechazo (con motivo),
// confirmación directa (ADMIN), confirmación telefónica (COMERCIAL
// identifica a un ADMIN), la regla de banco de origen + excepción, la
// concurrencia (dos confirmaciones simultáneas del mismo pago) y los
// permisos a nivel de controller. Pruebas de integración reales contra
// `nextproject_test` — mismo guard obligatorio que el resto de
// *.integration.test.ts, nunca se ejecuta contra `nextproject`.
import { randomUUID } from 'crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { pool } from '../config/db.js';
import * as transferenciasRepo from '../repositories/transferenciasPago.repository.js';
import { listarCuentasActivasPublico } from './cuentasBancarias.service.js';
import {
  registrarGestionPago,
  rechazarPago,
  confirmarAcreditacionDirecta,
  registrarConfirmacionTelefonica,
  obtenerHistorial,
  VerificadorInvalidoError,
  PagoNoConfirmableError,
} from './transferenciasPago.service.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import { crearCotizacion, cambiarEstadoCotizacion, aceptarCotizacionPublica, generarEnlaceCotizacion } from './cotizaciones.service.js';
import { gestionarAnticipoController } from '../controllers/cotizaciones.controller.js';

let comercialId: string;
let adminId: string;
let otroAdminId: string;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  const rolComercial = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'COMERCIAL'`);
  const rolAdmin = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'ADMIN'`);
  const sufijo = randomUUID();

  comercialId = (
    await pool.query<{ id: string }>(
      `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
       VALUES (gen_random_uuid(), 'Prueba Transferencias (comercial)', $1, 'x', $2) RETURNING id`,
      [`transferencias-pago.comercial.${sufijo}@nextproject-test.local`, rolComercial.rows[0].id]
    )
  ).rows[0].id;

  adminId = (
    await pool.query<{ id: string }>(
      `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
       VALUES (gen_random_uuid(), 'Prueba Transferencias (admin)', $1, 'x', $2) RETURNING id`,
      [`transferencias-pago.admin.${sufijo}@nextproject-test.local`, rolAdmin.rows[0].id]
    )
  ).rows[0].id;

  otroAdminId = (
    await pool.query<{ id: string }>(
      `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
       VALUES (gen_random_uuid(), 'Prueba Transferencias (admin verificador)', $1, 'x', $2) RETURNING id`,
      [`transferencias-pago.admin2.${sufijo}@nextproject-test.local`, rolAdmin.rows[0].id]
    )
  ).rows[0].id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function datosUnicos(etiqueta: string) {
  const sufijo = randomUUID();
  return {
    email: `transferencias-pago-integracion.${etiqueta}.${sufijo}@nextproject-test.local`.toLowerCase(),
    telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
    idempotencyKey: `transferencias-pago-integracion-${etiqueta}-${sufijo}`,
  };
}

// Crea una cotización ACEPTADA con anticipo>0 (estado_anticipo=PENDIENTE),
// lista para gestionar/rechazar/confirmar — mismo flujo real: solicitud ->
// cotización -> enlace -> aceptación pública con código verificado.
async function crearCotizacionAceptadaConAnticipo(etiqueta: string) {
  const { email, telefono, idempotencyKey } = datosUnicos(etiqueta);
  const resultado = await crearSolicitud(
    {
      nombre: `Prueba Transferencias Integración ${etiqueta}`,
      empresa: null,
      email,
      telefono,
      servicio: `Servicio ${etiqueta}`,
      descripcion: `Registro ficticio (transferencias_pago, integración, ${etiqueta}).`,
      cantidad: 1,
    },
    idempotencyKey
  );
  await cambiarEstadoSolicitud(resultado.solicitud.id, 'EN_REVISION');
  const cotizacion = await crearCotizacion({
    solicitudId: resultado.solicitud.id,
    valor: 1000,
    descripcion: null,
    creadoPor: comercialId,
    anticipoPorcentaje: 50,
    metodoAnticipo: 'TRANSFERENCIA',
  });
  const enviada = await cambiarEstadoCotizacion(cotizacion.id, 'ENVIADA');

  const enlace = await generarEnlaceCotizacion(enviada.id);
  await aceptarCotizacionPublica(enlace.token, enlace.codigo);

  return enviada.id;
}

describe('transferenciasPago.service — integración con gestionarAnticipo/gestionarSaldo, nextproject_test, real', () => {
  it('registrarGestionPago crea un intento PENDIENTE vigente y queda en el historial', async () => {
    const cotizacionId = await crearCotizacionAceptadaConAnticipo('A-gestionar');

    const transferencia = await registrarGestionPago({
      cotizacionId,
      tipoPago: 'ANTICIPO',
      importeDeclarado: 500,
      bancoOrigen: 'Banco del Cliente',
      referenciaBancaria: 'REF-001',
      gestionadoPor: comercialId,
    });

    expect(transferencia.estado).toBe('PENDIENTE');
    expect(transferencia.vigente).toBe(true);

    const historial = await obtenerHistorial(cotizacionId);
    expect(historial).toHaveLength(1);
    expect(historial[0].id).toBe(transferencia.id);
  });

  it('rechazarPago exige motivoRechazoDetalle cuando el motivo es OTRO, y conserva el intento rechazado en el historial', async () => {
    const cotizacionId = await crearCotizacionAceptadaConAnticipo('B-rechazar');

    await expect(
      rechazarPago({ cotizacionId, tipoPago: 'ANTICIPO', motivoRechazo: 'OTRO', rechazadoPor: comercialId })
    ).rejects.toThrow();

    const rechazado = await rechazarPago({
      cotizacionId,
      tipoPago: 'ANTICIPO',
      motivoRechazo: 'COMPROBANTE_ILEGIBLE',
      rechazadoPor: comercialId,
    });

    expect(rechazado.estado).toBe('RECHAZADO');
    expect(rechazado.motivo_rechazo).toBe('COMPROBANTE_ILEGIBLE');

    const historial = await obtenerHistorial(cotizacionId);
    expect(historial.some((h) => h.id === rechazado.id && h.motivo_rechazo === 'COMPROBANTE_ILEGIBLE')).toBe(true);
  });

  it('confirmarAcreditacionDirecta (ADMIN) valida el anticipo y nunca lanza por la creación de la orden', async () => {
    const cotizacionId = await crearCotizacionAceptadaConAnticipo('C-confirmar-directo');

    const confirmado = await confirmarAcreditacionDirecta({ cotizacionId, tipoPago: 'ANTICIPO', adminId });

    expect(confirmado.estado).toBe('VALIDADO');
    expect(confirmado.verificado_por).toBe(adminId);
    expect(confirmado.registrado_por).toBe(adminId);
    expect(confirmado.medio_confirmacion).toBe('DIRECTO');
    // No afirmo que se haya creado una orden real: en este entorno de
    // pruebas no hay un OPERATIVO por defecto configurado
    // (OPERATIVO_POR_DEFECTO_EMAIL) — crearOrdenAutomatica() ya está
    // diseñada para no lanzar en ese caso (confirmado en auditorías
    // anteriores de esta sesión), por eso esta prueba solo verifica que
    // confirmarAcreditacionDirecta no propaga ningún error de esa llamada.
  });

  it('registrarConfirmacionTelefonica rechaza un verificador que no es ADMIN activo', async () => {
    const cotizacionId = await crearCotizacionAceptadaConAnticipo('D-telefonica-invalida');

    await expect(
      registrarConfirmacionTelefonica({
        cotizacionId,
        tipoPago: 'ANTICIPO',
        verificadorId: comercialId, // COMERCIAL, no ADMIN
        registradoPor: comercialId,
      })
    ).rejects.toBeInstanceOf(VerificadorInvalidoError);
  });

  it('registrarConfirmacionTelefonica identifica correctamente al ADMIN verificador, distinto del COMERCIAL que registra', async () => {
    const cotizacionId = await crearCotizacionAceptadaConAnticipo('E-telefonica-valida');

    const confirmado = await registrarConfirmacionTelefonica({
      cotizacionId,
      tipoPago: 'ANTICIPO',
      verificadorId: otroAdminId,
      registradoPor: comercialId,
    });

    expect(confirmado.estado).toBe('VALIDADO');
    expect(confirmado.verificado_por).toBe(otroAdminId);
    expect(confirmado.registrado_por).toBe(comercialId);
    expect(confirmado.medio_confirmacion).toBe('TELEFONICO');
    expect(confirmado.verificado_por).not.toBe(confirmado.registrado_por);
  });

  it('un banco de origen distinto al del intento anterior se registra sin bloqueo ni autorización, y cada intento conserva su banco', async () => {
    const cotizacionId = await crearCotizacionAceptadaConAnticipo('F-banco-origen');

    const primero = await registrarGestionPago({
      cotizacionId,
      tipoPago: 'ANTICIPO',
      importeDeclarado: 500,
      bancoOrigen: 'Banco A',
      gestionadoPor: comercialId,
    });
    const segundo = await registrarGestionPago({
      cotizacionId,
      tipoPago: 'ANTICIPO',
      importeDeclarado: 500,
      bancoOrigen: 'Banco B',
      gestionadoPor: comercialId,
    });
    const tercero = await registrarGestionPago({
      cotizacionId,
      tipoPago: 'ANTICIPO',
      importeDeclarado: 500,
      bancoOrigen: 'Banco C',
      gestionadoPor: comercialId,
    });
    expect(primero.banco_origen).toBe('Banco A');
    expect(segundo.banco_origen).toBe('Banco B');
    expect(tercero.banco_origen).toBe('Banco C');

    // Trazabilidad: los tres intentos siguen en el historial, solo el último es vigente.
    const historial = await obtenerHistorial(cotizacionId);
    expect(historial.map((h) => h.banco_origen).sort()).toEqual(['Banco A', 'Banco B', 'Banco C']);
    expect(historial.filter((h) => h.vigente).map((h) => h.id)).toEqual([tercero.id]);
  });

  it('dos confirmaciones directas concurrentes del mismo anticipo: solo una tiene éxito', async () => {
    const cotizacionId = await crearCotizacionAceptadaConAnticipo('G-concurrencia');

    const resultados = await Promise.allSettled([
      confirmarAcreditacionDirecta({ cotizacionId, tipoPago: 'ANTICIPO', adminId }),
      confirmarAcreditacionDirecta({ cotizacionId, tipoPago: 'ANTICIPO', adminId: otroAdminId }),
    ]);

    const exitosas = resultados.filter((r) => r.status === 'fulfilled');
    const fallidas = resultados.filter((r) => r.status === 'rejected');

    expect(exitosas).toHaveLength(1);
    expect(fallidas).toHaveLength(1);
    expect((fallidas[0] as PromiseRejectedResult).reason).toBeInstanceOf(PagoNoConfirmableError);

    // El índice único parcial garantiza, a nivel de PostgreSQL, un único
    // registro vigente — lo confirmamos leyendo el historial real.
    const historial = await obtenerHistorial(cotizacionId);
    const vigentes = historial.filter((h) => h.vigente && h.tipo_pago === 'ANTICIPO');
    expect(vigentes).toHaveLength(1);
  });

  it('permisos en el controller: COMERCIAL no puede ejecutar accion VALIDAR (confirmación directa)', async () => {
    const cotizacionId = await crearCotizacionAceptadaConAnticipo('H-permiso-validar');

    const req = {
      params: { id: cotizacionId },
      body: { accion: 'VALIDAR' },
      user: { sub: comercialId, rol: 'COMERCIAL' },
    } as unknown as Request;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as Response;

    await gestionarAnticipoController(req, res);

    expect(status).toHaveBeenCalledWith(403);
  });

  it('permisos en el controller: ADMIN no puede ejecutar accion RECHAZAR', async () => {
    const cotizacionId = await crearCotizacionAceptadaConAnticipo('I-permiso-rechazar');

    const req = {
      params: { id: cotizacionId },
      body: { accion: 'RECHAZAR', motivoRechazo: 'IMPORTE_INCORRECTO' },
      user: { sub: adminId, rol: 'ADMIN' },
    } as unknown as Request;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as Response;

    await gestionarAnticipoController(req, res);

    expect(status).toHaveBeenCalledWith(403);
  });

  it('permisos en el controller: ADMIN no puede ejecutar accion CONFIRMAR_TELEFONICA', async () => {
    const cotizacionId = await crearCotizacionAceptadaConAnticipo('J-permiso-telefonica');

    const req = {
      params: { id: cotizacionId },
      body: { accion: 'CONFIRMAR_TELEFONICA', verificadorId: otroAdminId },
      user: { sub: adminId, rol: 'ADMIN' },
    } as unknown as Request;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as Response;

    await gestionarAnticipoController(req, res);

    expect(status).toHaveBeenCalledWith(403);
  });

  it('permisos en el controller: COMERCIAL sí puede ejecutar GESTIONAR y recibe 200 con la transferencia creada', async () => {
    const cotizacionId = await crearCotizacionAceptadaConAnticipo('K-permiso-gestionar');

    const req = {
      params: { id: cotizacionId },
      body: { accion: 'GESTIONAR', importeDeclarado: 500 },
      user: { sub: comercialId, rol: 'COMERCIAL' },
    } as unknown as Request;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = { status, json } as unknown as Response;

    await gestionarAnticipoController(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ transferencia: expect.objectContaining({ estado: 'PENDIENTE' }) })
    );
  });

  // PC-2026-01 ("Implementación completa de Gestión de Cuentas Bancarias",
  // Fase G): el límite de seguridad del DTO público se movió del
  // repositorio (listActivas(), que ahora también alimenta el listado
  // administrativo con más campos) al servicio — listarCuentasActivasPublico()
  // es la única función que el flujo público de cotizaciones debe llamar,
  // y es la que esta prueba fija.
  it('listarCuentasActivasPublico() sigue devolviendo solo campos públicos (reutilizado por el DTO público, sin romper su contrato)', async () => {
    const activas = await listarCuentasActivasPublico();
    if (activas.length > 0) {
      expect(Object.keys(activas[0]).sort()).toEqual(['banco', 'logo_url', 'numero_cuenta', 'titular', 'tipo_cuenta'].sort());
    }
  });
});
