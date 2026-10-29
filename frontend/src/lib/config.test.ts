import { describe, expect, it } from 'vitest';
import { construirMapaUbicacion, NEXT_PROJECT_REDES, NEXT_PROJECT_UBICACION_TEXTO, urlRedSocial } from './config';

describe('construirMapaUbicacion', () => {
  it('por defecto apunta a Shushufindi, con el mapa incrustado y el enlace externo', () => {
    const { embed, enlace } = construirMapaUbicacion();
    expect(embed).toBe('https://www.google.com/maps?q=Shushufindi%2C%20Sucumbios%2C%20Ecuador&output=embed');
    expect(enlace).toBe('https://www.google.com/maps/search/?api=1&query=Shushufindi%2C%20Sucumbios%2C%20Ecuador');
    expect(NEXT_PROJECT_UBICACION_TEXTO).toBe('Shushufindi, Sucumbíos, Ecuador');
  });

  it('codifica una dirección con tildes, espacios y símbolos sin romper la URL', () => {
    const { embed, enlace } = construirMapaUbicacion('Av. Unidad Nacional & 10 de Agosto, Shushufindi');
    expect(embed).toContain('q=Av.%20Unidad%20Nacional%20%26%2010%20de%20Agosto%2C%20Shushufindi');
    expect(embed.endsWith('&output=embed')).toBe(true);
    expect(enlace).toContain('query=Av.%20Unidad%20Nacional%20%26%2010%20de%20Agosto%2C%20Shushufindi');
    // un «&» del texto no puede quedar sin codificar (abriría un parámetro nuevo)
    expect(embed.split('&output=embed')[0]).not.toMatch(/&(?!output)/);
  });

  it('solo se usan direcciones de Google Maps (https) para el iframe y el enlace', () => {
    const { embed, enlace } = construirMapaUbicacion('cualquier texto <script>');
    expect(embed.startsWith('https://www.google.com/maps')).toBe(true);
    expect(enlace.startsWith('https://www.google.com/maps')).toBe(true);
    expect(embed).not.toContain('<');
  });
});

describe('urlRedSocial (mejora 7)', () => {
  it('acepta solo URLs https completas', () => {
    expect(urlRedSocial('https://www.instagram.com/nextproject/')).toBe('https://www.instagram.com/nextproject/');
    expect(urlRedSocial('  https://youtube.com/@next  ')).toBe('https://youtube.com/@next');
  });

  it.each([undefined, null, '', '   ', 'http://www.facebook.com/x', 'javascript:alert(1)', 'facebook.com/x', 'https://', 'https://localhost'])(
    'rechaza %j (la red queda sin enlace)',
    (valor) => {
      expect(urlRedSocial(valor as string | undefined)).toBeNull();
    }
  );

  it('sin variables VITE_* configuradas ninguna red tiene URL (no se inventan cuentas)', () => {
    expect(NEXT_PROJECT_REDES).toEqual({ facebook: null, instagram: null, tiktok: null, youtube: null });
  });
});
