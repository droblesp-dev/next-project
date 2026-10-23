// C2 — pruebas de integración de las reglas de clasificación automática de
// leads (Corrección A: solicitud principal -> CALIENTE; Corrección B:
// cotización aceptada -> CONVERTIDO). Autorización explícita del bloque C2
// ("si necesitas validar integración, usa exclusivamente la base de
// pruebas nextproject_test con las protecciones ya implementadas").
//
// Exclusivo de `npm run test:integration` (sufijo .integration.test.ts):
// la guardia obligatoria de testGuard.integration.setup.ts se aplica igual
// que a cualquier otro archivo de esta carpeta — aborta antes de cualquier
// conexión si DB_NAME/DB_HOST/DB_PORT/ALLOW_TEST_DB_WRITES no apuntan
// exactamente a nextproject_test. Nunca se ejecuta contra `nextproject`.
//
// Se ejercitan las funciones REALES de servicio/repositorio (nunca se
// reimplementa la lógica aquí): crearSolicitud, crearLead, crearCotizacion,
// cambiarEstadoCotizacion, generarEnlaceCotizacion y aceptarCotizacionPublica
// son exactamente las mismas que usa la aplicación en producción.
//
// Identificadores de prueba con el mismo dominio ficticio ya usado en las
// fases P0.3B (@nextproject-test.local) — nunca datos de clientes reales.
// No se limpian los registros creados (mismo criterio ya seguido en
// P0.3B-1/P0.3B-3B): quedan en nextproject_test, identificables por ese
// dominio y por el prefijo "C2 T<n>".
import { randomUUID } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../config/db.js';
import * as leadsRepo from '../repositories/leads.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import * as clientesRepo from '../repositories/clientes.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import { crearLead } from './leads.service.js';
import {
  crearCotizacion,
  cambiarEstadoCotizacion,
  generarEnlaceCotizacion,
  aceptarCotizacionPublica,
} from './cotizaciones.service.js';

let creadoPorId: string;

