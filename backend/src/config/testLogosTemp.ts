import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Infraestructura de pruebas de integración: carpeta de logos TEMPORAL y propia
// de cada archivo de prueba, para que ninguna prueba escriba en la carpeta
// compartida (`backend/uploads/logos-bancos`) ni deje referencias a archivos
// inexistentes. Solo se usa desde pruebas (no la importa ningún código de
// producción).

export const PREFIJO_CARPETA_TEMPORAL_LOGOS = 'nextproject-logos-test-';

// IMPORTANTE: este módulo NO debe importar uploadsLogosBancos.ts. El setup de
// integración lo importa ANTES de fijar LOGOS_BANCOS_DIR; si arrastrara ese
// módulo, la ruta se calcularía (y quedaría en caché) con el valor por defecto.
// Por eso la ruta compartida por defecto se repite aquí; una prueba unitaria
// comprueba que coincide con la de uploadsLogosBancos.ts.
export function rutaCompartidaPorDefecto(): string {
  return path.resolve(process.cwd(), 'uploads', 'logos-bancos');
}

export class CarpetaTemporalInvalidaError extends Error {}

// PNG 1x1 real y válido (firma y cabeceras correctas): las pruebas lo escriben
// como logo cuando una fila va a referenciar un archivo.
export const PNG_1X1_VALIDO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

export function esPngValido(buffer: Buffer): boolean {
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return buffer.length > firma.length && firma.every((b, i) => buffer[i] === b);
}

// Una carpeta es "temporal de pruebas" solo si es hija directa de la carpeta
// temporal del sistema, lleva el prefijo propio y NO es la carpeta compartida
// por defecto de la aplicación.
export function esCarpetaTemporalDePruebas(dir: string): boolean {
  const resuelta = path.resolve(dir);
  const compartida = rutaCompartidaPorDefecto();
  return (
    resuelta !== compartida &&
    path.dirname(resuelta) === path.resolve(os.tmpdir()) &&
    path.basename(resuelta).startsWith(PREFIJO_CARPETA_TEMPORAL_LOGOS)
  );
}

// Elimina una carpeta temporal de pruebas — y nada más. Si la ruta no cumple
// `esCarpetaTemporalDePruebas` no toca el disco y lanza.
export function limpiarCarpetaTemporalLogos(dir: string): void {
  if (!esCarpetaTemporalDePruebas(dir)) {
    throw new CarpetaTemporalInvalidaError(
      `Se rechaza borrar "${dir}": no es una carpeta temporal creada por las pruebas de logos.`
    );
  }
  fs.rmSync(path.resolve(dir), { recursive: true, force: true });
}

export function crearCarpetaTemporalLogos(): { dir: string; limpiar: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), PREFIJO_CARPETA_TEMPORAL_LOGOS));
  return { dir, limpiar: () => limpiarCarpetaTemporalLogos(dir) };
}

// Escribe un logo PNG real y válido con ese nombre dentro de `dir` (que debe ser
// una carpeta temporal de pruebas). Devuelve la ruta del archivo.
export function escribirLogoDePrueba(dir: string, nombreArchivo: string): string {
  if (!esCarpetaTemporalDePruebas(dir)) {
    throw new CarpetaTemporalInvalidaError(`Se rechaza escribir logos de prueba en "${dir}".`);
  }
  const ruta = path.join(dir, nombreArchivo);
  fs.writeFileSync(ruta, PNG_1X1_VALIDO);
  return ruta;
}

// ---------------------------------------------------------------------------
// Salvaguarda previa al borrado de la carpeta temporal.
//
// Una prueba que sube un logo (por el controlador o escribiéndolo ella misma)
// y no limpia sus filas dejaría `logo_path` apuntando a un archivo que
// desaparece con la carpeta temporal: una referencia rota nueva. Antes de
// borrar la carpeta se comprueba que NINGUNA fila de la base de pruebas
// referencie archivos contenidos en ella. Si hay referencias, la carpeta NO se
// borra (queda para inspección) y la prueba falla con un mensaje que las
// identifica.
//
// Este módulo no importa la base de datos: recibe un ejecutor con `query`
// (en la práctica, el `pool` ya validado por el guard de identidad).

export class ReferenciasATemporalesError extends Error {}

export interface EjecutorConsultas {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface ReferenciaATemporal {
  tabla: 'bancos_catalogo' | 'cuentas_bancarias';
  id: string;
  logo_path: string;
}

const BASE_DE_PRUEBAS = 'nextproject_test';

// Solo lectura (SELECT). Devuelve las filas que referencian archivos presentes en `dir`.
export async function buscarReferenciasATemporal(
  dir: string,
  ejecutor: EjecutorConsultas
): Promise<ReferenciaATemporal[]> {
  const archivos = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  if (archivos.length === 0) return [];

  const identidad = await ejecutor.query('SELECT current_database() AS base');
  const base = identidad.rows[0]?.base;
  if (base !== BASE_DE_PRUEBAS) {
    throw new ReferenciasATemporalesError(
      `Comprobación abortada: la base conectada es "${String(base)}", no "${BASE_DE_PRUEBAS}". ` +
        `No se borra la carpeta temporal ${dir}.`
    );
  }

  const encontradas: ReferenciaATemporal[] = [];
  for (const tabla of ['bancos_catalogo', 'cuentas_bancarias'] as const) {
    const r = await ejecutor.query(`SELECT id, logo_path FROM ${tabla} WHERE logo_path = ANY($1::text[]) ORDER BY id`, [
      archivos,
    ]);
    for (const fila of r.rows) {
      encontradas.push({ tabla, id: String(fila.id), logo_path: String(fila.logo_path) });
    }
  }
  return encontradas;
}

export function describirReferencias(dir: string, referencias: ReferenciaATemporal[]): string {
  const maximo = 20;
  const lineas = referencias.slice(0, maximo).map((r) => `  - ${r.tabla} ${r.id} -> ${r.logo_path}`);
  const resto = referencias.length > maximo ? `\n  … y ${referencias.length - maximo} más` : '';
  return (
    `${referencias.length} fila(s) de la base de pruebas siguen referenciando archivos de la carpeta temporal ` +
    `de logos "${dir}", que NO se ha borrado:\n${lineas.join('\n')}${resto}\n` +
    `Causa probable: la prueba no registró/limpió esas filas (RegistroLimpieza) antes de terminar.`
  );
}

// Borra la carpeta temporal solo si ninguna fila la referencia; si no, lanza.
export async function limpiarCarpetaTemporalSiNoHayReferencias(dir: string, ejecutor: EjecutorConsultas): Promise<void> {
  if (!esCarpetaTemporalDePruebas(dir)) {
    // Misma negativa que `limpiarCarpetaTemporalLogos`, sin consultar ni tocar nada.
    throw new CarpetaTemporalInvalidaError(
      `Se rechaza borrar "${dir}": no es una carpeta temporal creada por las pruebas de logos.`
    );
  }
  const referencias = await buscarReferenciasATemporal(dir, ejecutor);
  if (referencias.length > 0) {
    throw new ReferenciasATemporalesError(describirReferencias(dir, referencias));
  }
  limpiarCarpetaTemporalLogos(dir);
}
