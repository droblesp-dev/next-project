import { describe, expect, it } from 'vitest';
import { etiquetaRol, obtenerIniciales, ocultarCorreo } from './perfilUsuario';

describe('obtenerIniciales', () => {
  it('toma la primera letra de las dos primeras palabras, en mayúsculas', () => {
    expect(obtenerIniciales('Sergio Rogelio Floreán')).toBe('SR');
    expect(obtenerIniciales('ana maría')).toBe('AM');
  });

  it('con una sola palabra usa solo su primera letra', () => {
    expect(obtenerIniciales('Administrador')).toBe('A');
  });

  it('ignora espacios sobrantes y respeta letras con tilde', () => {
    expect(obtenerIniciales('   Ñandú   Álvarez  ')).toBe('ÑÁ');
  });

  it('devuelve «?» si el nombre está vacío', () => {
    expect(obtenerIniciales('')).toBe('?');
    expect(obtenerIniciales('   ')).toBe('?');
  });
});

describe('etiquetaRol', () => {
  it('muestra OPERATIVO como «Operario» y los demás roles con su nombre', () => {
    expect(etiquetaRol('OPERATIVO')).toBe('Operario');
    expect(etiquetaRol('ADMIN')).toBe('Admin');
    expect(etiquetaRol('COMERCIAL')).toBe('Comercial');
  });

  it('no inventa etiquetas: un rol desconocido se muestra tal cual', () => {
    expect(etiquetaRol('OTRO')).toBe('OTRO');
  });
});

describe('ocultarCorreo', () => {
  it('deja visibles solo la primera y la última letra de la parte local', () => {
    expect(ocultarCorreo('sergio@nextproject.ec')).toBe('s***o@nextproject.ec');
  });

  it('con una parte local muy corta oculta el resto sin dejarla completa', () => {
    expect(ocultarCorreo('ab@x.ec')).toBe('a***@x.ec');
    expect(ocultarCorreo('a@x.ec')).toBe('a***@x.ec');
  });

  it('no altera un texto que no es un correo', () => {
    expect(ocultarCorreo('sin-arroba')).toBe('sin-arroba');
  });
});
