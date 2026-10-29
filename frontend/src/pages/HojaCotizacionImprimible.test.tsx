import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HojaCotizacionImprimible } from './HojaCotizacionImprimible';
import { construirHojaCotizacion } from '../lib/hojaCotizacion';

const hoja = construirHojaCotizacion(
  {
    codigoCotizacion: 'COT-000010',
    codigoSolicitud: 'SOL-000020',
    estado: 'ENVIADA',
    estadoEtiqueta: 'Pendiente de tu respuesta',
    emitidaEn: '2026-10-29T13:00:00.000Z',
    vigenciaHasta: '2026-11-13T23:24:00.000Z',
    servicio: 'Fresado CNC',
    cantidad: 4,
    descripcionSolicitud: 'Placas de aluminio',
    especificaciones: null,
    observaciones: 'Entrega en 10 días',
    subtotal: '1000.00',
    ivaPorcentaje: '15.00',
    ivaValor: '150.00',
    total: '1150.00',
    anticipoPorcentaje: '50',
    anticipoValor: '575.00',
    estadoAnticipo: 'PENDIENTE',
    metodoAnticipo: 'EFECTIVO',
    saldo: '575.00',
  },
  new Date('2026-10-29T15:00:00.000Z')
);

describe('HojaCotizacionImprimible (#4)', () => {
  it('muestra la empresa, las referencias, la tabla de conceptos y los totales', () => {
    const h = renderToStaticMarkup(<HojaCotizacionImprimible hoja={hoja} />);
    expect(h).toContain('NEXTPROJECT');
    expect(h).toContain('COT-000010');
    expect(h).toContain('SOL-000020');
    expect(h).toContain('Fresado CNC');
    expect(h).toContain('Placas de aluminio');
    expect(h).toContain('$1.000,00');
    expect(h).toContain('$1.150,00');
    expect(h).toContain('Anticipo (50 %)');
    expect(h).toContain('Entrega en 10 días');
    expect(h).toContain('Método del anticipo: Efectivo (presencial).');
  });

  it('usa fondo blanco y texto oscuro para imprimir y no incluye acciones ni enlaces', () => {
    const h = renderToStaticMarkup(<HojaCotizacionImprimible hoja={hoja} />);
    expect(h).toContain('bg-white');
    expect(h).toContain('text-black');
    expect(h).not.toContain('<button');
    expect(h).not.toContain('href=');
  });
});