// Fixture mínimo e imprescindible: cotizaciones.creado_por es FK NOT NULL
// hacia usuarios(id) — no hay forma de crear una cotización real sin un
// usuario existente. roles.repository.ts no tiene create() (los roles son
// datos de referencia fijos, nunca insertados por código de aplicación);
// se insertan aquí los 3 roles base solo si todavía no existen
// (ON CONFLICT DO NOTHING — nunca se tocan si ya estaban), y se crea
// exactamente 1 usuario de prueba, claramente ficticio, con un
// password_hash placeholder que nunca se usa para autenticarse en estas
// pruebas (no se ejercita ningún flujo de login aquí).
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
     VALUES (gen_random_uuid(), 'Prueba C2 (creado_por)', $1, 'placeholder-no-usado-para-login', $2)
     RETURNING id`,
    [`c2.creado-por.${sufijo}@nextproject-test.local`, rol.rows[0].id]
  );
  creadoPorId = inserted.rows[0].id;
});

// `email` siempre en minúsculas: crearSolicitud() normaliza con
// `trim().toLowerCase()` antes de buscar un lead huérfano
// (buscarLeadOrfanoPorTelefonoYEmail compara contra ese valor ya
// normalizado) — un fixture de prueba con mayúsculas nunca coincidiría con
// la búsqueda real, aunque el teléfono/email "parezcan" los mismos.
function datosUnicos(etiqueta: string) {
  const sufijo = randomUUID();
  return {
    email: `c2.${etiqueta}.${sufijo}@nextproject-test.local`.toLowerCase(),
    telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
    idempotencyKey: `c2-${etiqueta}-${sufijo}`,
  };
}

async function crearSolicitudDePrueba(etiqueta: string) {
  const { email, telefono, idempotencyKey } = datosUnicos(etiqueta);
  return crearSolicitud(
    {
      nombre: `Prueba C2 ${etiqueta}`,
      empresa: null,
      email,
      telefono,
      servicio: `Servicio C2 ${etiqueta}`,
      descripcion: `Registro ficticio de integración (C2, caso ${etiqueta}).`,
      cantidad: 1,
    },
    idempotencyKey
  );
}

// Cotización SIN anticipo (anticipoPorcentaje:0) — simplifica el caso de
// prueba (sin exigir metodoAnticipo) y hace que, de aceptarse, el intento de
// crear la orden automática (fuera del alcance de C2) tome la rama
// NO_APLICA; si falla por no existir un OPERATIVO por defecto en
// nextproject_test, crearOrdenAutomatica ya está diseñada para no lanzar —
// no afecta ninguna aserción de estas pruebas, que son exclusivamente sobre
// `leads.clasificacion`.
async function crearYEnviarCotizacion(solicitudId: string) {
  await cambiarEstadoSolicitud(solicitudId, 'EN_REVISION');
  const cotizacion = await crearCotizacion({
    solicitudId,
    valor: 100,
    descripcion: null,
    creadoPor: creadoPorId,
    anticipoPorcentaje: 0,
  });
  return cambiarEstadoCotizacion(cotizacion.id, 'ENVIADA');
}

async function aceptarPublicamente(cotizacionId: string) {
  const { token, codigo } = await generarEnlaceCotizacion(cotizacionId);
  return aceptarCotizacionPublica(token, codigo);
}

describe('C2 — Corrección A: solicitud principal -> CALIENTE (nextproject_test, real)', () => {
  it('1) lead nuevo creado junto con la solicitud: queda CALIENTE', async () => {
    const resultado = await crearSolicitudDePrueba('A1');
    const leads = await leadsRepo.listarPorSolicitud(resultado.solicitud.id);
    expect(leads).toHaveLength(1);
    expect(leads[0].clasificacion).toBe('CALIENTE');
    expect(leads[0].estado).toBe('ACTIVO');
  });

  it('2a) lead huérfano FRIO reutilizado: pasa a CALIENTE', async () => {
    const { email, telefono } = datosUnicos('A2a');
    const huerfano = await leadsRepo.create(pool, { nombre: 'Prueba C2 A2a', telefono, email, fuente: 'WEB' });
    expect(huerfano.clasificacion).toBe('FRIO');

    const resultado = await crearSolicitud(
      { nombre: 'Prueba C2 A2a', empresa: null, email, telefono, servicio: 'x', descripcion: 'y', cantidad: 1 },
      `c2-A2a-${randomUUID()}`
    );

    const reutilizado = await leadsRepo.findById(huerfano.id);
    expect(reutilizado?.clasificacion).toBe('CALIENTE');
    expect(reutilizado?.solicitud_id).toBe(resultado.solicitud.id);
  });

  it('2b) lead huérfano TIBIO reutilizado: pasa a CALIENTE', async () => {
    const { email, telefono } = datosUnicos('A2b');
    const huerfano = await leadsRepo.create(pool, { nombre: 'Prueba C2 A2b', telefono, email, fuente: 'WEB' });
    await leadsRepo.update(huerfano.id, { clasificacion: 'TIBIO' });

    const resultado = await crearSolicitud(
      { nombre: 'Prueba C2 A2b', empresa: null, email, telefono, servicio: 'x', descripcion: 'y', cantidad: 1 },
      `c2-A2b-${randomUUID()}`
    );

    const reutilizado = await leadsRepo.findById(huerfano.id);
    expect(reutilizado?.clasificacion).toBe('CALIENTE');
    expect(reutilizado?.solicitud_id).toBe(resultado.solicitud.id);
  });

  it('3) lead huérfano CONVERTIDO: se conserva intacto; se crea un lead nuevo CALIENTE', async () => {
    const { email, telefono } = datosUnicos('A3');
    const protegido = await leadsRepo.create(pool, { nombre: 'Prueba C2 A3', telefono, email, fuente: 'WEB' });
    await leadsRepo.update(protegido.id, { clasificacion: 'CONVERTIDO' });

    const resultado = await crearSolicitud(
      { nombre: 'Prueba C2 A3', empresa: null, email, telefono, servicio: 'x', descripcion: 'y', cantidad: 1 },
      `c2-A3-${randomUUID()}`
    );

    const original = await leadsRepo.findById(protegido.id);
    expect(original?.clasificacion).toBe('CONVERTIDO');
    expect(original?.solicitud_id).toBeNull();

    const leadsDeLaNueva = await leadsRepo.listarPorSolicitud(resultado.solicitud.id);
    expect(leadsDeLaNueva).toHaveLength(1);
    expect(leadsDeLaNueva[0].id).not.toBe(protegido.id);
    expect(leadsDeLaNueva[0].clasificacion).toBe('CALIENTE');
  });

  it('4) lead huérfano RECURRENTE: se conserva intacto; se crea un lead nuevo CALIENTE', async () => {
    const { email, telefono } = datosUnicos('A4');
    const protegido = await leadsRepo.create(pool, { nombre: 'Prueba C2 A4', telefono, email, fuente: 'WEB' });
    await leadsRepo.update(protegido.id, { clasificacion: 'RECURRENTE' });

    const resultado = await crearSolicitud(
      { nombre: 'Prueba C2 A4', empresa: null, email, telefono, servicio: 'x', descripcion: 'y', cantidad: 1 },
      `c2-A4-${randomUUID()}`
    );

    const original = await leadsRepo.findById(protegido.id);
    expect(original?.clasificacion).toBe('RECURRENTE');
    expect(original?.solicitud_id).toBeNull();

    const leadsDeLaNueva = await leadsRepo.listarPorSolicitud(resultado.solicitud.id);
    expect(leadsDeLaNueva).toHaveLength(1);
    expect(leadsDeLaNueva[0].id).not.toBe(protegido.id);
    expect(leadsDeLaNueva[0].clasificacion).toBe('CALIENTE');
  });

  it('5) formulario secundario ("Hablar con un asesor"): mantiene FRIO, sin tocar esta corrección', async () => {
    const { email, telefono } = datosUnicos('A5');
    const lead = await crearLead({ nombre: 'Prueba C2 A5', telefono, email, fuente: 'WEB' });
    expect(lead.clasificacion).toBe('FRIO');
    expect(lead.solicitud_id).toBeNull();
  });
});

describe('C2 — Corrección B: cotización aceptada -> CONVERTIDO (nextproject_test, real)', () => {
  it('6) cotización ENVIADA pero no aceptada: no convierte el lead', async () => {
    const resultado = await crearSolicitudDePrueba('B6');
    await crearYEnviarCotizacion(resultado.solicitud.id);

    const leads = await leadsRepo.listarPorSolicitud(resultado.solicitud.id);
    expect(leads).toHaveLength(1);
    expect(leads[0].clasificacion).toBe('CALIENTE');
  });

  it('7) cotización aceptada válidamente con lead CALIENTE: pasa a CONVERTIDO', async () => {
    const resultado = await crearSolicitudDePrueba('B7');
    const enviada = await crearYEnviarCotizacion(resultado.solicitud.id);
    await aceptarPublicamente(enviada.id);

    const leads = await leadsRepo.listarPorSolicitud(resultado.solicitud.id);
    expect(leads).toHaveLength(1);
    expect(leads[0].clasificacion).toBe('CONVERTIDO');
  });

  it('8) cotización aceptada con lead TIBIO ya vinculado (registro anterior): pasa a CONVERTIDO', async () => {
    const resultado = await crearSolicitudDePrueba('B8');
    // Simula un registro anterior a la Corrección A: un lead TIBIO que ya
    // tenía esta solicitud vinculada (estado histórico posible antes de C2,
    // cuando createConVinculo todavía producía TIBIO).
    const leadsAntes = await leadsRepo.listarPorSolicitud(resultado.solicitud.id);
    await leadsRepo.update(leadsAntes[0].id, { clasificacion: 'TIBIO' });

    const enviada = await crearYEnviarCotizacion(resultado.solicitud.id);
    await aceptarPublicamente(enviada.id);

    const lead = await leadsRepo.findById(leadsAntes[0].id);
    expect(lead?.clasificacion).toBe('CONVERTIDO');
  });

  it('9) cotización aceptada con lead RECURRENTE: conserva RECURRENTE', async () => {
    const resultado = await crearSolicitudDePrueba('B9');
    const leadsAntes = await leadsRepo.listarPorSolicitud(resultado.solicitud.id);
    await leadsRepo.update(leadsAntes[0].id, { clasificacion: 'RECURRENTE' });

    const enviada = await crearYEnviarCotizacion(resultado.solicitud.id);
    await aceptarPublicamente(enviada.id);

    const lead = await leadsRepo.findById(leadsAntes[0].id);
    expect(lead?.clasificacion).toBe('RECURRENTE');
  });

  it('10) cotización aceptada sin ningún lead vinculado a la solicitud: no crea uno', async () => {
    // Solicitud creada SIN pasar por crearSolicitud() (que siempre genera un
    // lead) — directamente por el repositorio, para simular una solicitud
    // sin lead vinculado (caso excepcional, pero posible en el esquema
    // real: no hay ninguna restricción que obligue a que exista un lead
    // por cada solicitud).
    const { email, telefono } = datosUnicos('B10');
    const cliente = await clientesRepo.create(pool, { nombre: 'Prueba C2 B10', empresa: null, email, telefono });
    const solicitud = await solicitudesRepo.create(pool, {
      clienteId: cliente.id,
      servicio: 'x',
      descripcion: 'y',
      cantidad: 1,
      fechaRequerida: null,
    });

    const antes = await leadsRepo.listarPorSolicitud(solicitud.id);
    expect(antes).toHaveLength(0);

    const enviada = await crearYEnviarCotizacion(solicitud.id);
    await aceptarPublicamente(enviada.id);

    const despues = await leadsRepo.listarPorSolicitud(solicitud.id);
    expect(despues).toHaveLength(0);
  });

  it('11) aceptar una cotización no afecta leads de otras solicitudes', async () => {
    const resultadoA = await crearSolicitudDePrueba('B11-A');
    const resultadoB = await crearSolicitudDePrueba('B11-B');

    const enviadaA = await crearYEnviarCotizacion(resultadoA.solicitud.id);
    await aceptarPublicamente(enviadaA.id);

    const leadsA = await leadsRepo.listarPorSolicitud(resultadoA.solicitud.id);
    const leadsB = await leadsRepo.listarPorSolicitud(resultadoB.solicitud.id);

    expect(leadsA[0].clasificacion).toBe('CONVERTIDO');
    // B nunca tuvo su propia cotización aceptada: debe seguir exactamente
    // como quedó al crear la solicitud (CALIENTE), sin ningún efecto cruzado.
    expect(leadsB[0].clasificacion).toBe('CALIENTE');
  });
});
