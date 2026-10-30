import { pool } from '../config/db.js';

// Líneas de detalle (V28): el backend es «consciente del esquema». Mientras la tabla `cotizacion_items` no exista en la base, las
// cotizaciones se comportan exactamente como antes (un único `valor`, sin líneas); con la tabla creada, las nuevas cotizaciones
// por HTTP exigen líneas. Si el catálogo no puede consultarse se asume que la tabla NO existe (modo anterior, sin riesgo).
export interface EsquemaCotizaciones {
  items: boolean;
}

const TTL_OK_MS = 30_000;
const TTL_ERROR_MS = 5_000;
let cache: { valor: EsquemaCotizaciones; vence: number } | null = null;

export async function obtenerEsquemaCotizaciones(): Promise<EsquemaCotizaciones> {
  const ahora = Date.now();
  if (cache && cache.vence > ahora) {
    return cache.valor;
  }
  try {
    const result = await pool.query<{ items: boolean }>(`SELECT to_regclass('public.cotizacion_items') IS NOT NULL AS items`);
    const valor = { items: result.rows[0]?.items === true };
    cache = { valor, vence: ahora + TTL_OK_MS };
    return valor;
  } catch {
    const valor = { items: false };
    cache = { valor, vence: ahora + TTL_ERROR_MS };
    return valor;
  }
}

// Solo para pruebas: fuerza una nueva detección (por ejemplo tras aplicar una migración).
export function reiniciarCacheEsquemaCotizaciones(): void {
  cache = null;
}
