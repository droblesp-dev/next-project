// Placeholder mínimo, análogo a `vitest-setup.smoke.test.ts` pero para el
// comando de integración — su único propósito es dar al comando
// `test:integration` un archivo real que recolectar, para poder demostrar
// que la guardia obligatoria (`testGuard.integration.setup.ts`) bloquea la
// ejecución cuando la configuración es incorrecta, y la permitiría cuando
// sea correcta. No es una prueba funcional de negocio — esa queda pendiente
// hasta que exista `nextproject_test` (fase futura, autorizada aparte).
import { describe, expect, it } from 'vitest';

describe('vitest integration setup', () => {
  it('runs integration tests only after the mandatory guard passes', () => {
    expect(1 + 1).toBe(2);
  });
});
