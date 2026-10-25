import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({ models: { generateContent } })),
}));

vi.mock('../../config/env.js', () => ({
  env: {
    geminiApiKey: 'gemini-key-secreta',
    geminiModel: 'gemini-test',
    openRouterApiKey: 'or-key-secreta',
    openRouterModel: 'cohere/north-mini-code:free',
    nextProjectName: 'NextProject',
  },
}));

import {
  asegurarProveedorConfigurado,
  obtenerProveedorIa,
  PROVEEDOR_IA_ACTIVO,
  redactarSecretosIa,
} from './index.js';
import { extraerJson, openRouterProvider } from './openrouter.provider.js';
import type { EsquemaJson } from './proveedorIa.types.js';

const ESQUEMA: EsquemaJson = {
  type: 'object',
  properties: { resumen: { type: 'string' }, prioridad: { type: 'string', enum: ['ALTA', 'BAJA'] } },
  required: ['resumen'],
};

describe('factory de proveedores de IA', () => {
  it('devuelve el proveedor indicado y usa la constante por defecto', () => {
    expect(obtenerProveedorIa('gemini').nombre).toBe('gemini');
    expect(obtenerProveedorIa('openrouter').nombre).toBe('openrouter');
    expect(obtenerProveedorIa().nombre).toBe(PROVEEDOR_IA_ACTIVO);
  });

  it('expone el modelo de cada proveedor', () => {
    expect(obtenerProveedorIa('gemini').modelo).toBe('gemini-test');
    expect(obtenerProveedorIa('openrouter').modelo).toBe('cohere/north-mini-code:free');
  });

  it('lanza si el proveedor no es conocido', () => {
    expect(() => obtenerProveedorIa('otro' as never)).toThrow(/desconocido/);
  });

  it('asegurarProveedorConfigurado usa la clase de error y el nombre de variable del proveedor', () => {
    class MiError extends Error {}
    const sinClave = { ...openRouterProvider, estaConfigurado: () => false };
    expect(() => asegurarProveedorConfigurado(sinClave, MiError)).toThrow(MiError);
    expect(() => asegurarProveedorConfigurado(sinClave)).toThrow('OPENROUTER_API_KEY no está configurada.');
    expect(() => asegurarProveedorConfigurado(openRouterProvider)).not.toThrow();
  });

  it('redactarSecretosIa elimina las API keys de todos los proveedores', () => {
    const limpio = redactarSecretosIa('fallo con gemini-key-secreta y or-key-secreta');
    expect(limpio).toBe('fallo con [REDACTED] y [REDACTED]');
  });
});

describe('proveedor Gemini', () => {
  beforeEach(() => generateContent.mockReset());

  it('convierte el esquema neutral al formato del SDK y devuelve texto y versión', async () => {
    generateContent.mockResolvedValue({ text: '{"resumen":"ok"}', modelVersion: 'v1' });

    const r = await obtenerProveedorIa('gemini').generar({ prompt: 'hola', esquemaJson: ESQUEMA, timeoutMs: 1000 });

    expect(r).toEqual({ texto: '{"resumen":"ok"}', versionModelo: 'v1' });
    const args = generateContent.mock.calls[0][0];
    expect(args.model).toBe('gemini-test');
    expect(args.contents).toBe('hola');
    expect(args.config.responseMimeType).toBe('application/json');
    expect(args.config.responseSchema).toEqual({
      type: 'OBJECT',
      required: ['resumen'],
      properties: { resumen: { type: 'STRING' }, prioridad: { type: 'STRING', enum: ['ALTA', 'BAJA'] } },
    });
    expect(args.config.httpOptions).toEqual({ timeout: 1000, retryOptions: { attempts: 1 } });
  });

  it('sin esquema no fuerza JSON', async () => {
    generateContent.mockResolvedValue({ text: 'texto libre' });
    await obtenerProveedorIa('gemini').generar({ prompt: 'hola', timeoutMs: 1000 });
    expect(generateContent.mock.calls[0][0].config.responseMimeType).toBeUndefined();
  });
});

describe('proveedor OpenRouter', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = (content: string | null, model = 'cohere/north-mini-code:free') => ({
    ok: true,
    status: 200,
    json: async () => ({ model, choices: [{ message: { content } }] }),
  });

  it('envía modelo, autorización y prompt, y devuelve el texto', async () => {
    fetchMock.mockResolvedValue(ok('  respuesta  '));

    const r = await openRouterProvider.generar({ prompt: 'hola', timeoutMs: 1000 });

    expect(r).toEqual({ texto: 'respuesta', versionModelo: 'cohere/north-mini-code:free' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer or-key-secreta');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('cohere/north-mini-code:free');
    expect(body.messages).toEqual([{ role: 'user', content: 'hola' }]);
  });

  it('con esquema lo incluye en el prompt y extrae el JSON de un bloque markdown', async () => {
    fetchMock.mockResolvedValue(ok('Claro:\n```json\n{"resumen":"ok"}\n```'));

    const r = await openRouterProvider.generar({ prompt: 'hola', esquemaJson: ESQUEMA, timeoutMs: 1000 });

    expect(r.texto).toBe('{"resumen":"ok"}');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('esquema JSON');
    expect(body.messages[0].content).toContain('"resumen"');
  });

  it('devuelve texto undefined si la respuesta viene vacía', async () => {
    fetchMock.mockResolvedValue(ok(null));
    const r = await openRouterProvider.generar({ prompt: 'hola', timeoutMs: 1000 });
    expect(r.texto).toBeUndefined();
  });

  it('lanza con el estado y mensaje cuando OpenRouter responde error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) });
    await expect(openRouterProvider.generar({ prompt: 'hola', timeoutMs: 1000 })).rejects.toThrow(
      'OpenRouter respondió 429: rate limited'
    );
  });
});

describe('extraerJson', () => {
  it('extrae el objeto aunque haya texto alrededor', () => {
    expect(extraerJson('Aquí va: {"a":1} fin')).toBe('{"a":1}');
  });
  it('devuelve el texto tal cual si no hay JSON', () => {
    expect(extraerJson('  sin json ')).toBe('sin json');
  });
});
