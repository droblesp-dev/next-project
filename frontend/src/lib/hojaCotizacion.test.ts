import { describe, expect, it } from 'vitest';
import { construirHojaCotizacion, nombreArchivoHoja, type DatosHojaCotizacion } from './hojaCotizacion';

const AHORA = new Date('2026-10-29T15:00:00.000Z');

const BASE: DatosHojaCotizacion = {
  codigoCotizacion: 'COT-004873',
  codigoSolicitud: 'SOL-005890',
  estado: 'ENVIADA',
  estadoEtiqueta: 'Pendiente de tu respuesta',
  emitidaEn: '2026-10-29T13:00:00.000Z',
  vigenciaHasta: '2026-11-13T23:24:00.000Z',
  servicio: 'Torneado industrial',
  cantidad: 10,
  descripcionSolicitud: 'Piezas en acero 1045',
  especificaciones: 'Tolerancia ±0,05 mm',
  observaciones: 'Torneado de 10 piezas',
  subtotal: '300.00',
  ivaPorcentaje: '15.00',
  ivaValor: '45.00',
  total: '345.00',
  anticipoPorcentaje: '0',
  anticipoValor: '0',
  estadoAnticipo: 'NO_APLICA',
  metodoAnticipo: null,
  saldo: '345.00',
};

describe('hoja imprimible de la cotización (#4)', () => {
  it('usa los importes oficiales del backend con formato es-EC, sin recalcularlos', () => {
    const h = construirHojaCotizacion(BASE, AHORA);
    expect(h.totales).toEqual([
      { etiqueta: 'Subtotal (sin IVA)', valor: '$300,00' },
      { etiqueta: 'IVA (15 %)', valor: '$45,00' },
      { etiqueta: 'Total (con IVA)', valor: '$345,00', destacado: true },
      { etiqueta: 'Saldo', valor: '$345,00' },
    ]);
    expect(h.filas).toEqual([{ concepto: 'Torneado industrial', detalle: 'Piezas en acero 1045 — Tolerancia ±0,05 mm', cantidad: '10', precioUnitario: '—', subtotal: '$300,00' }]);
  });

  it('con líneas de detalle imprime una fila por línea con descripción, cantidad, precio unitario y subtotal guardados (#4)', () => {
    const h = construirHojaCotizacion(
      { ...BASE, lineas: [
        { descripcion: 'Torneado', cantidad: '10.000', precio_unitario: '12.50', subtotal: '125.00' },
        { descripcion: 'Acabado', cantidad: '2.500', precio_unitario: '10.00', subtotal: '25.00' },
      ] },
      AHORA
    );
    expect(h.filas.map((f) => [f.concepto, f.cantidad, f.precioUnitario, f.subtotal])).toEqual([
      ['Torneado', '10', '$12,50', '$125,00'],
      ['Acabado', '2,5', '$10,00', '$25,00'],
    ]);
    // sin líneas se conserva la fila única histórica
    expect(construirHojaCotizacion({ ...BASE, lineas: [] }, AHORA).filas).toHaveLength(1);
  });

  it('incluye los números de cotización y solicitud, el estado y la observación', () => {
    const h = construirHojaCotizacion(BASE, AHORA);
    expect(h.referencias.map((r) => r.valor)).toEqual(expect.arrayContaining(['COT-004873', 'SOL-005890', 'Pendiente de tu respuesta']));
    expect(h.observaciones).toBe('Torneado de 10 piezas');
    expect(h.nombreArchivo).toBe('Cotizacion-COT-004873');
  });

  it('con anticipo agrega su línea y el método; sin anticipo indica que no se requiere', () => {
    const con = construirHojaCotizacion({ ...BASE, estadoAnticipo: 'PENDIENTE', anticipoPorcentaje: '50', anticipoValor: '172.50', metodoAnticipo: 'TRANSFERENCIA', saldo: '172.50' }, AHORA);
    expect(con.totales.map((t) => t.etiqueta)).toEqual(['Subtotal (sin IVA)', 'IVA (15 %)', 'Total (con IVA)', 'Anticipo (50 %)', 'Saldo']);
    expect(con.condiciones[0]).toBe('Método del anticipo: Transferencia bancaria.');
    expect(construirHojaCotizacion(BASE, AHORA).condiciones[0]).toBe('No se requiere anticipo.');
  });

  it('la vigencia depende del estado: vigente hasta, caducó, o ninguna en estados cerrados', () => {
    expect(construirHojaCotizacion(BASE, AHORA).condiciones.join(' ')).toMatch(/vigente hasta el 13\/11\/2026/);
    const vencida = construirHojaCotizacion({ ...BASE, estado: 'VENCIDA', estadoEtiqueta: 'Vencida' }, AHORA);
    expect(vencida.condiciones.join(' ')).toContain('caducó');
    expect(vencida.condiciones.join(' ')).not.toMatch(/vigente hasta/);
    const aceptada = construirHojaCotizacion({ ...BASE, estado: 'ACEPTADA', estadoEtiqueta: 'Aceptada' }, AHORA);
    expect(aceptada.condiciones.join(' ')).not.toMatch(/vigente hasta|caducó/);
  });

  it('el cliente solo aparece cuando la pantalla interna lo entrega', () => {
    expect(construirHojaCotizacion(BASE, AHORA).referencias.some((r) => r.etiqueta === 'Cliente')).toBe(false);
    const interna = construirHojaCotizacion({ ...BASE, cliente: 'Acme S.A.' }, AHORA);
    expect(interna.referencias.find((r) => r.etiqueta === 'Cliente')?.valor).toBe('Acme S.A.');
  });

  it('nunca incluye datos de acceso, enlaces, datos bancarios ni teléfonos', () => {
    const h = JSON.stringify(construirHojaCotizacion(BASE, AHORA));
    expect(h).not.toMatch(/c[oó]digo de acceso|token|https?:|wa\.me|whatsapp|\+593|cuenta|iban|ruc/i);
  });

  it('con datos incompletos muestra «—» y nunca un importe inventado', () => {
    const h = construirHojaCotizacion({ ...BASE, subtotal: null, ivaValor: null, total: null, saldo: null, cantidad: null }, AHORA);
    expect(h.totales.map((t) => t.valor)).toEqual(['—', '—', '—', '—']);
    expect(h.filas[0].cantidad).toBe('—');
  });

  it('el nombre del archivo del PDF es seguro', () => {
    expect(nombreArchivoHoja(null)).toBe('Cotizacion-sin-numero');
    expect(nombreArchivoHoja('COT/00 4873')).toBe('Cotizacion-COT-00-4873');
  });
});
