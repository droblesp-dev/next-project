import multer from 'multer';
import crypto from 'crypto';
import path from 'path';

// Carpeta fija fuera de src/, ya creada y excluida de Git en D.1
// (backend/uploads/ en .gitignore). `process.cwd()` es siempre `backend/`
// porque los scripts del proyecto (`npm run dev`/`start`) se ejecutan
// desde ahí — mismo supuesto que ya usa dotenv/config para `.env`.
export const COMPROBANTES_DIR = path.resolve(process.cwd(), 'uploads', 'comprobantes');

// Whitelist de tipos permitidos para un comprobante de transferencia. La
// extensión del archivo generado se decide a partir del mimetype
// VALIDADO por el servidor, nunca del nombre original enviado por el
// cliente (evita inyección de extensión/ruta).
const EXTENSION_POR_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

export const COMPROBANTE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// F-02: memoryStorage en vez de diskStorage — multer deja el archivo en
// `req.file.buffer` (RAM), nunca lo escribe a disco por sí mismo. El
// controller decide si escribirlo, y solo lo hace DESPUÉS de que el
// código de 6 dígitos fue verificado correctamente — así ningún archivo
// llega al disco sin una autorización válida ya confirmada.
export const uploadComprobante = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: COMPROBANTE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!EXTENSION_POR_MIME[file.mimetype]) {
      cb(null, false);
      return;
    }
    cb(null, true);
  },
}).single('archivo');

// Firmas binarias reales (magic bytes) de los formatos permitidos. El MIME que declara el
// cliente es solo una declaración: un archivo cuyo contenido no corresponde al formato que
// declara se rechaza, sin excepción (mismo criterio que los logos de bancos).
const FIRMAS: { mime: string; bytes: number[] }[] = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
];

export function contenidoComprobanteCoincideConMime(buffer: Buffer, mimetypeDeclarado: string): boolean {
  const firma = FIRMAS.find((f) => f.mime === mimetypeDeclarado);
  if (!firma || buffer.length < firma.bytes.length) return false;
  return firma.bytes.every((byte, i) => buffer[i] === byte);
}

// Genera el nombre real del archivo (UUID + extensión derivada del
// mimetype ya validado por `fileFilter`) — se invoca desde el controller
// SOLO después de que `registrarComprobantePublico()` confirmó token +
// código + estado válidos, justo antes de escribir el buffer a disco.
export function generarNombreComprobante(mimetype: string): string {
  const extension = EXTENSION_POR_MIME[mimetype] ?? '';
  return `${crypto.randomUUID()}${extension}`;
}
