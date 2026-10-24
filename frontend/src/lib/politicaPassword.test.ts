import { describe, expect, it } from 'vitest';
import {
  evaluarPassword,
  MENSAJES_PROBLEMA,
  LONGITUD_MINIMA_PASSWORD,
  MAX_BYTES_PASSWORD,
  type NivelPassword,
  type ProblemaPassword,
} from './politicaPassword';

// Misma tabla de casos que backend/src/services/politicaPassword.test.ts: ambos paquetes duplican la
// política y deben clasificar IGUAL.
const CASOS: Array<[string, NivelPassword, ProblemaPassword | null]> = [
  ['', 'DEBIL', 'LONGITUD_MIN'],
  ['Cor1', 'DEBIL', 'LONGITUD_MIN'],
  ['Corta1!', 'MEDIA', 'LONGITUD_MIN'],
  ['Zx9!Qm2', 'MEDIA', 'LONGITUD_MIN'],
  ['Corta12!x', 'MEDIA', 'LONGITUD_MIN'],
  ['Zx9!Qm2#Lp7', 'MEDIA', 'LONGITUD_MIN'],
  ['aaaaaaaaaaaa', 'DEBIL', 'REPETIDA'],
  ['abcabcabcabc', 'DEBIL', 'REPETIDA'],
  ['123456789012', 'DEBIL', 'SECUENCIA'],
  ['abcdefghijkl', 'DEBIL', 'SECUENCIA'],
  ['Password12345', 'DEBIL', 'COMUN'],
  ['Mecanizado2026!', 'DEBIL', 'COMUN'],
  ['qwertyuiop12', 'DEBIL', 'COMUN'],
  ['Contraseña-2026-x', 'DEBIL', 'COMUN'],
  ['holaholahola1', 'MEDIA', 'POCA_VARIEDAD'],
  ['Zx9!Qm2#Lp7@', 'FUERTE', null],
  ['Tornillo-Acero-77', 'FUERTE', null],
  ['correcta caballo pila grapa', 'FUERTE', null],
];

describe('evaluarPassword — clasificación', () => {
  for (const [password, nivel, problema] of CASOS) {
    it(`«${password}» es ${nivel}${problema ? ` (${problema})` : ''}`, () => {
      const r = evaluarPassword(password);
      expect(r.nivel).toBe(nivel);
      if (problema) expect(r.problemas).toContain(problema);
      else expect(r.problemas).toEqual([]);
    });
  }

  it('de 5 a 11 caracteres limpios es MEDIA (amarillo) pero NO aceptable: el mínimo para aceptar sigue siendo 12', () => {
    for (const password of ['Corta', 'Corta1!', 'Corta12!x', 'Zx9!Qm2#Lp7']) {
      const r = evaluarPassword(password);
      expect(r.nivel).toBe('MEDIA');
      expect(r.problemas).toContain('LONGITUD_MIN');
    }
    // hasta 4 caracteres es DEBIL (rojo)
    expect(evaluarPassword('Zx9!').nivel).toBe('DEBIL');
    expect(evaluarPassword('a').nivel).toBe('DEBIL');
  });

  it('solo FUERTE es aceptable: DEBIL y MEDIA se rechazan', () => {
    expect(evaluarPassword('holaholahola1').nivel).not.toBe('FUERTE');
    expect(evaluarPassword('Zx9!Qm2#Lp7@').nivel).toBe('FUERTE');
  });
});

describe('evaluarPassword — límites y datos del usuario', () => {
  it('exige el mínimo de 12 caracteres', () => {
    expect(LONGITUD_MINIMA_PASSWORD).toBe(12);
    expect(evaluarPassword('Zx9!Qm2#Lp7').problemas).toContain('LONGITUD_MIN');
    expect(evaluarPassword('Zx9!Qm2#Lp7@').problemas).not.toContain('LONGITUD_MIN');
  });

  it('rechaza más de 72 bytes (límite real de bcrypt), contando bytes y no caracteres', () => {
    expect(MAX_BYTES_PASSWORD).toBe(72);
    const r = evaluarPassword('Ñ'.repeat(37));
    expect(r.longitud).toBe(37);
    expect(r.bytes).toBe(74);
    expect(r.problemas).toContain('MAX_BYTES');
    expect(evaluarPassword('a'.repeat(73)).problemas).toContain('MAX_BYTES');
  });

  it('permite frases largas con espacios', () => {
    expect(evaluarPassword('mi perro come pan tostado cada mañana').nivel).toBe('FUERTE');
  });

  it('rechaza contraseñas que contienen el nombre o parte del correo del usuario', () => {
    const contexto = { nombre: 'Sergio Rogelio Floreán', email: 'sergio.floreano@nextproject.ec' };
    expect(evaluarPassword('Zq#SergioRogelio-2026', contexto).problemas).toContain('CONTIENE_DATOS');
    expect(evaluarPassword('xx-sergiofloreano-xx!', contexto).problemas).toContain('CONTIENE_DATOS');
    expect(evaluarPassword('Zx9!Qm2#Lp7@', contexto).nivel).toBe('FUERTE');
  });

  it('la misma contraseña sin contexto no se marca por datos personales', () => {
    expect(evaluarPassword('Zq#SergioRogelio-2026').problemas).not.toContain('CONTIENE_DATOS');
  });
});

describe('Límite de longitud máxima: mensajes claros y criterio técnico intacto', () => {
  // Frase larga sin repeticiones: se corta a 72 y a 73 caracteres (todos ASCII = 1 byte cada uno)
  const larga = 'Tornillo-Acero-Cobre-Laton-Bronce-Hierro-Plomo-Zinc-Niquel-Estano-2026-Sol-Mar-Rio';

  it('el límite técnico sigue siendo exactamente 72 bytes: 72 se acepta y 73 se rechaza', () => {
    expect(evaluarPassword(larga.slice(0, 72)).bytes).toBe(72);
    expect(evaluarPassword(larga.slice(0, 72)).problemas).not.toContain('MAX_BYTES');
    expect(evaluarPassword(larga.slice(0, 73)).bytes).toBe(73);
    expect(evaluarPassword(larga.slice(0, 73)).problemas).toContain('MAX_BYTES');
    expect(evaluarPassword(larga.slice(0, 73)).nivel).toBe('DEBIL');
  });

  it('el mensaje para el usuario es claro y no usa términos técnicos', () => {
    expect(MENSAJES_PROBLEMA.MAX_BYTES).toBe('La contraseña es demasiado larga. Acórtala un poco');
    for (const mensaje of Object.values(MENSAJES_PROBLEMA)) {
      expect(mensaje).not.toMatch(/bytes?/i);
    }
  });
});
