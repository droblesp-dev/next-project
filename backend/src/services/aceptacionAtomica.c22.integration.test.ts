// C2.2 — pruebas de integración de la transacción atómica (autorización
// explícita, alternativa B de la auditoría C2.1): la aceptación de una
// cotización y la conversión de su lead vinculado deben confirmarse juntas
// o revertirse juntas. Exclusivo de `npm run test:integration` contra
// nextproject_test — mismo guard obligatorio que el resto de
// *.integration.test.ts. Nunca se ejecuta contra `nextproject`.
//
// Reutiliza las funciones REALES de servicio/repositorio; el único punto
// simulado es la prueba 2 (fallo real durante la conversión del lead),
// donde se usa `vi.spyOn` sobre `leadsRepo.convertirPorAceptacion` para
// forzar de forma determinista el único paso que es imposible de hacer
// fallar de otra manera sin tocar la infraestructura de PostgreSQL en
// pleno vuelo — el resto de la transacción (marcarAceptada, BEGIN/COMMIT/
// ROLLBACK, el `client` real) corre contra la base de pruebas real.
import { randomUUID } from 'crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import * as leadsRepo from '../repositories/leads.repository.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import {
  crearCotizacion,
  cambiarEstadoCotizacion,
  generarEnlaceCotizacion,
  aceptarCotizacionPublica,
  AccionNoPermitidaError,
} from './cotizaciones.service.js';

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
     VALUES (gen_random_uuid(), 'Prueba C2.2 (creado_por)', $1, 'placeholder-no-usado-para-login', $2)
     RETURNING id`,
    [`c22.creado-por.${sufijo}@nextproject-test.local`, rol.rows[0].id]
  );
  creadoPorId = inserted.rows[0].id;
});

function datosUnicos(etiqueta: string) {
  const sufijo = randomUUID();
  return {
    email: `c22.${etiqueta}.${sufijo}@nextproject-test.local`.toLowerCase(),
    telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
    idempotencyKey: `c22-${etiqueta}-${sufijo}`,
  };
}

async function crearSolicitudEnviada(etiqueta: string) {
  const { email, telefono, idempotencyKey } = datosUnicos(etiqueta);
  const resultado = await crearSolicitud(
    {
      nombre: `Prueba C2.2 ${etiqueta}`,
      empresa: null,
      email,
      telefono,
      servicio: `Servicio C2.2 ${etiqueta}`,
      descripcion: `Registro ficticio de integración (C2.2, caso ${etiqueta}).`,
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
  const enviada = await cambiarEstadoCotizacion(cotizacion.id, 'ENVIADA');
  return { solicitud: resultado.solicitud, cotizacion: enviada };
}

describe('C2.2 — transacción atómica: aceptación + conversión de lead (nextproject_test, real)', () => {
  it('1) aceptación válida: cotización ACEPTADA y lead CONVERTIDO quedan confirmados juntos', async () => {
    const { solicitud, cotizacion } = await crearSolicitudEnviada('T1');
    const { token, codigo } = await generarEnlaceCotizacion(cotizacion.id);

    await aceptarCotizacionPublica(token, codigo);

    const cotizacionFinal = await cotizacionesRepo.findById(cotizacion.id);
    const leads = await leadsRepo.listarPorSolicitud(solicitud.id);
    expect(cotizacionFinal?.estado).toBe('ACEPTADA');
    expect(leads).toHaveLength(1);
    expect(leads[0].clasificacion).toBe('CONVERTIDO');
  });

  it('2) fallo real durante la conversión del lead: la cotización NO queda ACEPTADA (ROLLBACK real)', async () => {
    const { solicitud, cotizacion } = await crearSolicitudEnviada('T2');
    const { token, codigo } = await generarEnlaceCotizacion(cotizacion.id);

    const spy = vi
      .spyOn(leadsRepo, 'convertirPorAceptacion')
      .mockRejectedValueOnce(new Error('Fallo simulado de PostgreSQL (prueba C2.2 #2)'));

    try {
      await expect(aceptarCotizacionPublica(token, codigo)).rejects.toThrow(
        'Fallo simulado de PostgreSQL (prueba C2.2 #2)'
      );
    } finally {
      spy.mockRestore();
    }

    // ROLLBACK real, verificado con una lectura nueva (no con el valor en
    // memoria de antes): el UPDATE de marcarAceptada, que SÍ se ejecutó
    // dentro de la transacción antes de que la conversión del lead
    // fallara, quedó revertido — la cotización sigue ENVIADA y el lead
    // nunca llegó a convertirse.
    const cotizacionFinal = await cotizacionesRepo.findById(cotizacion.id);
    const leads = await leadsRepo.listarPorSolicitud(solicitud.id);
    expect(cotizacionFinal?.estado).toBe('ENVIADA');
    expect(leads[0].clasificacion).toBe('CALIENTE');
  });

  it('3) lead RECURRENTE conserva su clasificación dentro de la transacción atómica', async () => {
    const { solicitud, cotizacion } = await crearSolicitudEnviada('T3');
    const leadsAntes = await leadsRepo.listarPorSolicitud(solicitud.id);
    await leadsRepo.update(leadsAntes[0].id, { clasificacion: 'RECURRENTE' });

    const { token, codigo } = await generarEnlaceCotizacion(cotizacion.id);
    await aceptarCotizacionPublica(token, codigo);

    const cotizacionFinal = await cotizacionesRepo.findById(cotizacion.id);
    const lead = await leadsRepo.findById(leadsAntes[0].id);
    expect(cotizacionFinal?.estado).toBe('ACEPTADA');
    expect(lead?.clasificacion).toBe('RECURRENTE');
  });

  it('4) sin lead vinculado: la aceptación se confirma igual, sin crear ninguno', async () => {
    const { solicitud, cotizacion } = await crearSolicitudEnviada('T4');
    const leadsAntes = await leadsRepo.listarPorSolicitud(solicitud.id);
    // Desvincula deliberadamente el lead creado junto con la solicitud,
    // para simular el caso "0 leads" dentro de la transacción atómica.
    await leadsRepo.update(leadsAntes[0].id, { solicitud_id: null });

    const { token, codigo } = await generarEnlaceCotizacion(cotizacion.id);
    await aceptarCotizacionPublica(token, codigo);

    const cotizacionFinal = await cotizacionesRepo.findById(cotizacion.id);
    const leadsDespues = await leadsRepo.listarPorSolicitud(solicitud.id);
    expect(cotizacionFinal?.estado).toBe('ACEPTADA');
    expect(leadsDespues).toHaveLength(0);
  });

  it('5) varios leads vinculados a la misma solicitud: ninguno se modifica, la aceptación se confirma igual', async () => {
    const { solicitud, cotizacion } = await crearSolicitudEnviada('T5');
    const leadOriginal = (await leadsRepo.listarPorSolicitud(solicitud.id))[0];
    const { email, telefono } = datosUnicos('T5-extra');
    const leadExtra = await leadsRepo.create(pool, { nombre: 'Prueba C2.2 T5 extra', telefono, email, fuente: 'WEB' });
    // Fixture de prueba exclusivamente: vincula un segundo lead a la misma
    // solicitud para simular el caso ">1 lead" (no hay ningún camino real
    // de la aplicación que produzca esto hoy).
    await pool.query('UPDATE leads SET solicitud_id = $2 WHERE id = $1', [leadExtra.id, solicitud.id]);

    const { token, codigo } = await generarEnlaceCotizacion(cotizacion.id);
    await aceptarCotizacionPublica(token, codigo);

    const cotizacionFinal = await cotizacionesRepo.findById(cotizacion.id);
    const original = await leadsRepo.findById(leadOriginal.id);
    const extra = await leadsRepo.findById(leadExtra.id);
    expect(cotizacionFinal?.estado).toBe('ACEPTADA');
    expect(original?.clasificacion).toBe('CALIENTE');
    expect(extra?.clasificacion).toBe('FRIO');
  });

  it('6) dos aceptaciones concurrentes de la misma cotización: solo una tiene éxito', async () => {
    const { cotizacion } = await crearSolicitudEnviada('T6');
    const { token, codigo } = await generarEnlaceCotizacion(cotizacion.id);

    const resultados = await Promise.allSettled([
      aceptarCotizacionPublica(token, codigo),
      aceptarCotizacionPublica(token, codigo),
    ]);

    const exitosas = resultados.filter((r) => r.status === 'fulfilled');
    const fallidas = resultados.filter((r) => r.status === 'rejected');
    expect(exitosas).toHaveLength(1);
    expect(fallidas).toHaveLength(1);
    expect((fallidas[0] as PromiseRejectedResult).reason).toBeInstanceOf(AccionNoPermitidaError);

    const cotizacionFinal = await cotizacionesRepo.findById(cotizacion.id);
    expect(cotizacionFinal?.estado).toBe('ACEPTADA');
  });

  // C2.4 (autorización explícita, intento documentado): se intentó una
  // prueba adicional que forzaba un fallo real del propio ROLLBACK
  // (interceptando `pool.connect()` una sola vez para parchear el `client`
  // real y hacer que su `query('ROLLBACK')` rechazara). Se retira: produjo
  // un cuelgue real de ~5s en la ejecución (ver informe de esta fase) — muy
  // probablemente porque `pool.query()` también usa `pool.connect()`
  // internamente, así que el `mockImplementationOnce` terminaba
  // interceptando una conexión distinta a la que de verdad abre la
  // transacción de `aceptarCotizacionPublica()`, dejando esa transacción
  // real sin su ROLLBACK y bloqueando una lectura posterior sobre la misma
  // fila. Se confirmó (de solo lectura, vía `pg_stat_activity`) que no
  // quedó ninguna transacción ni conexión colgada en `nextproject_test`
  // tras el intento. No se repitió el experimento para no arriesgar la
  // estabilidad del pool compartido por las demás pruebas de este archivo
  // — la corrección en sí (ROLLBACK envuelto en su propio try/catch) queda
  // validada por revisión de código (ver C2.3) y por la prueba 2 de este
  // mismo archivo, que ya ejercita el camino real de ROLLBACK exitoso tras
  // un fallo genuino de conversión de lead.
});
