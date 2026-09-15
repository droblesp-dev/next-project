import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import {
  uploadEvidencia,
  tipoEvidenciaPorMime,
  generarNombreEvidencia,
  EVIDENCIAS_DIR,
  EVIDENCIA_MAX_BYTES,
} from '../config/uploadsEvidencias.js';
import {
  listarEvidencias,
  agregarEvidencia,
  obtenerArchivoEvidencia,
  OrdenNoEncontradaError,
  LimiteEvidenciasError,
  EvidenciaNoEncontradaError,
  EstadoNoPermiteEvidenciaError,
} from '../services/ordenEvidencia.service.js';

export async function listarEvidenciasController(req: Request, res: Response): Promise<void> {
  try {
    const evidencias = await listarEvidencias(req.params.id);
    res.status(200).json({ evidencias });
  } catch (error) {
    if (error instanceof OrdenNoEncontradaError) {
      res.status(404).json({ message: 'Orden no encontrada.' });
      return;
    }
    throw error;
  }
}

// Mismo patrón que subirComprobanteController (F-02): multer procesado
// manualmente con memoryStorage — el archivo nunca toca disco hasta que
// el service confirma que la orden existe y que el límite de ese tipo de
// evidencia no se superó.
export async function subirEvidenciaController(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve) => {
    uploadEvidencia(req, res, (err: unknown) => {
      procesarEvidencia(req, res, err).finally(resolve);
    });
  });
}

async function procesarEvidencia(req: Request, res: Response, err: unknown): Promise<void> {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      message: `El archivo excede el tamaño máximo permitido (${EVIDENCIA_MAX_BYTES / (1024 * 1024)} MB).`,
    });
    return;
  }
  if (err) {
    res.status(400).json({ message: 'No se pudo procesar el archivo.' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ message: 'Debe adjuntar un archivo válido (PDF, JPG o PNG).' });
    return;
  }

  const tipo = tipoEvidenciaPorMime(req.file.mimetype);
  if (!tipo) {
    res.status(400).json({ message: 'Tipo de archivo no permitido.' });
    return;
  }

  try {
    const nombreArchivo = generarNombreEvidencia(req.file.mimetype);
    const evidencia = await agregarEvidencia(req.params.id, tipo, nombreArchivo);
    // Solo se llega aquí si la orden existe y el límite no se superó —
    // recién ahora se escribe el archivo real a disco (mismo orden que
    // el comprobante de anticipo, F-02).
    await fs.promises.writeFile(path.join(EVIDENCIAS_DIR, nombreArchivo), req.file.buffer);
    res.status(201).json({ evidencia });
  } catch (error) {
    if (error instanceof OrdenNoEncontradaError) {
      res.status(404).json({ message: 'Orden no encontrada.' });
      return;
    }
    if (error instanceof LimiteEvidenciasError) {
      res.status(409).json({ message: 'Ya se alcanzó el máximo de evidencias de este tipo para esta orden.' });
      return;
    }
    if (error instanceof EstadoNoPermiteEvidenciaError) {
      res.status(409).json({ message: 'Solo se puede agregar evidencia mientras la orden está EN_PROCESO o PAUSADA.' });
      return;
    }
    console.error('Error no controlado al registrar evidencia:', error instanceof Error ? error.message : error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
}

// H-B (auditoría post-V9): la ruta absoluta se construye SIEMPRE a partir
// de EVIDENCIAS_DIR (fijo) + el nombre de archivo real leído de la BD —
// el cliente nunca provee ni conoce ese nombre. `obtenerArchivoEvidencia`
// ya verificó que la evidencia pertenece a la orden de la ruta.
export async function descargarEvidenciaController(req: Request, res: Response): Promise<void> {
  try {
    const evidencia = await obtenerArchivoEvidencia(req.params.id, req.params.evidenciaId);
    const rutaAbsoluta = path.join(EVIDENCIAS_DIR, evidencia.nombre_archivo);
    res.sendFile(rutaAbsoluta, (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ message: 'El archivo de la evidencia no se encontró.' });
      }
    });
  } catch (error) {
    if (error instanceof OrdenNoEncontradaError) {
      res.status(404).json({ message: 'Orden no encontrada.' });
      return;
    }
    if (error instanceof EvidenciaNoEncontradaError) {
      res.status(404).json({ message: 'Evidencia no encontrada para esta orden.' });
      return;
    }
    throw error;
  }
}
