import { describe, expect, it } from 'vitest';
import {
  COMPROBANTE_MAX_BYTES,
  esImagen,
  etiquetaEstadoCotizacion,
  etiquetaEstadoPago,
  etiquetaMetodoPago,
  formatearFechaHora,
  formatearMoneda,
  formatearPorcentaje,
  formatearTamano,
  mensajeSiguientePaso,
  textoMotivoRechazo,
  usarSelectorDeCuentas,
  validarArchivoComprobante,
  type EstadoCotizacionParaMensaje,
} from './cotizacionPublica';

describe('formatearMoneda (es-EC)', () => {
  it('agrupa los miles con punto y usa coma decimal, también en 4 cifras', () => {
    expect(formatearMoneda('1234.5')).toBe('$1.234,50');
    expect(formatearMoneda('1419.68')).toBe('$1.419,68');
    expect(formatearMoneda(1234567.891)).toBe('$1.234.567,89');
    expect(formatearMoneda('0')).toBe('$0,00');
    expect(formatearMoneda('999.999')).toBe('$1.000,00');
  });

  it('un valor ausente o no numérico no inventa un importe', () => {
    for (const v of [null, undefined, '', 'abc', NaN]) expect(formatearMoneda(v as never)).toBe('—');
  });
});

describe('formatearPorcentaje / formatearFechaHora', () => {
  it('formatea porcentajes enteros y con decimales', () => {
    expect(formatearPorcentaje('15.00')).toBe('15 %');
    expect(formatearPorcentaje('12.5')).toBe('12,50 %');
    expect(formatearPorcentaje(null)).toBe('—');
  });

  it('muestra la fecha en hora de Ecuador (UTC-5) y tolera valores inválidos', () => {
    expect(formatearFechaHora('2026-10-24T01:30:00Z')).toMatch(/23\/10\/2026.*20:30/);
    expect(formatearFechaHora(null)).toBe('—');
    expect(formatearFechaHora('no es fecha')).toBe('—');
  });
});

describe('etiquetas comprensibles', () => {
  it('no muestra los estados técnicos al cliente', () => {
    expect(etiquetaEstadoCotizacion('ENVIADA')).toBe('Pendiente de tu respuesta');
    expect(etiquetaEstadoPago('VALIDADO')).toBe('Pago confirmado');
    expect(etiquetaEstadoPago('RECHAZADO')).toBe('Comprobante rechazado');
    expect(etiquetaEstadoPago(null)).toBe('—');
    expect(etiquetaMetodoPago('TRANSFERENCIA')).toBe('Transferencia bancaria');
    expect(etiquetaMetodoPago(null)).toBe('Por definir');
  });

  it('traduce el motivo de rechazo y usa el detalle solo para OTRO', () => {
    expect(textoMotivoRechazo('IMPORTE_INCORRECTO', 'ignorado')).toBe('El importe del comprobante no coincide con el valor a pagar.');
    expect(textoMotivoRechazo('OTRO', ' Falta la firma ')).toBe('Falta la firma');
    expect(textoMotivoRechazo('OTRO', null)).toContain('Contacta a tu asesor');
    expect(textoMotivoRechazo(null, null)).toBe('El comprobante no pudo ser aceptado.');
  });
});

describe('mensajeSiguientePaso', () => {
  const base: EstadoCotizacionParaMensaje = {
    estado: 'ACEPTADA',
    estado_anticipo: 'PENDIENTE',
    metodo_anticipo: 'TRANSFERENCIA',
    comprobante_recibido: false,
    estado_saldo: 'PENDIENTE',
    saldo_comprobante_recibido: false,
    saldo_habilitado: false,
  };

  it('describe cada estado actual de la cotización', () => {
    expect(mensajeSiguientePaso({ ...base, estado: 'ENVIADA' })).toContain('acepta o rechaza');
    expect(mensajeSiguientePaso({ ...base, estado: 'RECHAZADA' })).toContain('Rechazaste');
    expect(mensajeSiguientePaso({ ...base, estado: 'VENCIDA' })).toContain('venció');
  });

  it('anticipo: subir, en revisión (sin afirmar acreditación), rechazado, efectivo, confirmado', () => {
    expect(mensajeSiguientePaso(base)).toContain('sube tu comprobante');
    expect(mensajeSiguientePaso({ ...base, comprobante_recibido: true })).toMatch(/en revisión; aún no se ha acreditado/);
    expect(mensajeSiguientePaso({ ...base, estado_anticipo: 'RECHAZADO' })).toContain('Corrige el comprobante del anticipo');
    expect(mensajeSiguientePaso({ ...base, metodo_anticipo: 'EFECTIVO' })).toContain('presencial');
    expect(mensajeSiguientePaso({ ...base, estado_anticipo: 'VALIDADO', saldo_habilitado: true })).toContain('pago del saldo');
  });

  it('sin anticipo el siguiente paso es el saldo; el estado del saldo manda sobre el del anticipo', () => {
    expect(mensajeSiguientePaso({ ...base, estado_anticipo: 'NO_APLICA' })).toContain('pago del saldo');
    expect(mensajeSiguientePaso({ ...base, estado_anticipo: 'VALIDADO', saldo_comprobante_recibido: true })).toContain('comprobante del saldo');
    expect(mensajeSiguientePaso({ ...base, estado_anticipo: 'VALIDADO', estado_saldo: 'RECHAZADO' })).toContain('Corrige el comprobante del saldo');
    expect(mensajeSiguientePaso({ ...base, estado_anticipo: 'VALIDADO', estado_saldo: 'VALIDADO' })).toContain('Todos los pagos están confirmados');
  });
});

describe('validarArchivoComprobante', () => {
  it('acepta PDF, JPG y PNG dentro del límite', () => {
    for (const type of ['application/pdf', 'image/jpeg', 'image/png']) {
      expect(validarArchivoComprobante({ type, size: 1000 })).toBeNull();
    }
    expect(validarArchivoComprobante({ type: 'image/png', size: COMPROBANTE_MAX_BYTES })).toBeNull();
  });

  it('rechaza formatos no permitidos, tamaños excesivos y archivos vacíos', () => {
    expect(validarArchivoComprobante({ type: 'image/gif', size: 10 })).toContain('Formato no permitido');
    expect(validarArchivoComprobante({ type: 'image/png', size: COMPROBANTE_MAX_BYTES + 1 })).toContain('5 MB');
    expect(validarArchivoComprobante({ type: 'image/png', size: 0 })).toContain('vacío');
  });

  it('formatea tamaños y distingue imágenes de PDF', () => {
    expect(formatearTamano(2048)).toBe('2 KB');
    expect(formatearTamano(1.5 * 1024 * 1024)).toBe('1,5 MB');
    expect(esImagen('image/png')).toBe(true);
    expect(esImagen('application/pdf')).toBe(false);
  });
});

describe('selector de cuentas receptoras', () => {
  it('con más de 5 cuentas se usa un desplegable en vez de tarjetas', () => {
    expect(usarSelectorDeCuentas(5)).toBe(false);
    expect(usarSelectorDeCuentas(6)).toBe(true);
    expect(usarSelectorDeCuentas(197)).toBe(true);
  });
});
