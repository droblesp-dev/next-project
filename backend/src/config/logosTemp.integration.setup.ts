import { afterAll } from 'vitest';
import { crearCarpetaTemporalLogos, limpiarCarpetaTemporalSiNoHayReferencias } from './testLogosTemp.js';

// Setup de las pruebas de integración (vitest.integration.config.ts): cada
// archivo de prueba trabaja con su propia carpeta temporal de logos. Se fija
// `LOGOS_BANCOS_DIR` ANTES de que el archivo de prueba importe cualquier módulo
// (los `setupFiles` se ejecutan primero), de modo que `uploadsLogosBancos.ts`
// calcula su ruta ya apuntando a la carpeta temporal.
//
// Al terminar el archivo se elimina únicamente esa carpeta, y solo si ninguna
// fila de la base de pruebas sigue referenciando archivos que contiene
// (salvaguarda: evita dejar `logo_path` apuntando a archivos que desaparecen).
// Los hooks `afterAll` se ejecutan en orden inverso al de registro (valor por
// defecto de Vitest, `sequence.hooks = 'stack'`): primero la limpieza por IDs de
// la propia prueba y después este.
const carpeta = crearCarpetaTemporalLogos();
process.env.LOGOS_BANCOS_DIR = carpeta.dir;

afterAll(async () => {
  // `pool` ya fue validado por el guard de identidad (nextproject_test); la
  // salvaguarda además lo comprueba con current_database() antes de consultar.
  const { pool } = await import('./db.js');
  await limpiarCarpetaTemporalSiNoHayReferencias(carpeta.dir, pool);
});
