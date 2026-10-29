import { pool } from '../config/db.js';

// R0 (#8): el backend es «consciente del esquema» del chat. Detecta en el catálogo qué piezas de V25/V26/V27 existen
// y se comporta de forma segura en cada caso:
//   - sin `destinatario_id` y `contenido_privado` (esquema anterior a V25, o V25a a medias): no puede atribuirse ni
//     guardarse de forma privada ninguna respuesta de NexIA, así que TODAS se ocultan al listar y se excluyen de todo contexto de IA (nunca se muestran por duda);
//   - sin tabla de participantes o de lecturas: esas funciones quedan inactivas y el chat se comporta como antes.
// Si el catálogo no puede consultarse, se asume el esquema mínimo (falla cerrando). Esta detección es de solo
// lectura sobre el catálogo y no depende de ninguna tabla de versiones (no existe).
export interface EsquemaChat {
  destinatario: boolean;
  participantes: boolean;
  lecturas: boolean;
}

const ESQUEMA_MINIMO: EsquemaChat = { destinatario: false, participantes: false, lecturas: false };
const TTL_OK_MS = 30_000;
const TTL_ERROR_MS = 5_000;

let cache: { valor: EsquemaChat; vence: number } | null = null;

export async function obtenerEsquemaChat(): Promise<EsquemaChat> {
  const ahora = Date.now();
  if (cache && cache.vence > ahora) {
    return cache.valor;
  }
  try {
    const result = await pool.query<{ destinatario: boolean; participantes: boolean; lecturas: boolean }>(
      `SELECT
         (
           SELECT COUNT(*) = 2 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'solicitud_mensajes'
             AND column_name IN ('destinatario_id', 'contenido_privado')
         ) AS destinatario,
         to_regclass('public.solicitud_mensajes_participantes') IS NOT NULL AS participantes,
         to_regclass('public.solicitud_mensajes_lecturas') IS NOT NULL AS lecturas`
    );
    const fila = result.rows[0];
    const valor: EsquemaChat = {
      destinatario: fila?.destinatario === true,
      participantes: fila?.participantes === true,
      lecturas: fila?.lecturas === true,
    };
    cache = { valor, vence: ahora + TTL_OK_MS };
    return valor;
  } catch {
    cache = { valor: ESQUEMA_MINIMO, vence: ahora + TTL_ERROR_MS };
    return ESQUEMA_MINIMO;
  }
}

// Solo para pruebas: fuerza una nueva detección (por ejemplo tras aplicar una migración).
export function reiniciarCacheEsquemaChat(): void {
  cache = null;
}
