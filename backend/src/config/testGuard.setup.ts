// SALVAGUARDAS-BD-PRUEBAS: archivo de inicialización de Vitest (ver
// `setupFiles` en vitest.config.ts). Corre antes de cualquier archivo de
// prueba. No hace nada a menos que REQUIERE_BD_PRUEBAS=1 esté fijada
// explícitamente — ver `aplicarGuardiaSiCorresponde` en testGuard.ts.
import { aplicarGuardiaSiCorresponde } from './testGuard.js';

await aplicarGuardiaSiCorresponde();
