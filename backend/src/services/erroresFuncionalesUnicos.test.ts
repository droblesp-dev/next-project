import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Una clase de error funcional definida en dos módulos es un defecto silencioso: `instanceof` solo
// reconoce una de ellas y la otra termina como HTTP 500 (F2: MetodoSaldoRequeridoError,
// MetodoSaldoInvalidoError y ComprobanteSaldoRequeridoError estaban duplicadas entre
// cotizaciones.service y transferenciasPago.service). cotizaciones.controller traduce a HTTP los
// errores de ESTOS DOS servicios, así que ninguna clase puede definirse en ambos. Prueba estática de
// solo lectura. (Otros pares de servicios también repiten nombres, pero cada uno responde ante su
// propio controlador; no forman parte de este flujo y esta prueba no los cubre.)

const SERVICIOS = ['cotizaciones.service.ts', 'transferenciasPago.service.ts'];

function clasesDeError(archivo: string): Set<string> {
  const texto = readFileSync(path.resolve(__dirname, archivo), 'utf8');
  return new Set([...texto.matchAll(/export\s+class\s+(\w+Error)\b/g)].map((coincidencia) => coincidencia[1]));
}

describe('clases de error del flujo de pagos', () => {
  it('ninguna clase *Error se define a la vez en cotizaciones.service y en transferenciasPago.service', () => {
    const [cotizaciones, transferencias] = SERVICIOS.map(clasesDeError);
    const repetidas = [...transferencias].filter((nombre) => cotizaciones.has(nombre));
    expect(repetidas).toEqual([]);
  });

  it('transferenciasPago.service sigue exponiendo las clases compartidas (re-exportadas, no definidas)', () => {
    const texto = readFileSync(path.resolve(__dirname, 'transferenciasPago.service.ts'), 'utf8');
    for (const nombre of [
      'MetodoSaldoRequeridoError',
      'MetodoSaldoInvalidoError',
      'ComprobanteSaldoRequeridoError',
      'SaldoRequiereAnticipoValidadoError',
    ]) {
      expect(texto).not.toMatch(new RegExp(`export\\s+class\\s+${nombre}\\b`));
      expect(texto).toMatch(new RegExp(`\\b${nombre}\\b`));
    }
  });
});
