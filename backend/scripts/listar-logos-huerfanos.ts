import fs from 'fs';
import 'dotenv/config';
import { pool } from '../src/config/db.js';
import { LOGOS_BANCOS_DIR } from '../src/config/uploadsLogosBancos.js';

// PC-2026-01, Fase B (V17): reporte de SOLO LECTURA de los archivos de
// backend/uploads/logos-bancos que ninguna fila referencia. Reemplazar o
// quitar el logo de una cuenta deja el archivo anterior en disco (no se
// borra nada automáticamente); este script permite revisarlos.
//
// Este script NUNCA elimina, mueve ni modifica archivos ni filas: solo
// lista. Un archivo aparece como "sin referencia" únicamente si no figura en
// `cuentas_bancarias.logo_path` ni en `bancos_catalogo.logo_path` de la base
// a la que apunta el .env. Esa conclusión solo vale para ESA base: la
// carpeta de logos puede compartirse entre bases (desarrollo, pruebas), así
// que un archivo sin referencia aquí puede estar en uso en otra. Cualquier
// borrado debe decidirse manualmente tras comprobarlo en todas las bases.
async function main() {
  const referenciados = new Set<string>();
  const filas = await pool.query<{ logo_path: string }>(
    `SELECT logo_path FROM cuentas_bancarias WHERE logo_path IS NOT NULL
     UNION
     SELECT logo_path FROM bancos_catalogo WHERE logo_path IS NOT NULL`
  );
  for (const f of filas.rows) referenciados.add(f.logo_path);

  const enDisco = fs.existsSync(LOGOS_BANCOS_DIR) ? fs.readdirSync(LOGOS_BANCOS_DIR) : [];
  const sinReferencia = enDisco.filter((a) => !referenciados.has(a));
  const referenciadosSinArchivo = [...referenciados].filter((a) => !enDisco.includes(a));

  console.log(`Base: ${(await pool.query<{ b: string }>('SELECT current_database() AS b')).rows[0].b}`);
  console.log(`Archivos en disco: ${enDisco.length} | referenciados en BD: ${referenciados.size}`);
  console.log(`Sin referencia (candidatos a revisión manual, NO se borran): ${sinReferencia.length}`);
  for (const a of sinReferencia) console.log(`  - ${a}`);
  console.log(`Referenciados en BD pero ausentes en disco: ${referenciadosSinArchivo.length}`);
  for (const a of referenciadosSinArchivo) console.log(`  - ${a}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
