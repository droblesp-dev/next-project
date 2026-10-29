// Guard del comando MANUAL de pruebas de integración (`npm run test:integration`). Nunca se usa en el pipeline
// ni en `npm test`. Se niega a ejecutar nada salvo contra `nextproject_test` en localhost, con el correo en
// sandbox y las llaves de servicios externos vacías; además bloquea cualquier socket que no sea loopback.
import net from 'node:net';
import { assertIdentidadBaseDePruebas, IDENTIDAD_ESPERADA_POR_DEFECTO } from './testGuard.js';

const LOCALES = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

const problemas: string[] = [];
if (process.env.BREVO_SANDBOX !== 'true') problemas.push('BREVO_SANDBOX debe ser "true"');
for (const nombre of ['BREVO_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OPERATIVO_POR_DEFECTO_EMAIL']) {
  if (process.env[nombre] !== '') problemas.push(`${nombre} debe estar definida y vacía`);
}
if (process.env.DB_NAME !== 'nextproject_test') problemas.push('DB_NAME debe ser nextproject_test');
if (process.env.DB_HOST !== 'localhost') problemas.push('DB_HOST debe ser localhost');
if (process.env.DB_PORT !== '5432') problemas.push('DB_PORT debe ser 5432');
if (problemas.length > 0) {
  throw new Error(`Pruebas de integración rechazadas (entorno inseguro): ${problemas.join('; ')}. Use "npm run test:integration".`);
}

const conectarOriginal = net.Socket.prototype.connect;
(net.Socket.prototype as any).connect = function (this: net.Socket, ...args: any[]) {
  let a0 = args[0];
  if (Array.isArray(a0)) a0 = a0[0];
  let host: string | undefined;
  let ruta: string | undefined;
  if (a0 && typeof a0 === 'object') {
    host = a0.host;
    ruta = a0.path;
  } else if (typeof a0 === 'number' || (typeof a0 === 'string' && /^\d+$/.test(a0))) {
    host = typeof args[1] === 'string' ? args[1] : undefined;
  } else if (typeof a0 === 'string') {
    ruta = a0;
  }
  if (!ruta && !LOCALES.has(String(host ?? 'localhost').toLowerCase())) {
    throw new Error(`Pruebas de integración: conexión externa bloqueada (${host})`);
  }
  return conectarOriginal.apply(this, args as any);
};

await assertIdentidadBaseDePruebas(IDENTIDAD_ESPERADA_POR_DEFECTO);
