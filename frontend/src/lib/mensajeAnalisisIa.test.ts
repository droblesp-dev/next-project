import { describe, expect, it } from 'vitest';
import {
  MENSAJE_IA_GENERICO,
  MENSAJE_IA_LIMITE_DE_USO,
  MENSAJE_IA_SIN_CONEXION,
  textoResultadoAnalisis,
} from './mensajeAnalisisIa';

// Error real de la captura: JSON del proveedor con cuota, plan, modelo y enlaces.
const ERROR_CUOTA =
  '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash"}}';

describe('textoResultadoAnalisis', () => {
  it('un error de cuota (429) se muestra como un mensaje claro, sin datos del proveedor', () => {
    const t = textoResultadoAnalisis('ERROR', ERROR_CUOTA);
    expect(t).toBe(MENSAJE_IA_LIMITE_DE_USO);
    expect(t).not.toMatch(/gemini|google|quota|billing|free tier|https?:|\{/i);
  });

  it('un fallo de conexión o de tiempo de espera tiene su propio mensaje', () => {
    expect(textoResultadoAnalisis('ERROR', 'fetch failed')).toBe(MENSAJE_IA_SIN_CONEXION);
    expect(textoResultadoAnalisis('ERROR', 'Error: connect ETIMEDOUT 142.250.1.1:443')).toBe(MENSAJE_IA_SIN_CONEXION);
  });

  it('cualquier otro error (o sin texto) usa el mensaje genérico y nunca muestra el original', () => {
    expect(textoResultadoAnalisis('ERROR', 'La respuesta del proveedor de IA no es JSON válido.')).toBe(MENSAJE_IA_GENERICO);
    expect(textoResultadoAnalisis('ERROR', null)).toBe(MENSAJE_IA_GENERICO);
    expect(textoResultadoAnalisis('ERROR', '')).toBe(MENSAJE_IA_GENERICO);
  });

  it('un análisis completado conserva su resultado sin cambios', () => {
    expect(textoResultadoAnalisis('COMPLETADO', 'Resumen del análisis')).toBe('Resumen del análisis');
    expect(textoResultadoAnalisis('COMPLETADO', null)).toBeNull();
    expect(textoResultadoAnalisis('PENDIENTE', 'texto')).toBe('texto');
  });
});
