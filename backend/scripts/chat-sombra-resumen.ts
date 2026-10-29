// Resumen del modo sombra del chat (condición 3 de salida a estricto) a partir del registro del servidor.
// Uso:  npx tsx scripts/chat-sombra-resumen.ts <registro.log> [--dias 7] [--explicados <archivo>]
//   - <registro.log>: archivo con las líneas del servidor (una por evento; solo se leen las del evento de sombra).
//   - --explicados: archivo de texto con un par «usuarioId solicitudId» por línea ya explicado y aceptado.
// No se conecta a ninguna base de datos ni escribe nada. Sale con código 1 si queda algún acceso sin explicar en la ventana.
import { readFileSync } from 'node:fs';
import { resumirSombra } from '../src/services/resumenSombra.js';

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--dias' && args[args.indexOf(a) - 1] !== '--explicados');
if (!archivo) {
  console.error('Uso: npx tsx scripts/chat-sombra-resumen.ts <registro.log> [--dias 7] [--explicados <archivo>]');
  process.exit(2);
}
const valor = (nombre: string) => (args.includes(nombre) ? args[args.indexOf(nombre) + 1] : undefined);
const dias = valor('--dias') ? Number(valor('--dias')) : 7;
const explicadosArchivo = valor('--explicados');
const explicados = new Set<string>(
  explicadosArchivo
    ? readFileSync(explicadosArchivo, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim().split(/\s+/))
        .filter((p) => p.length === 2)
        .map((p) => `${p[0]}|${p[1]}`)
    : []
);

const resumen = resumirSombra(readFileSync(archivo, 'utf8').split(/\r?\n/), { dias, explicados });
console.log(JSON.stringify({ ventanaDias: dias, ...resumen }, null, 2));
console.log(resumen.cumpleCondicion ? '\nCONDICIÓN 3: CUMPLIDA (ningún acceso sin explicar en la ventana).' : `\nCONDICIÓN 3: NO CUMPLIDA (${resumen.sinExplicarEnVentana} par(es) usuario-solicitud sin explicar).`);
process.exit(resumen.cumpleCondicion ? 0 : 1);
