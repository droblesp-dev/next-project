import { describe, expect, it } from 'vitest';
import {
  DESTINO_ACENTOS,
  LONGITUD_MAXIMA_TERMINO,
  normalizarTermino,
  ORIGEN_ACENTOS,
  patronCodigo,
  patronParcial,
  terminoValido,
} from './busquedaPatron.js';

describe('normalizarTermino', () => {
  it('pasa a minúsculas, quita tildes y recorta espacios', () => {
    expect(normalizarTermino('  REPARACIÓN Cotización  ')).toBe('reparacion cotizacion');
    expect(normalizarTermino('Ñandú')).toBe('nandu');
  });

  it('trata el guion bajo como espacio (EN_REVISION se lee «en revision»)', () => {
    expect(normalizarTermino('EN_REVISION')).toBe('en revision');
  });

  it('la tabla de tildes del SQL tiene el mismo largo en origen y destino', () => {
    expect([...ORIGEN_ACENTOS]).toHaveLength([...DESTINO_ACENTOS].length);
  });
});

describe('patronParcial: texto libre (LIKE)', () => {
  it('envuelve el término para buscarlo en cualquier parte del texto', () => {
    expect(patronParcial('1')).toBe('%1%');
    expect(patronParcial('Torneado')).toBe('%torneado%');
    expect(patronParcial('sol-000491')).toBe('%sol-000491%');
  });

  it('escapa los comodines de LIKE para buscarlos literalmente', () => {
    expect(patronParcial('100%')).toBe('%100\\%%');
    expect(patronParcial('a_b')).toBe('%a b%'); // «_» es espacio, no comodín
    expect(patronParcial('a\\b')).toBe('%a\\\\b%');
  });
});

describe('patronCodigo: números legibles', () => {
  it('compacta el término a letras y dígitos', () => {
    expect(patronCodigo('SOL-000491')).toBe('%sol000491%');
    expect(patronCodigo('sol 000 491')).toBe('%sol000491%');
    expect(patronCodigo('1')).toBe('%1%');
    expect(patronCodigo('Cotización 7')).toBe('%cotizacion7%');
  });

  it('un término sin letras ni dígitos no se compara contra números', () => {
    expect(patronCodigo('-')).toBeNull();
    expect(patronCodigo('  % _ ')).toBeNull();
  });
});

describe('terminoValido', () => {
  it('acepta texto de 1 a 100 caracteres y lo recorta', () => {
    expect(terminoValido('  1 ')).toBe('1');
    expect(terminoValido('a'.repeat(LONGITUD_MAXIMA_TERMINO))).toHaveLength(LONGITUD_MAXIMA_TERMINO);
  });

  it('rechaza vacío, solo espacios, demasiado largo y tipos no texto', () => {
    expect(terminoValido('')).toBeNull();
    expect(terminoValido('   ')).toBeNull();
    expect(terminoValido('a'.repeat(LONGITUD_MAXIMA_TERMINO + 1))).toBeNull();
    for (const v of [undefined, null, 5, ['a'], { a: 1 }]) expect(terminoValido(v)).toBeNull();
  });
});
