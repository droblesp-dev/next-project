import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { evaluarPassword, type NivelPassword } from '../lib/politicaPassword';
import IndicadorFortalezaPassword, {
  PRESENTACION_NIVEL_PASSWORD,
  TEXTO_SIN_PASSWORD,
} from './IndicadorFortalezaPassword';

const NIVELES: NivelPassword[] = ['DEBIL', 'MEDIA', 'FUERTE'];

function html(nivel: NivelPassword | null): string {
  return renderToStaticMarkup(createElement(IndicadorFortalezaPassword, { nivel }));
}

// Lo que el usuario ve al escribir: la nueva contraseña evaluada y pasada al indicador.
function indicadorPara(password: string): { nivel: NivelPassword | null; html: string } {
  const nivel = password.length > 0 ? evaluarPassword(password).nivel : null;
  return { nivel, html: html(nivel) };
}

describe('Indicador de fortaleza: texto, color y estado salen del mismo nivel', () => {
  it('muestra los textos pedidos', () => {
    expect(PRESENTACION_NIVEL_PASSWORD.DEBIL.texto).toBe('CONTRASEÑA DÉBIL');
    expect(PRESENTACION_NIVEL_PASSWORD.MEDIA.texto).toBe('CONTRASEÑA MEDIA — NECESITA MEJORAR');
    expect(PRESENTACION_NIVEL_PASSWORD.FUERTE.texto).toBe('CONTRASEÑA FUERTE');
  });

  it('DÉBIL: texto «CONTRASEÑA DÉBIL», color rojo', () => {
    const h = html('DEBIL');
    expect(h).toContain('CONTRASEÑA DÉBIL');
    expect(h).toContain('text-error');
    expect(h).toContain('bg-error');
    expect(h).toContain('data-nivel="DEBIL"');
  });

  it('MEDIA: texto «CONTRASEÑA MEDIA — NECESITA MEJORAR», color amarillo', () => {
    const h = html('MEDIA');
    expect(h).toContain('CONTRASEÑA MEDIA — NECESITA MEJORAR');
    expect(h).toContain('text-primary-container');
    expect(h).toContain('bg-primary-container');
    expect(h).toContain('data-nivel="MEDIA"');
  });

  it('FUERTE: texto «CONTRASEÑA FUERTE», color verde', () => {
    const h = html('FUERTE');
    expect(h).toContain('CONTRASEÑA FUERTE');
    expect(h).toContain('text-[#22c55e]');
    expect(h).toContain('bg-[#22c55e]');
    expect(h).toContain('data-nivel="FUERTE"');
  });

  it('cada nivel muestra SOLO su propio texto, color y ancho (nunca mezclados con otro)', () => {
    for (const nivel of NIVELES) {
      const h = html(nivel);
      const propio = PRESENTACION_NIVEL_PASSWORD[nivel];
      // la barra lleva el color y el ancho del propio nivel, juntos
      expect(h).toContain(`${propio.barra} ${propio.ancho}`);
      for (const otro of NIVELES.filter((n) => n !== nivel)) {
        const p = PRESENTACION_NIVEL_PASSWORD[otro];
        expect(h).not.toContain(p.texto);
        expect(h).not.toContain(p.barra);
        expect(h).not.toContain(p.colorTexto);
        expect(h).not.toContain(`${p.barra} ${p.ancho}`);
      }
    }
  });

  it('con el campo vacío no hay barra de color y se pide escribir una contraseña', () => {
    const h = html(null);
    expect(h).toContain(TEXTO_SIN_PASSWORD);
    expect(h).toContain('data-nivel="VACIO"');
    for (const nivel of NIVELES) expect(h).not.toContain(PRESENTACION_NIVEL_PASSWORD[nivel].barra);
  });
});

