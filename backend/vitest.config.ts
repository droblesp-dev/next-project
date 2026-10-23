import { configDefaults, defineConfig } from 'vitest/config';

// SALVAGUARDAS-BD-PRUEBAS — Corrección 01A: este es el comando UNITARIO
// (`npm run test`) — nunca debe tocar PostgreSQL. `exclude` descarta
// explícitamente cualquier *.integration.test.ts (que vive en
// vitest.integration.config.ts, con su propia guardia obligatoria), para
// que la separación no dependa solo de que nadie "ponga mal" un archivo
// aquí. Se parte de `configDefaults.exclude` para no perder las exclusiones
// por defecto de Vitest (node_modules, dist, etc.).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
    // CORRECCIÓN 01B (H1): `pgUnitGuard.setup.ts` bloquea técnicamente
    // cualquier uso real de `pg`/`Pool` en este comando — activo por
    // defecto, sin depender de ninguna variable de entorno. Se mantiene
    // además `testGuard.setup.ts` (opcional, vía REQUIERE_BD_PRUEBAS=1) como
    // defensa adicional. Ninguno de los dos afecta al smoke test existente,
    // a las pruebas negativas de testGuard.test.ts, ni a mocks de
    // repositorios/servicios hechos con `vi.mock(...)`.
    setupFiles: ['./src/config/pgUnitGuard.setup.ts', './src/config/testGuard.setup.ts'],
  },
});
