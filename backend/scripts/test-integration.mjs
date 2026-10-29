// Comando MANUAL de pruebas de integración: `npm run test:integration` (opcional: rutas de archivos de prueba).
// Fija el entorno seguro (BD de pruebas local, correo en sandbox, sin llaves externas) y lanza Vitest.
// No forma parte del pipeline. Las pruebas escriben datos ficticios SOLO en nextproject_test.
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  DB_NAME: 'nextproject_test',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  BREVO_SANDBOX: 'true',
  BREVO_API_KEY: '',
  GEMINI_API_KEY: '',
  OPENROUTER_API_KEY: '',
  OPERATIVO_POR_DEFECTO_EMAIL: '',
};
const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.integration.config.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  shell: true,
});
process.exit(r.status ?? 1);
