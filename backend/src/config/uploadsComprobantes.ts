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

// Genera el nombre real del archivo (UUID + extensión derivada del
// mimetype ya validado por `fileFilter`) — se invoca desde el controller
// SOLO después de que `registrarComprobantePublico()` confirmó token +
// código + estado válidos, justo antes de escribir el buffer a disco.
export function generarNombreComprobante(mimetype: string): string {
  const extension = EXTENSION_POR_MIME[mimetype] ?? '';
  return `${crypto.randomUUID()}${extension}`;
}
