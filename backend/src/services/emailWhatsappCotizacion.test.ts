import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  brevoApiKey: 'brevo-test',
  nextProjectEmail: 'no-reply@example.com',
  brevoSandbox: false,
  nextProjectName: 'NextProject',
  nextProjectWhatsapp: '593939067666',
  // El primer origen es deliberadamente el del backend, como en el .env local.
  corsOrigins: ['http://localhost:3000', 'https://app.example.com'],
  frontendUrl: '',
}));
vi.mock('../config/env.js', () => ({ env: envMock }));

import { enviarCodigoAccesoRegenerado, enviarCodigoTemporalCotizacion, enviarEnlaceCotizacion } from './email.service.js';

const fetchMock = vi.fn();

interface CorreoEnviado {
  subject: string;
  htmlContent: string;
  textContent: string;
}

function correoEnviado(): CorreoEnviado {
  return JSON.parse(fetchMock.mock.calls[0][1].body) as CorreoEnviado;
}

function textoWhatsappEnviado(): string {
  const body = correoEnviado();
  const url = body.textContent.match(/https:\/\/wa\.me\/\S+/)?.[0] ?? '';
  expect(url).not.toBe('');
  expect(body.htmlContent).toContain(`href="${url}"`);
  return decodeURIComponent(new URL(url).searchParams.get('text') ?? '');
}

function hrefDelBoton(html: string, textoBoton: string): string {
  const m = html.match(new RegExp(`<a href="([^"]+)"[^>]*>${textoBoton}</a>`));
  return m?.[1] ?? '';
}

const base = { destinatarioEmail: 'c@example.com', destinatarioNombre: 'Cliente' };
const refs = { solicitudCodigo: 'SOL-000007', cotizacionCodigo: 'COT-000012' };

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messageId: 'm1' }) });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  envMock.frontendUrl = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mensaje de WhatsApp "necesito ayuda" en los correos de cotización', () => {
  it('el correo del enlace usa el código de la cotización (COT), no el de la solicitud', async () => {
    await enviarEnlaceCotizacion({ ...base, ...refs, token: 't' });
    const mensaje = textoWhatsappEnviado();
    expect(mensaje).toBe('Hola, necesito ayuda con el acceso a mi cotización COT-000012.');
    expect(mensaje).not.toContain('SOL-000007');
  });

  it('el correo del código temporal usa el código de la cotización', async () => {
    await enviarCodigoTemporalCotizacion({ ...base, ...refs, otp: '123456' });
    const mensaje = textoWhatsappEnviado();
    expect(mensaje).toContain('COT-000012');
    expect(mensaje).not.toContain('123456');
  });

  it('el correo del código regenerado usa el código de la cotización y nunca el código de acceso', async () => {
    await enviarCodigoAccesoRegenerado({ ...base, ...refs, codigo: '654321' });
    const mensaje = textoWhatsappEnviado();
    expect(mensaje).toContain('COT-000012');
    expect(mensaje).not.toContain('654321');
  });

  it('una cotización histórica sin código cae al número de solicitud', async () => {
    await enviarEnlaceCotizacion({ ...base, solicitudCodigo: 'SOL-000007', cotizacionCodigo: null, token: 't' });
    expect(textoWhatsappEnviado()).toBe('Hola, necesito ayuda con el acceso a mi cotización de la solicitud SOL-000007.');
  });

  it('sin ningún código queda el mensaje genérico', async () => {
    await enviarEnlaceCotizacion({ ...base, solicitudCodigo: null, cotizacionCodigo: null, token: 't' });
    expect(textoWhatsappEnviado()).toBe('Hola, necesito ayuda con el acceso a mi cotización.');
  });
});

describe('referencia visible en asunto y texto de los correos', () => {
  it('muestra el código de la cotización y no el de la solicitud', async () => {
    await enviarEnlaceCotizacion({ ...base, ...refs, token: 't' });
    const c = correoEnviado();
    for (const texto of [c.subject, c.textContent, c.htmlContent]) {
      expect(texto).toContain('Cotización COT-000012');
      expect(texto).not.toContain('SOL-000007');
    }
  });

  it('en los correos de código temporal y regenerado también', async () => {
    await enviarCodigoTemporalCotizacion({ ...base, ...refs, otp: '123456' });
    expect(correoEnviado().subject).toContain('Cotización COT-000012');
    fetchMock.mockClear();
    await enviarCodigoAccesoRegenerado({ ...base, ...refs, codigo: '654321' });
    expect(correoEnviado().subject).toContain('Cotización COT-000012');
  });

  it('una cotización histórica sin código muestra la solicitud', async () => {
    await enviarEnlaceCotizacion({ ...base, solicitudCodigo: 'SOL-000007', cotizacionCodigo: null, token: 't' });
    expect(correoEnviado().subject).toContain('Solicitud SOL-000007');
  });
});

describe('botón "VER MI COTIZACIÓN"', () => {
  it('con FRONTEND_URL apunta a la página pública de la cotización en el frontend', async () => {
    envMock.frontendUrl = 'https://app.example.com';
    await enviarEnlaceCotizacion({ ...base, ...refs, token: 'abc.def' });
    const c = correoEnviado();
    expect(hrefDelBoton(c.htmlContent, 'VER MI COTIZACIÓN')).toBe('https://app.example.com/cotizacion/publica/abc.def');
    expect(c.textContent).toContain('https://app.example.com/cotizacion/publica/abc.def');
  });

  it('sin FRONTEND_URL usa el primer origen de CORS_ORIGINS (compatibilidad)', async () => {
    await enviarEnlaceCotizacion({ ...base, ...refs, token: 't' });
    expect(hrefDelBoton(correoEnviado().htmlContent, 'VER MI COTIZACIÓN')).toBe(
      'http://localhost:3000/cotizacion/publica/t'
    );
  });
});
