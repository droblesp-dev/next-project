import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';
import type { EsquemaJson, ProveedorIa, RespuestaIa, SolicitudIa } from './proveedorIa.types.js';

// El SDK de Google espera los tipos en mayúscula (Type.OBJECT, Type.STRING...).
function aEsquemaGemini(esquema: EsquemaJson): Record<string, unknown> {
  const salida: Record<string, unknown> = { type: esquema.type.toUpperCase() };
  if (esquema.enum) salida.enum = esquema.enum;
  if (esquema.required) salida.required = esquema.required;
  if (esquema.items) salida.items = aEsquemaGemini(esquema.items);
  if (esquema.properties) {
    salida.properties = Object.fromEntries(
      Object.entries(esquema.properties).map(([clave, valor]) => [clave, aEsquemaGemini(valor)])
    );
  }
  return salida;
}

export const geminiProvider: ProveedorIa = {
  nombre: 'gemini',
  get modelo() {
    return env.geminiModel;
  },
  variableApiKey: 'GEMINI_API_KEY',
  estaConfigurado: () => Boolean(env.geminiApiKey),
  apiKey: () => env.geminiApiKey,

  async generar({ prompt, esquemaJson, timeoutMs }: SolicitudIa): Promise<RespuestaIa> {
    const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });

    // `retryOptions: { attempts: 1 }` desactiva los reintentos automáticos del
    // SDK para no generar un segundo consumo de cuota sin autorización.
    const response = await ai.models.generateContent({
      model: env.geminiModel,
      contents: prompt,
      config: {
        ...(esquemaJson
          ? {
              responseMimeType: 'application/json',
              responseSchema: aEsquemaGemini(esquemaJson),
            }
          : {}),
        httpOptions: {
          timeout: timeoutMs,
          retryOptions: { attempts: 1 },
        },
      },
    });

    return { texto: response.text, versionModelo: response.modelVersion ?? null };
  },
};
