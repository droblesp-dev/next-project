import { describe, expect, it } from 'vitest';
import { mensajeSolicitudOtp, mensajeVerificacionOtp, type EstadoSolicitudOtp, type EstadoVerificacionOtp } from './recuperacionCodigo';

describe('recuperación del código (QA-13)', () => {
  it('solo avanza al paso del código temporal cuando el correo realmente se envió', () => {
    expect(mensajeSolicitudOtp('enviado').avanza).toBe(true);
    expect(mensajeSolicitudOtp('no_disponible').avanza).toBe(false);
    expect(mensajeSolicitudOtp('bloqueado').avanza).toBe(false);
  });

  it('solo «regenerado» es éxito; vencido y bloqueado reinician el flujo; incorrecto permite reintentar', () => {
    expect(mensajeVerificacionOtp('regenerado')).toMatchObject({ exito: true, reiniciar: false });
    expect(mensajeVerificacionOtp('incorrecto')).toMatchObject({ exito: false, reiniciar: false });
    expect(mensajeVerificacionOtp('vencido')).toMatchObject({ exito: false, reiniciar: true });
    expect(mensajeVerificacionOtp('bloqueado')).toMatchObject({ exito: false, reiniciar: true });
    expect(mensajeVerificacionOtp('no_disponible')).toMatchObject({ exito: false, reiniciar: true });
  });

  it('ningún mensaje revela una dirección de correo ni un código', () => {
    const solicitudes: EstadoSolicitudOtp[] = ['enviado', 'no_disponible', 'bloqueado'];
    const verificaciones: EstadoVerificacionOtp[] = ['regenerado', 'incorrecto', 'vencido', 'bloqueado', 'no_disponible'];
    const textos = [...solicitudes.map((e) => mensajeSolicitudOtp(e).texto), ...verificaciones.map((e) => mensajeVerificacionOtp(e).texto)];
    for (const t of textos) {
      expect(t).not.toMatch(/@/);
      expect(t).not.toMatch(/\d{6}(?!\s*dígitos)/);
    }
  });
});
