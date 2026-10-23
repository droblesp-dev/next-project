// "PC-2026-01 — Etapa 2: Backend" (autorización explícita): valida el
// repositorio de transferencias_pago (V13/V14) — crear, listar por
// cotización, obtener el intento vigente, obtener el último intento
// (vigente o no) y marcar un intento como no vigente, respetando el
// índice único parcial `ux_transferencias_pago_vigente`. Pruebas de
// integración reales contra `nextproject_test` — mismo guard obligatorio
// que el resto de *.integration.test.ts, nunca se ejecuta contra
// `nextproject`. No conecta todavía con gestionarAnticipo()/
// gestionarSaldo() — eso es una etapa posterior.
import { randomUUID } from 'crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import * as transferenciasRepo from './transferenciasPago.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from '../services/solicitudes.service.js';
import { crearCotizacion } from '../services/cotizaciones.service.js';

let creadoPorId: string;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  const rol = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'COMERCIAL'`);
  const sufijo = randomUUID();
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), 'Prueba Transferencias Pago (creado_por)', $1, 'placeholder-no-usado-para-login', $2)
     RETURNING id`,
    [`transferencias-pago.creado-por.${sufijo}@nextproject-test.local`, rol.rows[0].id]
  );
  creadoPorId = inserted.rows[0].id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function datosUnicos(etiqueta: string) {
  const sufijo = randomUUID();
  return {
    email: `transferencias-pago.${etiqueta}.${sufijo}@nextproject-test.local`.toLowerCase(),
    telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
    idempotencyKey: `transferencias-pago-${etiqueta}-${sufijo}`,
  };
}

async function crearCotizacionDePrueba(etiqueta: string) {
  const { email, telefono, idempotencyKey } = datosUnicos(etiqueta);
  const resultado = await crearSolicitud(
    {
      nombre: `Prueba Transferencias Pago ${etiqueta}`,
      empresa: null,
      email,
      telefono,
      servicio: `Servicio Transferencias Pago ${etiqueta}`,
      descripcion: `Registro ficticio de integración (transferencias_pago, caso ${etiqueta}).`,
      cantidad: 1,
    },
    idempotencyKey
  );
  await cambiarEstadoSolicitud(resultado.solicitud.id, 'EN_REVISION');
  const cotizacion = await crearCotizacion({
    solicitudId: resultado.solicitud.id,
    valor: 100,
    descripcion: null,
    creadoPor: creadoPorId,
    anticipoPorcentaje: 0,
  });
  return cotizacion;
}

