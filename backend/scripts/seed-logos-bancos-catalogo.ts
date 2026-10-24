import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { pool } from '../src/config/db.js';
import { normalizarNombreBanco } from '../src/services/bancosCatalogo.service.js';
import { LOGOS_BANCOS_DIR } from '../src/config/uploadsLogosBancos.js';

// PC-2026-01 ("Logos predeterminados para los 17 bancos del catálogo"):
// asocia logos oficiales ya verificados y ya copiados a
// backend/uploads/logos-bancos/<uuid>.<ext> (mismo mecanismo de
// almacenamiento que usa la subida real desde el formulario — nunca
// Base64 en PostgreSQL) con las entidades correspondientes del catálogo.
//
// Solo actualiza `logo_path` cuando la fila existe Y todavía no tiene un
// logo (`logo_path IS NULL`) — nunca sobrescribe silenciosamente un logo
// ya asignado (manual o de una ejecución anterior de este mismo script).
// Verifica que el archivo exista en disco ANTES de escribir en la base.
// Idempotente: una segunda ejecución no vuelve a tocar las filas ya
// actualizadas (el filtro `logo_path IS NULL` las excluye), así que nunca
// duplica archivos ni filas.
const ASIGNACIONES: { nombre: string; archivo: string }[] = [
  { nombre: 'Banco Pichincha', archivo: '4f90eed3-f96d-4d4e-8952-bb197dfaeae6.png' },
  { nombre: 'Banco del Pacífico', archivo: 'ca833041-7cd9-4b81-9e0b-b99655a2f6c7.png' },
  { nombre: 'Banco de Guayaquil', archivo: '63355cd0-e60b-4c13-a137-46db10919990.png' },
  { nombre: 'Produbanco', archivo: '578ee599-8238-4b5b-9a7a-f373122d4423.png' },
  { nombre: 'Banco Bolivariano', archivo: '951eee69-8bc9-44b5-9113-e398644e496e.png' },
  { nombre: 'Banco Internacional', archivo: '2a77b780-2cb5-49e3-92b3-8306c9660173.png' },
  { nombre: 'Banco del Austro', archivo: 'e6735fa9-11b1-4ad0-9475-f9f14e13e9eb.jpg' },
  { nombre: 'Banco Diners Club', archivo: 'd9c26ff9-ae22-49bf-aefc-f723c5f0261d.png' },
];

async function main() {
  const actualizados: string[] = [];
  const omitidosYaTenianLogo: string[] = [];
  const omitidosNoEncontrados: string[] = [];

  for (const { nombre, archivo } of ASIGNACIONES) {
    const rutaArchivo = path.join(LOGOS_BANCOS_DIR, archivo);
    if (!fs.existsSync(rutaArchivo)) {
      console.error(`OMITIDO (archivo no existe en disco): ${nombre} -> ${archivo}`);
      omitidosNoEncontrados.push(nombre);
      continue;
    }

    const nombreNormalizado = normalizarNombreBanco(nombre);
    const result = await pool.query<{ id: string }>(
      `UPDATE bancos_catalogo SET logo_path = $2
       WHERE nombre_normalizado = $1 AND logo_path IS NULL
       RETURNING id`,
      [nombreNormalizado, archivo]
    );

    if (result.rowCount && result.rowCount > 0) {
      actualizados.push(nombre);
    } else {
      // No se actualizó: o no existe esa entidad, o ya tenía logo. Se
      // distingue para no afirmar "ya tenía logo" sin comprobarlo.
      const existente = await pool.query<{ logo_path: string | null }>(
        `SELECT logo_path FROM bancos_catalogo WHERE nombre_normalizado = $1`,
        [nombreNormalizado]
      );
      if (existente.rowCount && existente.rowCount > 0) {
        omitidosYaTenianLogo.push(`${nombre} (logo_path actual: ${existente.rows[0].logo_path})`);
      } else {
        omitidosNoEncontrados.push(`${nombre} (no existe en bancos_catalogo)`);
      }
    }
  }

  console.log(`Actualizados (${actualizados.length}): ${actualizados.join(', ') || '(ninguno)'}`);
  console.log(`Omitidos, ya tenían logo (${omitidosYaTenianLogo.length}): ${omitidosYaTenianLogo.join(', ') || '(ninguno)'}`);
  console.log(`Omitidos, no encontrados (${omitidosNoEncontrados.length}): ${omitidosNoEncontrados.join(', ') || '(ninguno)'}`);
  await pool.end();
}

main().catch((error) => {
  console.error('Error al asignar logos del catálogo de bancos:', error);
  process.exit(1);
});
