import { configDefaults, defineConfig } from 'vitest/config';

// Comando UNITARIO (`npm test`): nunca debe tocar PostgreSQL. `exclude` descarta cualquier
// *.integration.test.ts (esas pruebas ya no forman parte del flujo de pruebas) y parte de
// `configDefaults.exclude` para no perder las exclusiones por defecto de Vitest.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
    // `pgUnitGuard.setup.ts` bloquea técnicamente cualquier uso real de `pg`/`Pool` en este
    // comando: las pruebas unitarias nunca tocan PostgreSQL. Los mocks de repositorios/servicios
    // hechos con `vi.mock(...)` no se ven afectados.
    setupFiles: ['./src/config/pgUnitGuard.setup.ts'],
  },
});
