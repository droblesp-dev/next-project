// QA-08 (V24): la cuenta que el cliente indica al subir el comprobante se guarda como dato INFORMATIVO en
// comprobantes_pago_cliente. No crea ni cambia nada en transferencias_pago: la cuenta real la confirma COMERCIAL.
// Pruebas reales contra nextproject_test (comando manual `npm run test:integration`). Las cuentas creadas
// quedan referenciadas por el comprobante (FK RESTRICT), por eso estas pruebas no las eliminan.
import { randomUUID } from 'crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import * as cuentasRepo from '../repositories/cuentasBancarias.repository.js';
import { listarConCuentaIndicada } from '../repositories/comprobantesPagoCliente.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import {
  aceptarCotizacionPublica,
  crearCotizacion,
  CuentaIndicadaInvalidaError,
  generarEnlaceCotizacion,
  registrarComprobantePublico,
  verificarCodigoCotizacion,
} from './cotizaciones.service.js';

let comercialId: string;
let cuentaActiva: { id: string; banco: string };
let cuentaInactiva: { id: string };

beforeAll(async () => {
  await pool.query(
    `INSERT INTO roles (id, nombre)
     VALUES (gen_random_uuid(), 'ADMIN'), (gen_random_uuid(), 'COMERCIAL'), (gen_random_uuid(), 'OPERATIVO')
     ON CONFLICT (nombre) DO NOTHING`
  );
  const rol = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE nombre = 'COMERCIAL'`);
  const u = await pool.query<{ id: string }>(
    `INSERT INTO usuarios (id, nombre, email, password_hash, rol_id)
     VALUES (gen_random_uuid(), 'Prueba cuenta indicada', $1, 'placeholder', $2) RETURNING id`,
    [`cuenta-indicada.${randomUUID()}@nextproject-test.local`, rol.rows[0].id]
  );
  comercialId = u.rows[0].id;
  const sufijo = randomUUID().slice(0, 8);
  const a = await cuentasRepo.create({
    banco: `Banco Prueba Indicada ${sufijo}`, titular: 'Titular de prueba', tipoCuenta: 'AHORROS',
    numeroCuenta: `9${Math.floor(100000000 + Math.random() * 899999999)}`, creadoPor: comercialId,
    bancoCatalogoId: null, titularVisibleCliente: true,
  });
  cuentaActiva = { id: a.id, banco: a.banco };
  const i = await cuentasRepo.create({
    banco: `Banco Prueba Inactiva ${sufijo}`, titular: 'Titular de prueba', tipoCuenta: 'AHORROS',
    numeroCuenta: `8${Math.floor(100000000 + Math.random() * 899999999)}`, creadoPor: comercialId,
    bancoCatalogoId: null, titularVisibleCliente: true, activo: false,
  });
  cuentaInactiva = { id: i.id };
});

async function cotizacionAceptada() {
  const sufijo = randomUUID();
  const s = await crearSolicitud(
    {
      nombre: 'Prueba cuenta indicada',
      empresa: null,
      email: `cuenta-indicada.${sufijo}@nextproject-test.local`,
      telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
      servicio: 'Servicio cuenta indicada',
      descripcion: 'Registro ficticio de integracion (cuenta indicada por el cliente).',
      cantidad: 1,
    },
    `cuenta-indicada-${sufijo}`
  );
  await cambiarEstadoSolicitud(s.solicitud.id, 'EN_REVISION');
  const cot = await crearCotizacion({
    solicitudId: s.solicitud.id, valor: 100, descripcion: null, creadoPor: comercialId,
    anticipoPorcentaje: 50, metodoAnticipo: 'TRANSFERENCIA',
  });
  await pool.query(`UPDATE cotizaciones SET estado = 'ENVIADA' WHERE id = $1`, [cot.id]);
  const enlace = await generarEnlaceCotizacion(cot.id);
  await aceptarCotizacionPublica(enlace.token, enlace.codigo);
  return { id: cot.id, token: enlace.token, codigo: enlace.codigo };
}

const archivoFalso = () => ({ escribir: vi.fn(async () => undefined), deshacer: vi.fn(async () => undefined) });

describe('QA-08: cuenta indicada por el cliente (informativa)', () => {
  it('con una cuenta activa: se guarda en el comprobante y el personal la ve; no se toca transferencias_pago', async () => {
    const c = await cotizacionAceptada();
    const archivo = archivoFalso();

    await registrarComprobantePublico(c.token, c.codigo, `${randomUUID()}.png`, archivo, cuentaActiva.id);

    const filas = await pool.query(`SELECT cuenta_bancaria_id FROM comprobantes_pago_cliente WHERE cotizacion_id = $1`, [c.id]);
    expect(filas.rows).toEqual([{ cuenta_bancaria_id: cuentaActiva.id }]);
    const vista = await listarConCuentaIndicada(c.id);
    expect(vista).toHaveLength(1);
    expect(vista[0]).toMatchObject({ tipo_pago: 'ANTICIPO', cuenta_indicada: { banco: cuentaActiva.banco } });
    expect(vista[0]).not.toHaveProperty('archivo');
    const t = await pool.query(`SELECT count(*)::int AS n FROM transferencias_pago WHERE cotizacion_id = $1`, [c.id]);
    expect(t.rows[0].n).toBe(0);
    expect(archivo.escribir).toHaveBeenCalledTimes(1);
  });

  it('sin cuenta: el comprobante se registra igual con la cuenta en NULL', async () => {
    const c = await cotizacionAceptada();
    await registrarComprobantePublico(c.token, c.codigo, `${randomUUID()}.png`, archivoFalso());
    const vista = await listarConCuentaIndicada(c.id);
    expect(vista[0]).toMatchObject({ cuenta_indicada: null });
  });

  it.each([
    ['una cuenta inexistente', () => randomUUID()],
    ['una cuenta inactiva', () => cuentaInactiva.id],
  ])('rechaza %s: no se registra nada ni se escribe el archivo', async (_n, id) => {
    const c = await cotizacionAceptada();
    const archivo = archivoFalso();

    await expect(registrarComprobantePublico(c.token, c.codigo, `${randomUUID()}.png`, archivo, id())).rejects.toBeInstanceOf(
      CuentaIndicadaInvalidaError
    );

    expect(archivo.escribir).not.toHaveBeenCalled();
    expect((await listarConCuentaIndicada(c.id))).toHaveLength(0);
    const fila = await pool.query(`SELECT comprobante_anticipo FROM cotizaciones WHERE id = $1`, [c.id]);
    expect(fila.rows[0].comprobante_anticipo).toBeNull();
  });

  it('el DTO publico entrega el id de las cuentas activas (y solo de las activas)', async () => {
    const c = await cotizacionAceptada();
    const vista = await verificarCodigoCotizacion(c.token, c.codigo);
    const ids = vista.cuentas_bancarias_activas.map((x) => (x as { id: string }).id);
    expect(ids).toContain(cuentaActiva.id);
    expect(ids).not.toContain(cuentaInactiva.id);
  });
});
