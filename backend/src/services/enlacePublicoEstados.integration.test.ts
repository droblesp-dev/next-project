// Enlace publico segun el estado de la cotizacion (decision del negocio):
//  - VENCIDA y CANCELADA: mismo mensaje generico (EnlaceInvalidoError) en TODOS los puntos publicos, sin datos.
//  - RECHAZADA: se muestra (estado RECHAZADA) pero no admite aceptar ni rechazar de nuevo.
// Pruebas reales contra nextproject_test (comando manual `npm run test:integration`).
import { randomUUID } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../config/db.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import {
  AccionNoPermitidaError,
  aceptarCotizacionPublica,
  crearCotizacion,
  EnlaceInvalidoError,
  generarEnlaceCotizacion,
  rechazarCotizacionPublica,
  solicitarRecuperacionCodigo,
  validarEnlaceCotizacion,
  verificarCodigoCotizacion,
  verificarRecuperacionCodigo,
} from './cotizaciones.service.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';

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
     VALUES (gen_random_uuid(), 'Prueba enlace publico', $1, 'placeholder', $2) RETURNING id`,
    [`enlace-estados.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  comercialId = u.rows[0].id;
});

async function cotizacionConEnlace() {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba enlace publico',
      empresa: null,
      email: `enlace-estados.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio enlace publico',
      descripcion: 'Registro ficticio de integracion (estados del enlace publico).',
      cantidad: 1,
    },
    `enlace-estados-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  const cot = await crearCotizacion({ solicitudId: s.solicitud.id, valor: 100, descripcion: null, creadoPor: comercialId, anticipoPorcentaje: 0 });
  await pool.query(`UPDATE cotizaciones SET estado = 'ENVIADA' WHERE id = $1`, [cot.id]);
  const enlace = await generarEnlaceCotizacion(cot.id);
  return { id: cot.id, token: enlace.token, codigo: enlace.codigo };
}

describe.each(['VENCIDA', 'CANCELADA'] as const)('enlace de una cotizacion %s', (estado) => {
  it('todos los puntos publicos responden con el mismo error generico y no revelan datos', async () => {
    const { id, token, codigo } = await cotizacionConEnlace();
    // el enlace era valido mientras estaba ENVIADA
    await expect(validarEnlaceCotizacion(token)).resolves.toMatchObject({ valido: true });

    await pool.query(`UPDATE cotizaciones SET estado = $2 WHERE id = $1`, [id, estado]);

    await expect(validarEnlaceCotizacion(token)).rejects.toBeInstanceOf(EnlaceInvalidoError);
    await expect(verificarCodigoCotizacion(token, codigo)).rejects.toBeInstanceOf(EnlaceInvalidoError);
    await expect(aceptarCotizacionPublica(token, codigo)).rejects.toBeInstanceOf(EnlaceInvalidoError);
    await expect(rechazarCotizacionPublica(token, codigo)).rejects.toBeInstanceOf(EnlaceInvalidoError);
    await expect(solicitarRecuperacionCodigo(token)).rejects.toBeInstanceOf(EnlaceInvalidoError);
    await expect(verificarRecuperacionCodigo(token, '000000')).rejects.toBeInstanceOf(EnlaceInvalidoError);
  });
});

describe('enlace de una cotizacion RECHAZADA', () => {
  it('se muestra como RECHAZADA y no admite aceptar ni volver a rechazar; el estado no cambia', async () => {
    const { id, token, codigo } = await cotizacionConEnlace();
    const rechazada = await rechazarCotizacionPublica(token, codigo);
    expect(rechazada.estado).toBe('RECHAZADA');

    const vista = await verificarCodigoCotizacion(token, codigo);
    expect(vista.estado).toBe('RECHAZADA');

    await expect(aceptarCotizacionPublica(token, codigo)).rejects.toBeInstanceOf(AccionNoPermitidaError);
    await expect(rechazarCotizacionPublica(token, codigo)).rejects.toBeInstanceOf(AccionNoPermitidaError);
    expect((await cotizacionesRepo.findById(id))?.estado).toBe('RECHAZADA');
  });
});
