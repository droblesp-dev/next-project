import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PieCotizacionPublica from './PieCotizacionPublica';

const SIN_REDES = { facebook: null, instagram: null, tiktok: null, youtube: null };

function html(redes = SIN_REDES, codigo: string | null = 'COT-000006'): string {
  return renderToStaticMarkup(<PieCotizacionPublica codigoCotizacion={codigo} redes={redes} />);
}

describe('PieCotizacionPublica — redes sociales (mejora 7)', () => {
  it('sin URLs configuradas muestra los cuatro iconos sin enlace ni destinos ficticios', () => {
    const h = html();
    for (const red of ['Facebook', 'Instagram', 'TikTok', 'YouTube']) {
      expect(h).toContain(`aria-label="${red} (enlace no configurado)"`);
    }
    expect((h.match(/data-sin-enlace="true"/g) ?? []).length).toBe(4);
    expect(h).not.toMatch(/facebook\.com|instagram\.com|tiktok\.com|youtube\.com/);
  });

  it('con URL configurada el icono es un enlace externo seguro; los demás siguen sin enlace', () => {
    const h = html({ ...SIN_REDES, instagram: 'https://www.instagram.com/nextproject_demo/' });
    expect(h).toContain('href="https://www.instagram.com/nextproject_demo/"');
    expect(h).toContain('target="_blank"');
    expect(h).toContain('rel="noopener noreferrer"');
    expect(h).toContain('aria-label="Instagram (se abre en una pestaña nueva)"');
    expect((h.match(/data-sin-enlace="true"/g) ?? []).length).toBe(3);
  });

  it('con las cuatro configuradas no queda ningún icono sin enlace', () => {
    const h = html({
      facebook: 'https://www.facebook.com/a',
      instagram: 'https://www.instagram.com/a',
      tiktok: 'https://www.tiktok.com/@a',
      youtube: 'https://www.youtube.com/@a',
    });
    expect(h).not.toContain('data-sin-enlace');
    expect((h.match(/target="_blank"/g) ?? []).length).toBe(5); // 4 redes + WhatsApp
  });

  it('WhatsApp se conserva una sola vez, con su enlace wa.me y el número visible', () => {
    const h = html();
    expect((h.match(/href="https:\/\/wa\.me\//g) ?? []).length).toBe(1);
    expect(h).toContain('HABLAR CON UN ASESOR');
    expect(h).toContain('COT-000006');
    expect((h.match(/href="tel:/g) ?? []).length).toBe(1);
    expect(h).toContain('VOLVER A LA PÁGINA PRINCIPAL');
  });
});
