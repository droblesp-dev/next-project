// Texto que se muestra del resultado de un análisis de IA. Cuando el intento terminó en ERROR, el
// servidor guarda el mensaje ORIGINAL del proveedor (por ejemplo, JSON con cuotas, plan, modelo y
// enlaces). Ese texto es técnico, puede ser muy largo y no debe mostrarse al usuario: se sustituye por
// una frase breve y accionable. El mensaje original sigue guardado en la base de datos para diagnóstico.
export const MENSAJE_IA_LIMITE_DE_USO = 'El servicio de IA alcanzó su límite de uso. Inténtalo de nuevo más tarde.';
export const MENSAJE_IA_SIN_CONEXION = 'No se pudo contactar al servicio de IA. Inténtalo de nuevo en unos minutos.';
export const MENSAJE_IA_GENERICO = 'El análisis no se pudo completar. Puedes volver a intentarlo.';

export function textoResultadoAnalisis(estado: string, resultado: string | null): string | null {
  if (estado !== 'ERROR') return resultado;
  const crudo = resultado ?? '';
  if (/\b429\b|quota|rate.?limit|resource_exhausted|exceeded your/i.test(crudo)) return MENSAJE_IA_LIMITE_DE_USO;
  if (/timeout|timed out|etimedout|econn|enotfound|fetch failed|network|socket/i.test(crudo)) return MENSAJE_IA_SIN_CONEXION;
  return MENSAJE_IA_GENERICO;
}
