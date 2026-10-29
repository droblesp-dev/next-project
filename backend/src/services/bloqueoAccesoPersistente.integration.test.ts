// QA-06 (V23): el bloqueo por intentos fallidos del codigo de acceso es persistente y conserva las reglas:
// 5 fallos consecutivos -> 15 min de bloqueo; un codigo correcto o un codigo nuevo reinician el contador;
// el bloqueo no se extiende ni afecta a otras cotizaciones; la recuperacion por correo sigue disponible.
// Pruebas reales contra nextproject_test (comando manual `npm run test:integration`).
import { randomUUID } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../config/db.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import {
  CodigoInvalidoError,
  crearCotizacion,
  DemasiadosIntentosError,
  generarEnlaceCotizacion,
  solicitarRecuperacionCodigo,
  verificarCodigoCotizacion,
} from './cotizaciones.service.js';

let comercialId: string;

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  const rol = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'COMERCIAL'`);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), 'Prueba bloqueo acceso', $1, 'placeholder', $2) RETURNING id`,
    [`bloqueo-acceso.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  comercialId = u.rows[0].id;
});

async function cotizacionConEnlace() {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba bloqueo acceso',
      empresa: null,
      email: `bloqueo-acceso.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio bloqueo acceso',
      descripcion: 'Registro ficticio de integracion (bloqueo persistente del codigo de acceso).',
      cantidad: 1,
    },
    `bloqueo-acceso-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  const cot = await crearCotizacion({ solicitudId: s.solicitud.id, valor: 100, descripcion: null, creadoPor: comercialId, anticipoPorcentaje: 0 });
  await pool.query(`UPDATE cotizaciones SET estado = 'ENVIADA' WHERE id = $1`, [cot.id]);
  const enlace = await generarEnlaceCotizacion(cot.id);
  return { id: cot.id, token: enlace.token, codigo: enlace.codigo };
}

async function columnas(id: string) {
  const r = await pool.query<{ intentos: number; bloqueado: boolean; hasta: Date | null }>(
    `SELECT acceso_intentos_fallidos AS intentos, COALESCE(acceso_bloqueado_hasta > now(), false) AS bloqueado,
            acceso_bloqueado_hasta AS hasta FROM cotizaciones WHERE id = $1`,
    [id]
  );
  return r.rows[0];
}

function incorrecto(codigo: string): string {
  return codigo === '000000' ? '000001' : '000000';
}

async function fallar(token: string, codigo: string, veces: number) {
  for (let i = 0; i < veces; i++) {
    await expect(verificarCodigoCotizacion(token, incorrecto(codigo))).rejects.toBeInstanceOf(CodigoInvalidoError);
  }
}

describe('QA-06: bloqueo persistente del codigo de acceso', () => {
  it('cuatro fallos no bloquean; el quinto bloquea y se guarda en la BD (sobrevive a un reinicio)', async () => {
    const { id, token, codigo } = await cotizacionConEnlace();
    await fallar(token, codigo, 4);
    expect(await columnas(id)).toMatchObject({ intentos: 4, bloqueado: false, hasta: null });

    await fallar(token, codigo, 1);
    expect(await columnas(id)).toMatchObject({ intentos: 5, bloqueado: true });
  });

  it('bloqueado: incluso el codigo correcto se rechaza y el bloqueo no se extiende', async () => {
    const { id, token, codigo } = await cotizacionConEnlace();
    await fallar(token, codigo, 5);
    const antes = await columnas(id);

    await expect(verificarCodigoCotizacion(token, codigo)).rejects.toBeInstanceOf(DemasiadosIntentosError);
    await expect(verificarCodigoCotizacion(token, incorrecto(codigo))).rejects.toBeInstanceOf(DemasiadosIntentosError);

    expect(await columnas(id)).toEqual(antes);
  });

  it('el bloqueo dura unos 15 minutos', async () => {
    const { id, token, codigo } = await cotizacionConEnlace();
    await fallar(token, codigo, 5);
    const r = await pool.query<{ minutos: string }>(
      `SELECT (extract(epoch FROM (acceso_bloqueado_hasta - now())) / 60)::numeric(6,2) AS minutos FROM cotizaciones WHERE id = $1`,
      [id]
    );
    expect(Number(r.rows[0].minutos)).toBeGreaterThan(14);
    expect(Number(r.rows[0].minutos)).toBeLessThanOrEqual(15);
  });

  it('al vencer el bloqueo, el codigo correcto entra y el contador se reinicia', async () => {
    const { id, token, codigo } = await cotizacionConEnlace();
    await fallar(token, codigo, 5);
    await pool.query(`UPDATE cotizaciones SET acceso_bloqueado_hasta = now() - interval '1 minute' WHERE id = $1`, [id]);

    const vista = await verificarCodigoCotizacion(token, codigo);

    expect(vista.estado).toBe('ENVIADA');
    expect(await columnas(id)).toMatchObject({ intentos: 0, bloqueado: false, hasta: null });
  });

  it('al vencer el bloqueo, un fallo reinicia la cuenta en 1 (no vuelve a bloquear de inmediato)', async () => {
    const { id, token, codigo } = await cotizacionConEnlace();
    await fallar(token, codigo, 5);
    await pool.query(`UPDATE cotizaciones SET acceso_bloqueado_hasta = now() - interval '1 minute' WHERE id = $1`, [id]);

    await fallar(token, codigo, 1);

    expect(await columnas(id)).toMatchObject({ intentos: 1, bloqueado: false, hasta: null });
  });

  it('un codigo correcto antes del limite reinicia el contador', async () => {
    const { id, token, codigo } = await cotizacionConEnlace();
    await fallar(token, codigo, 3);
    await verificarCodigoCotizacion(token, codigo);
    expect(await columnas(id)).toMatchObject({ intentos: 0 });
  });

  it('generar un codigo nuevo levanta el bloqueo', async () => {
    const { id, token, codigo } = await cotizacionConEnlace();
    await fallar(token, codigo, 5);
    expect((await columnas(id)).bloqueado).toBe(true);

    const nuevo = await generarEnlaceCotizacion(id);

    expect(await columnas(id)).toMatchObject({ intentos: 0, bloqueado: false });
    await expect(verificarCodigoCotizacion(nuevo.token, nuevo.codigo)).resolves.toMatchObject({ estado: 'ENVIADA' });
  });

  it('el bloqueo es por cotizacion: otra cotizacion no se ve afectada', async () => {
    const a = await cotizacionConEnlace();
    const b = await cotizacionConEnlace();
    await fallar(a.token, a.codigo, 5);

    await expect(verificarCodigoCotizacion(b.token, b.codigo)).resolves.toMatchObject({ estado: 'ENVIADA' });
    expect((await columnas(b.id)).bloqueado).toBe(false);
  });

  it('bloqueado, el cliente puede iniciar la recuperacion por correo (no recibe el error de bloqueo)', async () => {
    const { token, codigo } = await cotizacionConEnlace();
    await fallar(token, codigo, 5);

    const estado = await solicitarRecuperacionCodigo(token);

    expect(['enviado', 'no_disponible']).toContain(estado);
  });

  it('dos fallos simultaneos no pierden la cuenta (UPDATE atomico)', async () => {
    const { id, token, codigo } = await cotizacionConEnlace();
    await Promise.allSettled([
      verificarCodigoCotizacion(token, incorrecto(codigo)),
      verificarCodigoCotizacion(token, incorrecto(codigo)),
      verificarCodigoCotizacion(token, incorrecto(codigo)),
    ]);
    expect((await columnas(id)).intentos).toBe(3);
  });
});
