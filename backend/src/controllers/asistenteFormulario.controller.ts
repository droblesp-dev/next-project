import type { Request, Response } from 'express';
import {
  generarSugerenciaFormulario,
  PromptInvalidoError,
  ServicioInvalidoError,
} from '../services/asistenteFormulario.service.js';

// NEXIA-UX-04: ya no existe una rama 429 aquí — el límite de invocaciones de
// IA se resuelve siempre dentro de generarSugerenciaFormulario() (fallback
// automático a MODO ESTÁNDAR, ver asistenteFormulario.service.ts); este
// controller nunca vuelve a enterarse de si hubo o no cupo de Gemini.
//
// NEXIA-UX-05.1: el contrato pasa de { prompt } a { prompt, servicio }. Se
// valida aquí solo el TIPO (string no vacío); la validación de que sea uno
// de los 5 servicios reales del formulario vive en el service
// (resolverContexto) — nunca se confía únicamente en lo que el frontend ya
// filtró en su propio <select>.
export async function generarController(req: Request, res: Response): Promise<void> {
  const { prompt, servicio } = (req.body ?? {}) as { prompt?: unknown; servicio?: unknown };

  if (typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ message: 'prompt es requerido.' });
    return;
  }
  if (typeof servicio !== 'string' || !servicio.trim()) {
    res.status(400).json({ message: 'servicio es requerido.' });
    return;
  }

  try {
    // req.ip: sin proxy delante en este alcance (single-process, sin balanceo,
    // mismo criterio ya documentado en nexiaRateLimit.service.ts) — refleja la
    // IP real de la conexión entrante.
    const resultado = await generarSugerenciaFormulario(prompt, servicio, req.ip ?? 'desconocida');
    res.status(200).json(resultado);
  } catch (error) {
    if (error instanceof PromptInvalidoError || error instanceof ServicioInvalidoError) {
      res.status(400).json({ message: error.message });
      return;
    }
    throw error;
  }
}
