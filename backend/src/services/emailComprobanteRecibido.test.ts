import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mejora 5: correo de «comprobante recibido». Todo con `fetch` simulado: ninguna prueba envía correo real.
const envMock = vi.hoisted(() => ({
  brevoApiKey: 'brevo-test',
  nextProjectEmail: 'no-reply@example.com',
  brevoSandbox: true,
  nextProjectName: 'NextProject',
  nextProjectWhatsapp: '593939067666',
  corsOrigins: ['https://app.example.com'],
  frontendUrl: '',
}));
vi.mock('../config/env.js', () => ({ env: envMock }));

import { enviarComprobanteRecibido } from './email.service.js';

const fetchMock = vi.fn();
const base = {
  destinatarioEmail: 'c@example.com',
  destinatarioNombre: 'Cliente',
  solicitudCodigo: 'SOL-000007',
  cotizacionCodigo: 'COT-000012',
};

function cuerpo() {
  return JSON.parse(fetchMock.mock.calls[0][1].body) as { subject: string; htmlContent: string; textContent: string };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ messageId: 'm1' }) });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  envMock.brevoApiKey = 'brevo-test';
  envMock.brevoSandbox = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('enviarComprobanteRecibido (mejora 5)', () => {
  it('identifica si es el anticipo o el saldo, en el asunto y en el texto', async () => {
    await enviarComprobanteRecibido({ ...base, tipoPago: 'ANTICIPO' });
    expect(cuerpo().subject).toContain('comprobante de anticipo');
    expect(cuerpo().textContent).toContain('tu anticipo');
    expect(cuerpo().htmlContent).toContain('tu anticipo');

    fetchMock.mockClear();
    await enviarComprobanteRecibido({ ...base, tipoPago: 'SALDO' });
    expect(cuerpo().subject).toContain('comprobante de saldo');
    expect(cuerpo().textContent).toContain('tu saldo');
  });

  it('solo confirma la recepción: no afirma que esté aceptado ni que el dinero esté acreditado', async () => {
    await enviarComprobanteRecibido({ ...base, tipoPago: 'ANTICIPO' });
    const { textContent, htmlContent } = cuerpo();
    for (const t of [textContent, htmlContent]) {
      expect(t).toContain('Recibimos el comprobante');
      expect(t).toContain('todavía no está aceptado ni acreditado');
      expect(t).not.toMatch(/ya fue acreditado|Confirmamos que el pago/);
    }
  });

  it('no incluye código de acceso, token ni importes', async () => {
    await enviarComprobanteRecibido({ ...base, tipoPago: 'SALDO' });
    // los números de referencia (COT-/SOL-) y el enlace de WhatsApp no son códigos de acceso
    const { textContent } = cuerpo();
    const sinReferencias = textContent.replace(/(COT|SOL)-\d+/g, '').replace(/https:\/\/wa\.me\/\S+/g, '');
    expect(sinReferencias).not.toMatch(/\b\d{6}\b/);
    expect(textContent).not.toMatch(/eyJ/);
    expect(textContent).not.toMatch(/\$\s?\d/);
  });

  it('respeta el sandbox de Brevo y envía al destinatario de la cotización', async () => {
    await enviarComprobanteRecibido({ ...base, tipoPago: 'ANTICIPO' });
    expect(fetchMock.mock.calls[0][1].headers['X-Sib-Sandbox']).toBe('drop');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).to).toEqual([{ email: 'c@example.com', name: 'Cliente' }]);
  });

  it('sin BREVO_API_KEY no envía nada y resuelve «skipped»', async () => {
    envMock.brevoApiKey = '';
    const r = await enviarComprobanteRecibido({ ...base, tipoPago: 'ANTICIPO' });
    expect(r.estado).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un fallo de red no lanza: resuelve «failed»', async () => {
    fetchMock.mockRejectedValue(new Error('sin red'));
    const r = await enviarComprobanteRecibido({ ...base, tipoPago: 'ANTICIPO' });
    expect(r.estado).toBe('failed');
  });
});
