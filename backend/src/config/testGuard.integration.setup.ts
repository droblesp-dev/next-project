// SALVAGUARDAS-BD-PRUEBAS — Corrección 01A: setup EXCLUSIVO del comando de
// integración (`npm run test:integration`). A diferencia de
// `testGuard.setup.ts` (opcional, vía REQUIERE_BD_PRUEBAS=1), esta guardia
// es OBLIGATORIA E INCONDICIONAL — no existe ninguna variable que permita
// omitirla. Corre antes de que Vitest cargue cualquier archivo
// `*.integration.test.ts`.
import { assertIdentidadBaseDePruebas, IDENTIDAD_ESPERADA_POR_DEFECTO } from './testGuard.js';

await assertIdentidadBaseDePruebas(IDENTIDAD_ESPERADA_POR_DEFECTO);
