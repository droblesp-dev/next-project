import multer from 'multer';
import crypto from 'crypto';
import path from 'path';

// PC-2026-01 (Fase D — Gestión de logos): mismo patrón ya probado en
// uploadsComprobantes.ts — carpeta fija fuera de src/, ya en
// backend/.gitignore (backend/uploads/), memoryStorage (nunca se escribe a
// disco hasta validar), nombre de archivo siempre generado por el
// servidor (UUID + extensión del mimetype ya validado) — el nombre
// original del cliente nunca se usa para el archivo final.
// Carpeta de logos. Por defecto, exactamente la de siempre
// (`backend/uploads/logos-bancos`, relativa a `process.cwd()`). La variable de
// entorno opcional `LOGOS_BANCOS_DIR` permite apuntar a otra carpeta (las
// pruebas de integración la usan para trabajar en una carpeta temporal propia,
// sin tocar la compartida). Vacía o solo espacios equivale a no configurarla.
export function resolverDirLogosBancos(valorEnv: string | undefined, cwd: string): string {
  const personalizado = valorEnv?.trim();
  return personalizado ? path.resolve(personalizado) : path.resolve(cwd, 'uploads', 'logos-bancos');
}

export const LOGOS_BANCOS_DIR = resolverDirLogosBancos(process.env.LOGOS_BANCOS_DIR, process.cwd());

const EXTENSION_POR_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

export const LOGO_BANCO_MAX_BYTES = 1 * 1024 * 1024; // 1 MB (Fase D, requisito explícito)

export const uploadLogoBanco = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LOGO_BANCO_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!EXTENSION_POR_MIME[file.mimetype]) {
      cb(null, false);
      return;
    }
    cb(null, true);
  },
}).single('logo');

export function generarNombreLogoBanco(mimetype: string): string {
  const extension = EXTENSION_POR_MIME[mimetype] ?? '';
  return `${crypto.randomUUID()}${extension}`;
}

// Firmas binarias reales (magic bytes) de PNG/JPEG — Fase D exige validar
// "el contenido real del archivo", no solo el mimetype que el cliente
// declara (que puede falsificarse). Un archivo cuyo contenido no coincide
// con la extensión que su propio mimetype declarado indicaría se rechaza,
// sin excepción.
const FIRMAS: { mime: string; bytes: number[] }[] = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

export function contenidoRealCoincideConMime(buffer: Buffer, mimetypeDeclarado: string): boolean {
  const firma = FIRMAS.find((f) => f.mime === mimetypeDeclarado);
  if (!firma) return false;
  if (buffer.length < firma.bytes.length) return false;
  return firma.bytes.every((b, i) => buffer[i] === b);
}
