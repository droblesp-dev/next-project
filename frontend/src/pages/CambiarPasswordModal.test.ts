import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { evaluarPassword, MENSAJES_PROBLEMA } from '../lib/politicaPassword';
import { estadoReglaLargo, Requisito, TEXTO_REGLA_LARGO } from './CambiarPasswordModal';

function regla(cumplido: boolean | null): string {
  return renderToStaticMarkup(createElement(Requisito, { cumplido, texto: TEXTO_REGLA_LARGO }));
}

describe('Regla «La contraseña no debe ser demasiado larga»', () => {
  it('usa el texto pedido y ningún término técnico', () => {
    expect(TEXTO_REGLA_LARGO).toBe('La contraseña no debe ser demasiado larga');
    expect(TEXTO_REGLA_LARGO).not.toMatch(/bytes?|72/i);
    expect(regla(true)).toContain('La contraseña no debe ser demasiado larga');
    expect(regla(true)).not.toMatch(/bytes?/i);
  });

  it('el mensaje cuando se supera el límite es claro y sin términos técnicos', () => {
    expect(MENSAJES_PROBLEMA.MAX_BYTES).toBe('La contraseña es demasiado larga. Acórtala un poco');
    expect(MENSAJES_PROBLEMA.MAX_BYTES).not.toMatch(/bytes?|72/i);
  });

  it('la regla se ve cumplida (verde), incumplida (roja) o pendiente (gris) según el estado', () => {
    const cumplida = regla(true);
    expect(cumplida).toContain('check_circle');
    expect(cumplida).toContain('text-[#22c55e]');
    expect(cumplida).not.toContain('text-error');

    const incumplida = regla(false);
    expect(incumplida).toContain('cancel');
    expect(incumplida).toContain('text-error');
    expect(incumplida).not.toContain('text-[#22c55e]');

    const pendiente = regla(null);
    expect(pendiente).toContain('radio_button_unchecked');
    expect(pendiente).toContain('text-on-surface-variant');
  });
});

describe('La regla cambia al escribir una contraseña más larga que el límite', () => {
  // Frase sin repeticiones: con 72 caracteres ASCII (72 bytes) todavía cabe; con 73 ya no.
  const larga = 'Tornillo-Acero-Cobre-Laton-Bronce-Hierro-Plomo-Zinc-Niquel-Estano-2026-Sol-Mar-Rio';
  const estado = (password: string) => estadoReglaLargo(password, evaluarPassword(password).problemas);

  it('vacía: pendiente; dentro del límite: cumplida; pasado el límite: incumplida', () => {
    expect(estado('')).toBeNull();
    expect(estado(larga.slice(0, 20))).toBe(true);
    expect(estado(larga.slice(0, 72))).toBe(true);
    expect(estado(larga.slice(0, 73))).toBe(false);
    expect(estado(larga)).toBe(false);
  });

  it('al acortarla vuelve a cumplirse', () => {
    expect(estado(larga)).toBe(false);
    expect(estado(larga.slice(0, 60))).toBe(true);
  });

  it('el límite se mide igual que en el servidor: las letras con tilde cuentan más (por eso se avisa antes)', () => {
    const conTildes = 'ñ'.repeat(37) + 'Ab1-';
    expect(estado(conTildes)).toBe(false);
  });
});

describe('Frontend y backend aplican el mismo criterio', () => {
  const rutaBackend = path.resolve(__dirname, '../../../backend/src/services/politicaPassword.ts');
  const rutaFrontend = path.resolve(__dirname, '../lib/politicaPassword.ts');

  // Si el paquete del backend no está presente (por ejemplo, al construir solo el frontend) se omite.
  it.skipIf(!existsSync(rutaBackend))('la política del frontend es IDÉNTICA a la del backend', () => {
    const normalizar = (t: string) => t.replace(/\r\n/g, '\n');
    expect(normalizar(readFileSync(rutaFrontend, 'utf8'))).toBe(normalizar(readFileSync(rutaBackend, 'utf8')));
  });
});
