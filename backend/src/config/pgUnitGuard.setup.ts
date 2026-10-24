// CORRECCIÓN 01B (H1) — SALVAGUARDAS-BD-PRUEBAS: bloqueo técnico real de
// PostgreSQL para el comando UNITARIO (`npm run test`), exclusivo de este
// setup — NUNCA se referencia desde `vitest.integration.config.ts` ni desde
// `server.ts`/ningún archivo de arranque de la aplicación.
//
// A diferencia de la separación por nombre de archivo (`*.integration.test.ts`),
// que solo protege si el autor del test sigue la convención, este mecanismo
// intercepta el módulo `pg` COMPLETO antes de que cualquier archivo lo
// importe — sin importar si ese archivo se llama "test" o "integration",
// sin importar si importa `db.ts` directamente o a través de un repositorio
// o servicio. `new Pool(...)` (en `db.ts` o en cualquier otro lugar) recibe
// esta implementación bloqueada en vez de la real.
//
// No interfiere con mocks de repositorios/servicios (`vi.mock('../repositories/...')`):
// un mock de ese tipo sustituye el módulo completo del repositorio, cuyo
// propio `import { pool } from '../config/db.js'` nunca llega a ejecutarse
// — este bloqueo y esos mocks operan en capas distintas y no se tocan entre sí.
//
// No se modificó `backend/src/config/db.ts` (archivo de producción) — la
// alternativa más acotada y fiable, tal como se pidió, es interceptar el
// módulo `pg` en el límite de la prueba, no el código de la aplicación.
import { vi } from 'vitest';

const MENSAJE_BLOQUEO =
  'BLOQUEADO (pgUnitGuard): las pruebas unitarias (`npm run test`) no pueden conectarse a PostgreSQL real. ' +
  'Si esto es una prueba de integración, renómbrala a *.integration.test.ts y ejecútala con `npm run test:integration`.';

vi.mock('pg', () => {
  class PoolBloqueado {
    // Firma compatible con la superficie real de `pg.Pool` que usa este
    // proyecto (`query`, `connect`, `on`, `end`) — ver `db.ts`.
    query(): never {
      throw new Error(MENSAJE_BLOQUEO);
    }
    connect(): never {
      throw new Error(MENSAJE_BLOQUEO);
    }
    on(): this {
      // No-op deliberado: `db.ts` registra `pool.on('error', ...)` al
      // importarse — debe poder hacerlo sin lanzar, para que el simple
      // hecho de importar `db.ts` (sin ejecutar ninguna consulta) no rompa
      // ninguna prueba unitaria legítima que solo necesite importar tipos.
      return this;
    }
    end(): Promise<void> {
      return Promise.resolve();
    }
  }

  return { Pool: PoolBloqueado };
});
