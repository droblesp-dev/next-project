import { defineConfig } from 'vitest/config';

// SALVAGUARDAS-BD-PRUEBAS — Corrección 01A: configuración SEPARADA y
// EXCLUSIVA para pruebas de integración (las que sí necesitan PostgreSQL).
// Solo recolecta archivos *.integration.test.ts — nunca se mezcla con
// `vitest.config.ts` (el comando unitario normal, que los excluye
// explícitamente). La guardia de este setup es obligatoria e incondicional.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    // El guard de identidad va primero (aborta antes de cualquier escritura); después
    // cada archivo recibe su carpeta temporal de logos (ver logosTemp.integration.setup.ts).
    setupFiles: ['./src/config/testGuard.integration.setup.ts', './src/config/logosTemp.integration.setup.ts'],
  },
});