describe('transferenciasPago.repository — V13/V14, nextproject_test, real', () => {
  it('crea un intento vigente y lo recupera con listarPorCotizacion y obtenerVigente', async () => {
    const cotizacion = await crearCotizacionDePrueba('A-crear');

    const creado = await transferenciasRepo.crear({
      cotizacionId: cotizacion.id,
      tipoPago: 'ANTICIPO',
      importeDeclarado: 50,
      gestionadoPor: creadoPorId,
      registradoPor: creadoPorId,
      vigente: true,
      bancoOrigen: 'Banco del Cliente',
    });

    expect(creado.vigente).toBe(true);
    expect(creado.estado).toBe('PENDIENTE');

    const historial = await transferenciasRepo.listarPorCotizacion(cotizacion.id);
    expect(historial).toHaveLength(1);
    expect(historial[0].id).toBe(creado.id);

    const vigente = await transferenciasRepo.obtenerVigente(cotizacion.id, 'ANTICIPO');
    expect(vigente?.id).toBe(creado.id);
  });

  it('marcarNoVigente + crear un nuevo intento conserva ambos en el historial, sin perder el anterior', async () => {
    const cotizacion = await crearCotizacionDePrueba('B-reemplazo');

    const primero = await transferenciasRepo.crear({
      cotizacionId: cotizacion.id,
      tipoPago: 'SALDO',
      importeDeclarado: 30,
      gestionadoPor: creadoPorId,
      registradoPor: creadoPorId,
      vigente: true,
      motivoRechazo: 'COMPROBANTE_ILEGIBLE',
      estado: 'RECHAZADO',
    });

    await transferenciasRepo.marcarNoVigente(primero.id);

    const segundo = await transferenciasRepo.crear({
      cotizacionId: cotizacion.id,
      tipoPago: 'SALDO',
      importeDeclarado: 30,
      gestionadoPor: creadoPorId,
      registradoPor: creadoPorId,
      vigente: true,
    });

    const historial = await transferenciasRepo.listarPorCotizacion(cotizacion.id);
    expect(historial).toHaveLength(2);

    const primeroReleido = historial.find((h) => h.id === primero.id);
    expect(primeroReleido?.vigente).toBe(false);
    expect(primeroReleido?.motivo_rechazo).toBe('COMPROBANTE_ILEGIBLE');
    expect(primeroReleido?.estado).toBe('RECHAZADO');

    const vigenteActual = await transferenciasRepo.obtenerVigente(cotizacion.id, 'SALDO');
    expect(vigenteActual?.id).toBe(segundo.id);
  });

  it('obtenerUltimoIntento devuelve el más reciente aunque ya no esté vigente', async () => {
    const cotizacion = await crearCotizacionDePrueba('C-ultimo-intento');

    const primero = await transferenciasRepo.crear({
      cotizacionId: cotizacion.id,
      tipoPago: 'ANTICIPO',
      importeDeclarado: 10,
      gestionadoPor: creadoPorId,
      registradoPor: creadoPorId,
      vigente: true,
      bancoOrigen: 'Banco A',
    });
    await transferenciasRepo.marcarNoVigente(primero.id);

    const segundo = await transferenciasRepo.crear({
      cotizacionId: cotizacion.id,
      tipoPago: 'ANTICIPO',
      importeDeclarado: 10,
      gestionadoPor: creadoPorId,
      registradoPor: creadoPorId,
      vigente: false,
      bancoOrigen: 'Banco B',
    });

    const ultimo = await transferenciasRepo.obtenerUltimoIntento(cotizacion.id, 'ANTICIPO');
    expect(ultimo?.id).toBe(segundo.id);
    expect(ultimo?.banco_origen).toBe('Banco B');
  });

  it('el índice único parcial impide dos filas vigentes para la misma (cotización, tipo_pago)', async () => {
    const cotizacion = await crearCotizacionDePrueba('D-indice-unico');

    await transferenciasRepo.crear({
      cotizacionId: cotizacion.id,
      tipoPago: 'ANTICIPO',
      importeDeclarado: 10,
      gestionadoPor: creadoPorId,
      registradoPor: creadoPorId,
      vigente: true,
    });

    await expect(
      transferenciasRepo.crear({
        cotizacionId: cotizacion.id,
        tipoPago: 'ANTICIPO',
        importeDeclarado: 20,
        gestionadoPor: creadoPorId,
        registradoPor: creadoPorId,
        vigente: true,
      })
    ).rejects.toThrow();
  });

  it('conserva comprobante_path, motivo_rechazo y motivo_rechazo_detalle de un intento no vigente, sin sobrescribirlos', async () => {
    const cotizacion = await crearCotizacionDePrueba('E-conservar-motivo');

    const rechazado = await transferenciasRepo.crear({
      cotizacionId: cotizacion.id,
      tipoPago: 'ANTICIPO',
      importeDeclarado: 15,
      comprobantePath: 'uuid-de-prueba.jpg',
      gestionadoPor: creadoPorId,
      registradoPor: creadoPorId,
      vigente: true,
      estado: 'RECHAZADO',
      motivoRechazo: 'OTRO',
      motivoRechazoDetalle: 'El nombre del titular no coincide.',
    });

    await transferenciasRepo.marcarNoVigente(rechazado.id);

    const releido = (await transferenciasRepo.listarPorCotizacion(cotizacion.id))[0];
    expect(releido.comprobante_path).toBe('uuid-de-prueba.jpg');
    expect(releido.motivo_rechazo).toBe('OTRO');
    expect(releido.motivo_rechazo_detalle).toBe('El nombre del titular no coincide.');
    expect(releido.vigente).toBe(false);
  });
});
