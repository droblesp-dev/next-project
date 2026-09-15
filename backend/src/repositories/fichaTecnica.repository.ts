import { pool } from '../config/db.js';

export interface FichaTecnica {
  id: string;
  orden_id: string;
  contenido: string;
  tiene_inconsistencia: boolean;
  generado_en: string;
  revisado_por: string | null;
  revisado_en: string | null;
}

const COLUMNAS = 'id, orden_id, contenido, tiene_inconsistencia, generado_en, revisado_por, revisado_en';

export async function findByOrdenId(ordenId: string): Promise<FichaTecnica | null> {
  const result = await pool.query<FichaTecnica>(
    `SELECT ${COLUMNAS} FROM fichas_tecnicas WHERE orden_id = $1`,
    [ordenId]
  );
  return result.rows[0] ?? null;
}

// `orden_id` es UNIQUE — un intento de crear una segunda ficha para la
// misma orden falla con violación de unicidad (23505), que el service
// traduce a FichaYaExisteError. No hay UPDATE de "regenerar sobre la
// misma fila": cada generación exitosa es una fila nueva, solo puede
// existir si no había ninguna antes (decisión 17: "solo cuando no exista
// ficha válida").
export async function crear(data: {
  ordenId: string;
  contenido: string;
  tieneInconsistencia: boolean;
}): Promise<FichaTecnica> {
  const result = await pool.query<FichaTecnica>(
    `INSERT INTO fichas_tecnicas (id, orden_id, contenido, tiene_inconsistencia)
     VALUES (gen_random_uuid(), $1, $2, $3)
     RETURNING ${COLUMNAS}`,
    [data.ordenId, data.contenido, data.tieneInconsistencia]
  );
  return result.rows[0];
}
