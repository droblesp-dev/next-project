import { env } from '../../config/env.js';
import type { ProveedorIa, RespuestaIa, SolicitudIa } from './proveedorIa.types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface RespuestaOpenRouter {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string; metadata?: { raw?: string } };
}

// Los modelos gratuitos no siempre soportan `response_format`, por lo que el
// esquema se exige en el prompt y el JSON se extrae de la respuesta (los
// modelos suelen envolverlo en un bloque ```json).
export function extraerJson(texto: string): string {
  const cercado = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cercado) return cercado[1].trim();
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  return inicio !== -1 && fin > inicio ? texto.slice(inicio, fin + 1) : texto.trim();
}

export const openRouterProvider: ProveedorIa = {
  nombre: 'openrouter',
  get modelo() {
    return env.openRouterModel;
  },
  variableApiKey: 'OPENROUTER_API_KEY',
  estaConfigurado: () => Boolean(env.openRouterApiKey),
  apiKey: () => env.openRouterApiKey,

  async generar({ prompt, esquemaJson, timeoutMs }: SolicitudIa): Promise<RespuestaIa> {
    const contenido = esquemaJson
      ? `${prompt}\n\nResponde ÚNICAMENTE con un objeto JSON válido (sin texto adicional ni markdown) que cumpla este esquema JSON:\n${JSON.stringify(esquemaJson)}`
      : prompt;

    const respuesta = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openRouterApiKey}`,
        'Content-Type': 'application/json',
        'X-Title': env.nextProjectName,
      },
      body: JSON.stringify({
        model: env.openRouterModel,
        messages: [{ role: 'user', content: contenido }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const datos = (await respuesta.json().catch(() => ({}))) as RespuestaOpenRouter;
    if (!respuesta.ok) {
      const detalle = datos.error?.metadata?.raw ?? datos.error?.message ?? 'error desconocido';
      throw new Error(`OpenRouter respondió ${respuesta.status}: ${detalle}`);
    }

    const texto = datos.choices?.[0]?.message?.content?.trim();
    return {
      texto: texto && esquemaJson ? extraerJson(texto) : texto || undefined,
      versionModelo: datos.model ?? null,
    };
  },
};
