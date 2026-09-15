import multer from 'multer';
import crypto from 'crypto';
import path from 'path';

// Carpeta propia, separada de uploads/comprobantes/ (propósito y ciclo de
// vida distintos). Ya cubierta por `.gitignore` (`backend/uploads/`, sin
// más especificidad) — no requiere ningún cambio en `.gitignore`.
export const EVIDENCIAS_DIR = path.resolve(process.cwd(), 'uploads', 'evidencias');

const EXTENSION_POR_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

const TIPO_POR_MIME: Record<string, 'FOTO' | 'PDF'> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'FOTO',
  'image/png': 'FOTO',
};

export const EVIDENCIA_MAX_BYTES = 5 * 1024 * 1024; // 5 MB, mismo límite que comprobantes

// Mismo patrón que uploadsComprobantes.ts (memoryStorage, corrección F-02):
// el archivo nunca toca el disco hasta que el service confirma que la
// orden existe y que el límite de evidencias de ese tipo no se superó —
// evita escribir a disco un archivo que luego será rechazado.
export const uploadEvidencia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EVIDENCIA_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!EXTENSION_POR_MIME[file.mimetype]) {
      cb(null, false);
      return;
    }
    cb(null, true);
  },
}).single('archivo');

export function tipoEvidenciaPorMime(mimetype: string): 'FOTO' | 'PDF' | null {
  return TIPO_POR_MIME[mimetype] ?? null;
}

// Nombre generado por el servidor (UUID + extensión validada) — nunca el
// nombre original del archivo del cliente. Es la única referencia que se
// guarda en `ordenes_evidencias.nombre_archivo`.
export function generarNombreEvidencia(mimetype: string): string {
  const extension = EXTENSION_POR_MIME[mimetype] ?? '';
  return `${crypto.randomUUID()}${extension}`;
}
