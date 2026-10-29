// "Implementación Fase 1: Recuperación segura del código de cotización"
// (autorización explícita) — pruebas de integración reales contra
// `nextproject_test`. Mismo guard obligatorio que el resto de
// *.integration.test.ts; nunca se ejecuta contra `nextproject`.
//
// Nunca se llama a Brevo real: `global.fetch` se intercepta puntualmente
// (vi.spyOn + mockRestore en cada prueba). El valor del OTP/código nunca
// se conoce por otra vía que no sea el propio cuerpo del correo
// interceptado — exactamente como lo recibiría el cliente real por
// correo, nunca por la respuesta HTTP pública (que nunca lo incluye).
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../config/db.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import { crearSolicitud, cambiarEstadoSolicitud } from './solicitudes.service.js';
import {
  crearCotizacion,
  cambiarEstadoCotizacion,
  generarEnlaceCotizacion,
  aceptarCotizacionPublica,
  verificarCodigoCotizacion,
  CodigoInvalidoError,
} from './cotizaciones.service.js';
import {
  solicitarRecuperacionCodigoController,
  verificarRecuperacionCodigoController,
} from '../controllers/cotizaciones.controller.js';

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
     VALUES (gen_random_uuid(), 'Prueba OTP (creado_por)', $1, 'placeholder-no-usado-para-login', $2)
     RETURNING id`,
    [`otp.creado-por.${sufijo}@nextproject-test.local`, rol.rows[0].id]
  );
  creadoPorId = inserted.rows[0].id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function datosUnicos(etiqueta: string) {
  const sufijo = randomUUID();
  return {
    email: `otp.${etiqueta}.${sufijo}@nextproject-test.local`.toLowerCase(),
    telefono: `+5939${sufijo.replace(/-/g, '').slice(0, 8)}`,
    idempotencyKey: `otp-${etiqueta}-${sufijo}`,
  };
}

async function crearCotizacionEnviada(etiqueta: string, anticipoPorcentaje = 0, metodoAnticipo?: string) {
  const { email, telefono, idempotencyKey } = datosUnicos(etiqueta);
  const resultado = await crearSolicitud(
    {
      nombre: `Prueba OTP ${etiqueta}`,
      empresa: null,
      email,
      telefono,
      servicio: `Servicio OTP ${etiqueta}`,
      descripcion: `Registro ficticio de integración (OTP, caso ${etiqueta}).`,
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
    anticipoPorcentaje,
    metodoAnticipo,
  });
  const enviada = await cambiarEstadoCotizacion(cotizacion.id, 'ENVIADA');
  return { solicitud: resultado.solicitud, cotizacion: enviada, clienteEmail: email };
}

// Token real — se obtiene llamando directamente al SERVICE (no al
// controller, que además dispararía el correo de la Fase 1 de envío
// automático, fuera del interés de estas pruebas).
async function obtenerToken(cotizacionId: string): Promise<string> {
  const { token } = await generarEnlaceCotizacion(cotizacionId);
  return token;
}

function crearRespuestaFake() {
  const estado: { status: number; body: unknown } = { status: 0, body: undefined };
  const res = {
    status(codigo: number) {
      estado.status = codigo;
      return res;
    },
    json(payload: unknown) {
      estado.body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, estado };
}

function mockFetchExitoso() {
  return vi.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ messageId: 'msg-otp' }), { status: 201 }));
}

function mockFetchFallido() {
  return vi.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ message: 'Fallo simulado' }), { status: 400 }));
}

// Extrae el código de 6 dígitos del cuerpo real interceptado (nunca de la
// respuesta HTTP pública) — exactamente como lo recibiría el cliente real
// por correo.
function extraerCodigoDelCuerpo(cuerpoJson: string): string {
  const { textContent } = JSON.parse(cuerpoJson) as { textContent: string };
  const match = textContent.match(/(?:^|\s)(\d{6})(?:\s|$)/m);
  if (!match) throw new Error('No se encontró un código de 6 dígitos en el cuerpo del correo capturado.');
  return match[1];
}

async function solicitar(token: string): Promise<{ estado: unknown; cuerpoCorreo: string | null }> {
  const fetchSpy = global.fetch as ReturnType<typeof vi.fn>;
  const llamadasAntes = fetchSpy.mock?.calls.length ?? 0;
  const { res, estado } = crearRespuestaFake();
  await solicitarRecuperacionCodigoController({ params: { token } } as unknown as Request, res);
  const llamadasDespues = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
  const cuerpoCorreo =
    llamadasDespues > llamadasAntes
      ? (((global.fetch as ReturnType<typeof vi.fn>).mock.calls[llamadasDespues - 1][1] as { body: string }).body)
      : null;
  return { estado: (estado.body as { estado?: string }).estado, cuerpoCorreo };
}

async function verificar(token: string, otp: string): Promise<{ estado: unknown; cuerpoCorreo: string | null }> {
  const fetchSpy = global.fetch as ReturnType<typeof vi.fn>;
  const llamadasAntes = fetchSpy.mock?.calls.length ?? 0;
  const { res, estado } = crearRespuestaFake();
  await verificarRecuperacionCodigoController({ params: { token }, body: { otp } } as unknown as Request, res);
  const llamadasDespues = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
  const cuerpoCorreo =
    llamadasDespues > llamadasAntes
      ? (((global.fetch as ReturnType<typeof vi.fn>).mock.calls[llamadasDespues - 1][1] as { body: string }).body)
      : null;
  return { estado: (estado.body as { estado?: string }).estado, cuerpoCorreo };
}

describe('Recuperación del código de cotización — OTP por correo (nextproject_test, real)', () => {
  it('1) solicitud y envío del código temporal', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T1');
    const token = await obtenerToken(cotizacion.id);

    const { estado, cuerpoCorreo } = await solicitar(token);
    expect(estado).toBe('enviado');
    expect(cuerpoCorreo).not.toBeNull();
    expect(extraerCodigoDelCuerpo(cuerpoCorreo as string)).toMatch(/^\d{6}$/);
  });

  it('2) verificación correcta y regeneración del código de acceso', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T2');
    const token = await obtenerToken(cotizacion.id);

    const { cuerpoCorreo: cuerpoOtp } = await solicitar(token);
    const otp = extraerCodigoDelCuerpo(cuerpoOtp as string);

    const hashAntes = await cotizacionesRepo.obtenerHashCodigoAcceso(cotizacion.id);
    const { estado, cuerpoCorreo: cuerpoCodigo } = await verificar(token, otp);

    expect(estado).toBe('regenerado');
    const hashDespues = await cotizacionesRepo.obtenerHashCodigoAcceso(cotizacion.id);
    expect(hashDespues).not.toBe(hashAntes);

    const nuevoCodigoAcceso = extraerCodigoDelCuerpo(cuerpoCodigo as string);
    // El nuevo código de acceso real SÍ debe funcionar con el camino
    // normal ya existente (verificarCodigoCotizacion) — prueba de extremo
    // a extremo, no solo del hash en BD.
    const cotizacionPublica = await verificarCodigoCotizacion(token, nuevoCodigoAcceso);
    expect(cotizacionPublica.id).toBe(cotizacion.id);
  });

  it('3) el código temporal vence a los diez minutos', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T3');
    const token = await obtenerToken(cotizacion.id);
    const { cuerpoCorreo } = await solicitar(token);
    const otp = extraerCodigoDelCuerpo(cuerpoCorreo as string);

    const ahoraReal = Date.now();
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(ahoraReal + 10 * 60 * 1000 + 1000);
    try {
      const { estado } = await verificar(token, otp);
      expect(estado).toBe('vencido');
    } finally {
      dateSpy.mockRestore();
    }
  });

  it('4) un código vencido no consume un intento incorrecto', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T4');
    const token = await obtenerToken(cotizacion.id);

    const { cuerpoCorreo: cuerpo1 } = await solicitar(token);
    const otp1 = extraerCodigoDelCuerpo(cuerpo1 as string);

    const ahoraReal = Date.now();
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(ahoraReal + 11 * 60 * 1000);
    const resultadoVencido = await verificar(token, otp1);
    dateSpy.mockRestore();
    expect(resultadoVencido.estado).toBe('vencido');

    // Si el vencimiento hubiera consumido un intento, 2 fallos más ya
    // bloquearían (3 en total). Se comprueba que SIGUEN haciendo falta 3
    // fallos reales desde cero: 2 fallos no bloquean todavía.
    const { cuerpoCorreo: cuerpo2 } = await solicitar(token);
    void extraerCodigoDelCuerpo(cuerpo2 as string); // confirma que se emitió un OTP nuevo real
    const fallo1 = await verificar(token, '000000');
    const fallo2 = await verificar(token, '000000');
    expect(fallo1.estado).toBe('incorrecto');
    expect(fallo2.estado).toBe('incorrecto');
  });

  it('5) un código nuevo invalida el anterior', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T5');
    const token = await obtenerToken(cotizacion.id);

    const { cuerpoCorreo: cuerpo1 } = await solicitar(token);
    const otp1 = extraerCodigoDelCuerpo(cuerpo1 as string);
    const { cuerpoCorreo: cuerpo2 } = await solicitar(token);
    const otp2 = extraerCodigoDelCuerpo(cuerpo2 as string);

    const conOtpViejo = await verificar(token, otp1);
    expect(conOtpViejo.estado).toBe('incorrecto');

    const conOtpNuevo = await verificar(token, otp2);
    expect(conOtpNuevo.estado).toBe('regenerado');
  });

  it('6) 2 fallos + vencimiento + código nuevo + 3er fallo: los fallos se conservan y bloquean', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T6');
    const token = await obtenerToken(cotizacion.id);

    const { cuerpoCorreo: cuerpo1 } = await solicitar(token);
    void extraerCodigoDelCuerpo(cuerpo1 as string);
    expect((await verificar(token, '111111')).estado).toBe('incorrecto');
    expect((await verificar(token, '222222')).estado).toBe('incorrecto');

    const ahoraReal = Date.now();
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(ahoraReal + 11 * 60 * 1000);
    const vencido = await verificar(token, '333333');
    dateSpy.mockRestore();
    expect(vencido.estado).toBe('vencido');

    const { cuerpoCorreo: cuerpo2 } = await solicitar(token);
    void extraerCodigoDelCuerpo(cuerpo2 as string);
    // Tercer fallo REAL (el vencimiento anterior no contó) — es el que
    // cruza el umbral: debe anunciarse como 'bloqueado', no 'incorrecto'.
    const tercerFallo = await verificar(token, '444444');
    expect(tercerFallo.estado).toBe('bloqueado');
    // La verificación definitiva del bloqueo: cualquier intento posterior,
    // incluso de solicitar un OTP nuevo, debe quedar bloqueado.
    const siguienteIntento = await verificar(token, '555555');
    expect(siguienteIntento.estado).toBe('bloqueado');
    const siguienteSolicitud = await solicitar(token);
    expect(siguienteSolicitud.estado).toBe('bloqueado');
  });

  it('7) tres fallos bloquean la recuperación automática', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T7');
    const token = await obtenerToken(cotizacion.id);
    await solicitar(token);

    expect((await verificar(token, '000001')).estado).toBe('incorrecto');
    expect((await verificar(token, '000002')).estado).toBe('incorrecto');
    const tercerFallo = await verificar(token, '000003');
    expect(tercerFallo.estado).toBe('bloqueado');

    const despuesDelBloqueo = await verificar(token, '000004');
    expect(despuesDelBloqueo.estado).toBe('bloqueado');
  });

  it('8) cinco solicitudes permitidas, bloqueo en la sexta', async () => {
    const fetchSpy = mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T8');
    const token = await obtenerToken(cotizacion.id);

    for (let i = 0; i < 5; i += 1) {
      const resultado = await solicitar(token);
      expect(resultado.estado).toBe('enviado');
    }
    const llamadasTrasCinco = fetchSpy.mock.calls.length;

    const sexta = await solicitar(token);
    expect(sexta.estado).toBe('bloqueado');
    // La sexta solicitud NUNCA debe intentar enviar correo.
    expect(fetchSpy.mock.calls.length).toBe(llamadasTrasCinco);
  });

  it('9) el bloqueo persiste al "recargar"/reabrir el enlace (mismo proceso del backend)', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T9');
    const token = await obtenerToken(cotizacion.id);
    await solicitar(token);
    await verificar(token, '000001');
    await verificar(token, '000002');
    await verificar(token, '000003');

    // No existe ningún concepto de sesión en estos endpoints públicos (son
    // sin estado del lado del cliente) — "recargar"/"nueva sesión" es,
    // operativamente, repetir la misma llamada. El bloqueo, al vivir en el
    // servidor por cotizacionId, persiste igual.
    expect((await solicitar(token)).estado).toBe('bloqueado');
    expect((await verificar(token, '000004')).estado).toBe('bloqueado');
  });

  it('10) un OTP no puede utilizarse para otra cotización', async () => {
    mockFetchExitoso();
    const { cotizacion: cotizacionA } = await crearCotizacionEnviada('T10A');
    const { cotizacion: cotizacionB } = await crearCotizacionEnviada('T10B');
    const tokenA = await obtenerToken(cotizacionA.id);
    const tokenB = await obtenerToken(cotizacionB.id);

    await solicitar(tokenA);
    const { cuerpoCorreo: cuerpoB } = await solicitar(tokenB);
    const otpB = extraerCodigoDelCuerpo(cuerpoB as string);

    const resultado = await verificar(tokenA, otpB);
    expect(resultado.estado).toBe('incorrecto');
  });

  it('11) el código temporal no funciona como código de acceso real', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T11');
    const token = await obtenerToken(cotizacion.id);
    const { cuerpoCorreo } = await solicitar(token);
    const otp = extraerCodigoDelCuerpo(cuerpoCorreo as string);

    await expect(verificarCodigoCotizacion(token, otp)).rejects.toBeInstanceOf(CodigoInvalidoError);
  });

  it('12) la recuperación no modifica estado comercial, valores, pagos, comprobantes ni órdenes', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T12', 50, 'TRANSFERENCIA');
    // Enlace que se usará LUEGO para la recuperación (capturado antes de
    // aceptar, para probar que sigue siendo válido después -- ver Q1).
    const token = await obtenerToken(cotizacion.id);

    // Aceptación real con un segundo par token/código (cada llamada a
    // generarEnlaceCotizacion sobrescribe el código de acceso vigente, así
    // que se usa el par devuelto por esta misma llamada para aceptar).
    const { token: tokenAceptacion, codigo: codigoAceptacion } = await generarEnlaceCotizacion(cotizacion.id);
    await aceptarCotizacionPublica(tokenAceptacion, codigoAceptacion);

    const antes = await cotizacionesRepo.findById(cotizacion.id);
    expect(antes?.estado).toBe('ACEPTADA');

    // Recuperación del código DE ACCESO sobre el enlace original obtenido
    // al inicio de la prueba -- sigue siendo válido tras aceptar.
    const { cuerpoCorreo } = await solicitar(token);
    const otp = extraerCodigoDelCuerpo(cuerpoCorreo as string);
    const resultado = await verificar(token, otp);
    expect(resultado.estado).toBe('regenerado');

    const despues = await cotizacionesRepo.findById(cotizacion.id);
    expect(despues?.estado).toBe(antes?.estado);
    expect(despues?.valor).toBe(antes?.valor);
    expect(despues?.anticipo_valor).toBe(antes?.anticipo_valor);
    expect(despues?.anticipo_porcentaje).toBe(antes?.anticipo_porcentaje);
    expect(despues?.estado_anticipo).toBe(antes?.estado_anticipo);
    expect(despues?.saldo_pendiente).toBe(antes?.saldo_pendiente);
    expect(despues?.estado_saldo).toBe(antes?.estado_saldo);
    expect(despues?.comprobante_recibido).toBe(antes?.comprobante_recibido);
  });

  it('13) las cotizaciones VENCIDAS continúan protegidas (410: caducó, sin datos ni OTP)', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T13');
    const token = await obtenerToken(cotizacion.id);

    // Fijar VENCIDA directamente (fixture de prueba, no se ejercita el
    // vencimiento perezoso real) para probar la condición de rechazo.
    await pool.query(`UPDATE cotizaciones SET estado = 'VENCIDA' WHERE id = $1`, [cotizacion.id]);

    const { res: resA, estado: estA } = crearRespuestaFake();
    await solicitarRecuperacionCodigoController({ params: { token } } as unknown as Request, resA);
    expect(estA.status).toBe(410);

    const { res: resB, estado: estB } = crearRespuestaFake();
    await verificarRecuperacionCodigoController({ params: { token }, body: { otp: '123456' } } as unknown as Request, resB);
    expect(estB.status).toBe(410);
  });

  it('14) un correo fallido no produce éxito falso y nunca deja al cliente sin una ruta de recuperación', async () => {
    const { cotizacion } = await crearCotizacionEnviada('T14');
    const token = await obtenerToken(cotizacion.id);

    // (a) Paso A: primer OTP se envía con éxito.
    mockFetchExitoso();
    const { cuerpoCorreo: cuerpoOtp1 } = await solicitar(token);
    const otp1 = extraerCodigoDelCuerpo(cuerpoOtp1 as string);
    vi.restoreAllMocks();

    // (b) Un segundo intento de solicitud, con Brevo fallando: no debe
    // afirmar éxito, y el OTP #1 (todavía vigente) debe seguir funcionando.
    mockFetchFallido();
    const segundaSolicitud = await solicitar(token);
    expect(segundaSolicitud.estado).toBe('no_disponible');
    vi.restoreAllMocks();

    mockFetchExitoso();
    const conOtpOriginal = await verificar(token, otp1);
    expect(conOtpOriginal.estado).toBe('regenerado');
  });

  it('15) ambos correos incluyen el enlace oficial de WhatsApp, sin OTP ni código de acceso dentro de él', async () => {
    mockFetchExitoso();
    const { cotizacion } = await crearCotizacionEnviada('T15');
    const token = await obtenerToken(cotizacion.id);

    const { cuerpoCorreo: cuerpoOtp } = await solicitar(token);
    const otp = extraerCodigoDelCuerpo(cuerpoOtp as string);
    const { cuerpoCorreo: cuerpoCodigo } = await verificar(token, otp);
    const codigoNuevo = extraerCodigoDelCuerpo(cuerpoCodigo as string);

    for (const cuerpo of [cuerpoOtp, cuerpoCodigo]) {
      const { textContent } = JSON.parse(cuerpo as string) as { textContent: string };
      expect(textContent).toContain('https://wa.me/');
      const enlaceMatch = textContent.match(/https:\/\/wa\.me\/\S+/);
      expect(enlaceMatch).not.toBeNull();
      const enlace = enlaceMatch?.[0] ?? '';
      // El OTP y el nuevo código de acceso real existen en alguna parte del
      // correo (eso ya lo prueban las pruebas 1 y 2) — aquí se confirma
      // específicamente que NINGUNO de los dos viaja DENTRO del enlace de
      // WhatsApp (ni en claro ni codificado con encodeURIComponent).
      expect(enlace).not.toContain(otp);
      expect(enlace).not.toContain(codigoNuevo);
    }
  });

  it('14b) Paso C con envío fallido: no regenera el código real y el OTP sigue disponible para reintentar', async () => {
    const { cotizacion } = await crearCotizacionEnviada('T14b');
    const token = await obtenerToken(cotizacion.id);

    mockFetchExitoso();
    const { cuerpoCorreo } = await solicitar(token);
    const otp = extraerCodigoDelCuerpo(cuerpoCorreo as string);
    const hashAntes = await cotizacionesRepo.obtenerHashCodigoAcceso(cotizacion.id);
    vi.restoreAllMocks();

    mockFetchFallido();
    const intentoFallido = await verificar(token, otp);
    expect(intentoFallido.estado).toBe('no_disponible');
    vi.restoreAllMocks();

    const hashDespuesDelFallo = await cotizacionesRepo.obtenerHashCodigoAcceso(cotizacion.id);
    expect(hashDespuesDelFallo).toBe(hashAntes);

    mockFetchExitoso();
    const reintento = await verificar(token, otp);
    expect(reintento.estado).toBe('regenerado');
  });
});