describe('Al escribir, el indicador cambia en tiempo real entre débil, media y fuerte', () => {
  it('«Tornillo-Acero-77» pasa por rojo, amarillo y verde mientras se escribe, en ese orden', () => {
    const escrito = 'Tornillo-Acero-77';
    const vistos: Array<{ longitud: number; nivel: NivelPassword | null }> = [];

    for (let n = 1; n <= escrito.length; n++) {
      const { nivel, html: h } = indicadorPara(escrito.slice(0, n));
      // el texto mostrado es exactamente el del nivel calculado en ese momento
      expect(h).toContain(PRESENTACION_NIVEL_PASSWORD[nivel as NivelPassword].texto);
      vistos.push({ longitud: n, nivel });
    }

    // de 1 a 4 caracteres: DÉBIL (rojo)
    for (const v of vistos.filter((x) => x.longitud <= 4)) expect(v.nivel).toBe('DEBIL');
    // de 5 a 11 caracteres: MEDIA (amarillo), todavía no aceptable
    for (const v of vistos.filter((x) => x.longitud >= 5 && x.longitud <= 11)) expect(v.nivel).toBe('MEDIA');
    expect(html('MEDIA')).toContain('CONTRASEÑA MEDIA — NECESITA MEJORAR');
    expect(html('MEDIA')).toContain('bg-primary-container');
    // a partir de 12 caracteres: FUERTE (verde)
    for (const v of vistos.filter((x) => x.longitud >= 12)) expect(v.nivel).toBe('FUERTE');

    // los tres estados aparecieron, en ese orden, sin saltar directamente de rojo a verde
    const orden = vistos.map((v) => v.nivel).filter((n, i, arr) => i === 0 || n !== arr[i - 1]);
    expect(orden).toEqual(['DEBIL', 'MEDIA', 'FUERTE']);
  });

  it('«Zx9!Qm2#Lp7@»: DÉBIL hasta 4 caracteres, MEDIA de 5 a 11 y FUERTE al completar los 12', () => {
    const escrito = 'Zx9!Qm2#Lp7@';
    const niveles = Array.from({ length: escrito.length }, (_, i) => indicadorPara(escrito.slice(0, i + 1)).nivel);
    expect(niveles.slice(0, 4)).toEqual(Array(4).fill('DEBIL'));
    expect(niveles.slice(4, 11)).toEqual(Array(7).fill('MEDIA'));
    expect(niveles[11]).toBe('FUERTE');
    const completo = indicadorPara(escrito);
    expect(completo.html).toContain('CONTRASEÑA FUERTE');
    expect(completo.html).toContain('bg-[#22c55e]');
  });

  it('«holaholahola1-Tornillo» (poca variedad) recorre MEDIA y termina FUERTE al pasar de 16 caracteres', () => {
    const escrito = 'holaholahola1-Tornillo';
    expect(indicadorPara(escrito.slice(0, 13)).nivel).toBe('MEDIA');
    expect(indicadorPara(escrito.slice(0, 15)).nivel).toBe('MEDIA');
    expect(indicadorPara(escrito).nivel).toBe('FUERTE');
  });

  it('borrar todo vuelve al estado vacío', () => {
    expect(indicadorPara('').html).toContain(TEXTO_SIN_PASSWORD);
  });

  it('la clasificación mostrada coincide con la política: solo FUERTE es aceptable', () => {
    const ejemplos: Array<[string, NivelPassword]> = [
      ['Password12345', 'DEBIL'],
      ['aaaaaaaaaaaa', 'DEBIL'],
      ['Zx9!Qm2#Lp7', 'MEDIA'],
      ['holaholahola1', 'MEDIA'],
      ['Tornillo-Acero-77', 'FUERTE'],
    ];
    for (const [password, nivelEsperado] of ejemplos) {
      const { nivel, html: h } = indicadorPara(password);
      expect(nivel).toBe(nivelEsperado);
      expect(h).toContain(PRESENTACION_NIVEL_PASSWORD[nivelEsperado].texto);
      // la contraseña solo se acepta con nivel FUERTE (la misma regla que habilita el botón)
      expect(nivel === 'FUERTE').toBe(nivelEsperado === 'FUERTE');
    }
  });
});
