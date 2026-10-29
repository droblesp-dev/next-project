import { describe, expect, it } from 'vitest';
import { coincideBusqueda, coincideCodigo, coincideTexto, compactarCodigo, normalizarTexto } from './busqueda';

describe('normalizarTexto / compactarCodigo', () => {
  it('ignora mayúsculas y tildes', () => {
    expect(normalizarTexto('Cotización ÁÉÍÓÚ')).toBe('cotizacion aeiou');
  });

  it('deja solo letras y dígitos en los números', () => {
    expect(compactarCodigo('SOL-000491')).toBe('sol000491');
    expect(compactarCodigo(' sol 000-491 ')).toBe('sol000491');
  });
});

describe('coincideCodigo: número de solicitud o cotización', () => {
  it('encuentra el número completo, sin guion, en minúsculas o con espacios', () => {
    for (const termino of ['SOL-000491', 'sol-000491', 'sol000491', 'SOL 000491', 'sol 000-491']) {
      expect(coincideCodigo(termino, 'SOL-000491')).toBe(true);
    }
  });

  it('encuentra por prefijo, por la parte numérica y por un fragmento', () => {
    expect(coincideCodigo('SOL', 'SOL-000491')).toBe(true);
    expect(coincideCodigo('000491', 'SOL-000491')).toBe(true);
    expect(coincideCodigo('491', 'SOL-000491')).toBe(true);
    expect(coincideCodigo('COT-000001', 'COT-000001')).toBe(true);
  });

  it('prefijo + número sin ceros encuentra el número completo (cot-3, sol 493, ord327)', () => {
    expect(coincideCodigo('COT-3', 'COT-000003')).toBe(true);
    expect(coincideCodigo('sol 493', 'SOL-000493')).toBe(true);
    expect(coincideCodigo('ord327', 'ORD-000327')).toBe(true);
    expect(coincideCodigo('cot-3', 'COT-000013')).toBe(false);
    expect(coincideCodigo('cot-3', 'SOL-000003')).toBe(false);
  });

  it('no mezcla solicitudes con cotizaciones ni encuentra números distintos', () => {
    expect(coincideCodigo('COT-000001', 'SOL-000491')).toBe(false);
    expect(coincideCodigo('SOL-000492', 'SOL-000491')).toBe(false);
  });

  it('un código ausente o un término sin letras ni dígitos no coincide', () => {
    expect(coincideCodigo('SOL-1', null)).toBe(false);
    expect(coincideCodigo('SOL-1', undefined)).toBe(false);
    expect(coincideCodigo('-', 'SOL-000491')).toBe(false);
    expect(coincideCodigo('   ', 'SOL-000491')).toBe(false);
  });
});

describe('coincideTexto / coincideBusqueda', () => {
  it('busca texto libre sin distinguir mayúsculas ni tildes', () => {
    expect(coincideTexto('torneado', 'Servicio de TORNEADO industrial')).toBe(true);
    expect(coincideTexto('reparacion', 'REPARACIÓN Y RECUPERACIÓN')).toBe(true);
    expect(coincideTexto('fresado', null)).toBe(false);
  });

  it('coincide por texto o por número legible', () => {
    const textos = ['Cliente Prueba F02', 'Torneado'];
    const codigos = ['SOL-000491', 'COT-000001', null];
    expect(coincideBusqueda('prueba', textos, codigos)).toBe(true);
    expect(coincideBusqueda('sol-000491', textos, codigos)).toBe(true);
    expect(coincideBusqueda('cot000001', textos, codigos)).toBe(true);
    expect(coincideBusqueda('inexistente', textos, codigos)).toBe(false);
    expect(coincideBusqueda('torno', ['Torno'])).toBe(true);
  });
});
