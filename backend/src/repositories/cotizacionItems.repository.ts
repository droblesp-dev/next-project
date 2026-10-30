import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';
import { DESTINO_ACENTOS, ORIGEN_ACENTOS } from '../services/busquedaPatron.js';
import type { LineaCalculada } from '../services/cotizacionItems.js';

type Ejecutor = Pick<Pool | PoolClient, 'query'>;

export interface CotizacionItem {
  id: string;
  cotizacion_id: string;
  orden: number;
  descripcion: string;
  // NUMERIC: llegan como texto exacto (por ejemplo «2.500» y «12.50»).
  cantidad: string;
  precio_unitario: string;
  subtotal: string;
}

export interface SugerenciaConcepto {
  descripcion: string;
  ultimo_precio_unitario: string;
  veces_usado: number;
  ultima_vez: string;
}

// Misma normalización que la búsqueda del sistema (busqueda.repository.ts): minúsculas, sin tildes y «_» como espacio.
const NORMALIZAR = (expr: string): string => `translate(replace(lower((${expr})::text), '_', ' '), '${ORIGEN_ACENTOS}', '${DESTINO_ACENTOS}')`;

// Estados cuyas cotizaciones aportan conceptos al buscador (decisión aprobada): nunca los borradores ni las canceladas.
export const ESTADOS_FUENTE_SUGERENCIAS = ['ENVIADA', 'ACEPTADA', 'RECHAZADA', 'VENCIDA'];

const COLUMNAS = 'id, cotizacion_id, orden, descripcion, cantidad, precio_unitario, subtotal';

export async function listarPorCotizacion(cotizacionId: string, ejecutor: Ejecutor = pool): Promise<CotizacionItem[]> {
  const result = await ejecutor.query<CotizacionItem>(
    `SELECT ${COLUMNAS} FROM cotizacion_items WHERE cotizacion_id = $1 ORDER BY orden ASC`,
    [cotizacionId]
  );
  return result.rows;
}

// Reemplaza el conjunto de líneas de una cotización. Debe llamarse DENTRO de una transacción que ya bloqueó la fila de la
// cotización y comprobó que sigue en BORRADOR (el disparador V28 lo exige también a nivel de base de datos).
export async function reemplazar(client: Ejecutor, cotizacionId: string, lineas: LineaCalculada[]): Promise<CotizacionItem[]> {
  await client.query('DELETE FROM cotizacion_items WHERE cotizacion_id = $1', [cotizacionId]);
  const guardadas: CotizacionItem[] = [];
  for (const l of lineas) {
    const result = await client.query<CotizacionItem>(
      `INSERT INTO cotizacion_items (id, cotizacion_id, orden, descripcion, descripcion_normalizada, cantidad, precio_unitario, subtotal)
       VALUES (gen_random_uuid(), $1, $2, $3, ${NORMALIZAR('$7')}, $4, $5, $6)
       RETURNING ${COLUMNAS}`,
      [cotizacionId, l.orden, l.descripcion, l.cantidad, l.precioUnitario, l.subtotal, l.descripcion]
    );
    guardadas.push(result.rows[0]);
  }
  return guardadas;
}

// Buscador de conceptos reutilizables (sin catálogo): descripciones ya usadas en cotizaciones formalizadas, agrupadas por su texto
// normalizado, con el último precio unitario y cuántas veces se usaron. `parcial` es el patrón «%texto%» ya normalizado y escapado.
export async function sugerirConceptos(parcial: string, limite: number): Promise<SugerenciaConcepto[]> {
  const result = await pool.query<SugerenciaConcepto>(
    `SELECT (array_agg(i.descripcion ORDER BY c.creado_en DESC, i.orden ASC))[1] AS descripcion,
            (array_agg(i.precio_unitario ORDER BY c.creado_en DESC, i.orden ASC))[1] AS ultimo_precio_unitario,
            COUNT(*)::int AS veces_usado,
            MAX(c.creado_en) AS ultima_vez
     FROM cotizacion_items i
     JOIN cotizaciones c ON c.id = i.cotizacion_id
     WHERE c.estado = ANY($2::text[])
       AND i.descripcion_normalizada LIKE $1 ESCAPE '\\'
     GROUP BY i.descripcion_normalizada
     ORDER BY COUNT(*) DESC, MAX(c.creado_en) DESC
     LIMIT $3`,
    [parcial, ESTADOS_FUENTE_SUGERENCIAS, limite]
  );
  return result.rows;
}

// Búsqueda global de cotizaciones por descripción de línea: ids de las cotizaciones con alguna línea que contenga el texto.
export async function buscarCotizacionesPorLineas(parcial: string): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    `SELECT DISTINCT i.cotizacion_id AS id FROM cotizacion_items i WHERE i.descripcion_normalizada LIKE $1 ESCAPE '\\'`,
    [parcial]
  );
  return result.rows.map((r) => r.id);
}
