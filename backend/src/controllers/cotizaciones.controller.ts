import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import {
  listarCotizaciones,
  obtenerCotizacion,
  crearCotizacion,
  editarCotizacionBorrador,
  cambiarEstadoCotizacion,
  generarEnlaceCotizacion,
  validarEnlaceCotizacion,
  verificarCodigoCotizacion,
  aceptarCotizacionPublica,
  rechazarCotizacionPublica,
  registrarComprobantePublico,
  gestionarAnticipo,
  obtenerNombreComprobante,
  registrarComprobanteSaldoPublico,
  gestionarSaldo,
  obtenerNombreComprobanteSaldo,
  reabrirSaldo,
  SolicitudNoEncontradaError,
  SolicitudNoEnRevisionError,
  CotizacionNoEncontradaError,
  TransicionInvalidaError,
  EstadoInvalidoError,
  YaExisteAceptadaError,
  EnlaceInvalidoError,
  CotizacionNoDisponibleError,
  CodigoInvalidoError,
  DemasiadosIntentosError,
  IvaPorcentajeInvalidoError,
  AnticipoPorcentajeInvalidoError,
  MetodoAnticipoRequeridoError,
  MetodoAnticipoNoPermitidoError,
  MetodoAnticipoInvalidoError,
  DiasVigenciaInvalidoError,
  AccionNoPermitidaError,
  AnticipoNoGestionableError,
  SaldoNoGestionableError,
  MetodoSaldoRequeridoError,
  MetodoSaldoInvalidoError,
  ComprobanteSaldoRequeridoError,
  SaldoNoRechazadoError,
  CotizacionNoEditableError,
} from '../services/cotizaciones.service.js';
import { uploadComprobante, generarNombreComprobante, COMPROBANTES_DIR, COMPROBANTE_MAX_BYTES } from '../config/uploadsComprobantes.js';

function extraerCodigoValido(body: Record<string, unknown>): string | null {
  const codigo = body.codigo;
  if (typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
    return null;
  }
  return codigo;
}

export async function listarController(_req: Request, res: Response): Promise<void> {
  const cotizaciones = await listarCotizaciones();
  res.status(200).json({ cotizaciones });
}

export async function obtenerController(req: Request, res: Response): Promise<void> {
  const cotizacion = await obtenerCotizacion(req.params.id);
  if (!cotizacion) {
    res.status(404).json({ message: 'Cotización no encontrada.' });
    return;
  }
  res.status(200).json({ cotizacion });
}

export async function crearController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { solicitud_id, valor, descripcion, iva_porcentaje, anticipo_porcentaje, dias_vigencia, metodo_anticipo } = body;

  if (typeof solicitud_id !== 'string' || !solicitud_id.trim()) {
    res.status(400).json({ message: 'solicitud_id es requerido.' });
    return;
  }

  const valorNum = typeof valor === 'number' ? valor : Number(valor);
  if (valor === undefined || valor === null || valor === '' || Number.isNaN(valorNum) || valorNum < 0) {
    res.status(400).json({ message: 'valor es requerido y debe ser un número mayor o igual a 0.' });
    return;
  }

  if (descripcion !== undefined && descripcion !== null && typeof descripcion !== 'string') {
    res.status(400).json({ message: 'descripcion debe ser texto.' });
    return;
  }

  // Los 4 campos siguientes son opcionales (tienen default en el service).
  // Aquí solo se valida el TIPO del dato recibido; el rango/valores
  // permitidos se valida en crearCotizacion().
  if (iva_porcentaje !== undefined && typeof iva_porcentaje !== 'number') {
    res.status(400).json({ message: 'iva_porcentaje debe ser un número.' });
    return;
  }
  if (anticipo_porcentaje !== undefined && typeof anticipo_porcentaje !== 'number') {
    res.status(400).json({ message: 'anticipo_porcentaje debe ser un número.' });
    return;
  }
  if (dias_vigencia !== undefined && typeof dias_vigencia !== 'number') {
    res.status(400).json({ message: 'dias_vigencia debe ser un número.' });
    return;
  }
  if (metodo_anticipo !== undefined && metodo_anticipo !== null && typeof metodo_anticipo !== 'string') {
    res.status(400).json({ message: 'metodo_anticipo debe ser texto.' });
    return;
  }

  const creadoPor = req.user?.sub;
  if (!creadoPor) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    const cotizacion = await crearCotizacion({
      solicitudId: solicitud_id,
      valor: valorNum,
      descripcion: typeof descripcion === 'string' ? descripcion : null,
      creadoPor,
      ivaPorcentaje: iva_porcentaje as number | undefined,
      anticipoPorcentaje: anticipo_porcentaje as number | undefined,
      diasVigencia: dias_vigencia as number | undefined,
      metodoAnticipo: metodo_anticipo as string | null | undefined,
    });
    res.status(201).json({ cotizacion });
  } catch (error) {
    if (error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Solicitud no encontrada.' });
      return;
    }
    if (error instanceof SolicitudNoEnRevisionError) {
      res.status(409).json({ message: 'La solicitud no está en estado EN_REVISION.' });
      return;
    }
    if (error instanceof IvaPorcentajeInvalidoError) {
      res.status(400).json({ message: 'iva_porcentaje inválido. Valores permitidos: 0, 15.' });
      return;
    }
    if (error instanceof AnticipoPorcentajeInvalidoError) {
      res.status(400).json({ message: 'anticipo_porcentaje inválido. Valores permitidos: 0, 50, 75.' });
      return;
    }
    if (error instanceof MetodoAnticipoRequeridoError) {
      res.status(400).json({ message: 'metodo_anticipo es requerido cuando anticipo_porcentaje es mayor a 0.' });
      return;
    }
    if (error instanceof MetodoAnticipoNoPermitidoError) {
      res.status(400).json({ message: 'metodo_anticipo no debe enviarse cuando anticipo_porcentaje es 0.' });
      return;
    }
    if (error instanceof MetodoAnticipoInvalidoError) {
      res.status(400).json({ message: 'metodo_anticipo inválido. Valores permitidos: TRANSFERENCIA, EFECTIVO.' });
      return;
    }
    if (error instanceof DiasVigenciaInvalidoError) {
      res.status(400).json({ message: 'dias_vigencia inválido. Debe ser un entero mayor a 0.' });
      return;
    }
    throw error;
  }
}

// Edición de condiciones comerciales — EXCLUSIVA de BORRADOR (autorización
// explícita — "IMPLEMENTACIÓN AUTORIZADA — EDICIÓN DE COTIZACIONES
// BORRADOR"). Mismas validaciones de tipo que crearController, sin
// solicitud_id (no editable, ver EditarCotizacionBorradorInput) — la
// precondición de estado (solo BORRADOR) la aplica editarCotizacionBorrador()
// mediante el UPDATE condicional del repositorio, nunca aquí.
export async function editarController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const { valor, descripcion, iva_porcentaje, anticipo_porcentaje, dias_vigencia, metodo_anticipo } = body;

  const valorNum = typeof valor === 'number' ? valor : Number(valor);
  if (valor === undefined || valor === null || valor === '' || Number.isNaN(valorNum) || valorNum < 0) {
    res.status(400).json({ message: 'valor es requerido y debe ser un número mayor o igual a 0.' });
    return;
  }

  if (descripcion !== undefined && descripcion !== null && typeof descripcion !== 'string') {
    res.status(400).json({ message: 'descripcion debe ser texto.' });
    return;
  }

  if (iva_porcentaje !== undefined && typeof iva_porcentaje !== 'number') {
    res.status(400).json({ message: 'iva_porcentaje debe ser un número.' });
    return;
  }
  if (anticipo_porcentaje !== undefined && typeof anticipo_porcentaje !== 'number') {
    res.status(400).json({ message: 'anticipo_porcentaje debe ser un número.' });
    return;
  }
  if (dias_vigencia !== undefined && typeof dias_vigencia !== 'number') {
    res.status(400).json({ message: 'dias_vigencia debe ser un número.' });
    return;
  }
  if (metodo_anticipo !== undefined && metodo_anticipo !== null && typeof metodo_anticipo !== 'string') {
    res.status(400).json({ message: 'metodo_anticipo debe ser texto.' });
    return;
  }

  try {
    const cotizacion = await editarCotizacionBorrador(req.params.id, {
      valor: valorNum,
      descripcion: typeof descripcion === 'string' ? descripcion : null,
      ivaPorcentaje: iva_porcentaje as number | undefined,
      anticipoPorcentaje: anticipo_porcentaje as number | undefined,
      diasVigencia: dias_vigencia as number | undefined,
      metodoAnticipo: metodo_anticipo as string | null | undefined,
    });
    res.status(200).json({ cotizacion });
  } catch (error) {
    if (error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof CotizacionNoEditableError) {
      res.status(409).json({ message: 'Solo se puede editar una cotización en estado BORRADOR.' });
      return;
    }
    if (error instanceof IvaPorcentajeInvalidoError) {
      res.status(400).json({ message: 'iva_porcentaje inválido. Valores permitidos: 0, 15.' });
      return;
    }
    if (error instanceof AnticipoPorcentajeInvalidoError) {
      res.status(400).json({ message: 'anticipo_porcentaje inválido. Valores permitidos: 0, 50, 75.' });
      return;
    }
    if (error instanceof MetodoAnticipoRequeridoError) {
      res.status(400).json({ message: 'metodo_anticipo es requerido cuando anticipo_porcentaje es mayor a 0.' });
      return;
    }
    if (error instanceof MetodoAnticipoNoPermitidoError) {
      res.status(400).json({ message: 'metodo_anticipo no debe enviarse cuando anticipo_porcentaje es 0.' });
      return;
    }
    if (error instanceof MetodoAnticipoInvalidoError) {
      res.status(400).json({ message: 'metodo_anticipo inválido. Valores permitidos: TRANSFERENCIA, EFECTIVO.' });
      return;
    }
    if (error instanceof DiasVigenciaInvalidoError) {
      res.status(400).json({ message: 'dias_vigencia inválido. Debe ser un entero mayor a 0.' });
      return;
    }
    throw error;
  }
}

export async function cambiarEstadoController(req: Request, res: Response): Promise<void> {
  const { estado } = (req.body ?? {}) as { estado?: unknown };

  if (typeof estado !== 'string' || !estado.trim()) {
    res.status(400).json({ message: 'estado es requerido.' });
    return;
  }

  try {
    const cotizacion = await cambiarEstadoCotizacion(req.params.id, estado.trim());
    res.status(200).json({ cotizacion });
  } catch (error) {
    if (error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof TransicionInvalidaError) {
      res.status(409).json({ message: 'Transición de estado no permitida.' });
      return;
    }
    if (error instanceof EstadoInvalidoError) {
      res.status(400).json({ message: 'Estado inválido.' });
      return;
    }
    if (error instanceof YaExisteAceptadaError) {
      res.status(409).json({ message: 'Ya existe una cotización ACEPTADA para esta solicitud.' });
      return;
    }
    throw error;
  }
}

// Endpoint interno (ADMIN/COMERCIAL): genera el enlace seguro que el
// comercial comparte manualmente con el cliente (WhatsApp/email, fuera del
// sistema — no se envía nada automáticamente). Devuelve solo el token: la
// URL completa la construye el frontend con su propio origen.
export async function generarEnlaceController(req: Request, res: Response): Promise<void> {
  try {
    const { token, codigo } = await generarEnlaceCotizacion(req.params.id);
    res.status(201).json({ token, codigo });
  } catch (error) {
    if (error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof CotizacionNoDisponibleError) {
      res.status(409).json({ message: 'Solo se puede generar un enlace para una cotización en estado ENVIADA.' });
      return;
    }
    throw error;
  }
}

// Endpoint público (sin requireAuth): SOLO confirma validez del enlace.
// Nunca devuelve datos de la cotización — eso es exclusivo de
// verificarCodigoController, que además exige el código de 6 dígitos.
export async function obtenerPublicaController(req: Request, res: Response): Promise<void> {
  try {
    const resultado = await validarEnlaceCotizacion(req.params.token);
    res.status(200).json(resultado);
  } catch (error) {
    if (error instanceof EnlaceInvalidoError) {
      res.status(401).json({ message: 'Enlace inválido o expirado.' });
      return;
    }
    if (error instanceof CotizacionNoEncontradaError || error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    throw error;
  }
}

// Endpoint público (sin requireAuth): segunda validación mediante código
// de 6 dígitos. El código nunca se registra en logs ni se incluye en
// ninguna respuesta de error — solo se usa para la comparación interna
// contra su hash.
export async function verificarCodigoController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const codigo = body.codigo;

  if (typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
    res.status(400).json({ message: 'codigo es requerido y debe tener 6 dígitos.' });
    return;
  }

  try {
    const cotizacion = await verificarCodigoCotizacion(req.params.token, codigo);
    res.status(200).json({ cotizacion });
  } catch (error) {
    if (error instanceof EnlaceInvalidoError) {
      res.status(401).json({ message: 'Enlace inválido o expirado.' });
      return;
    }
    if (error instanceof DemasiadosIntentosError) {
      res.status(429).json({ message: 'Demasiados intentos. Intente nuevamente más tarde.' });
      return;
    }
    if (error instanceof CodigoInvalidoError) {
      res.status(401).json({ message: 'Código incorrecto.' });
      return;
    }
    if (error instanceof CotizacionNoEncontradaError || error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    throw error;
  }
}

// Endpoint público (sin requireAuth): el cliente acepta la cotización.
// Exige token válido + código de 6 dígitos correcto — nunca alcanza con
// el JWT solo. Reutiliza la misma verificación que verificarCodigoController
// (rate limiting, vencimiento perezoso, comparación contra el hash).
export async function aceptarController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const codigo = extraerCodigoValido(body);

  if (!codigo) {
    res.status(400).json({ message: 'codigo es requerido y debe tener 6 dígitos.' });
    return;
  }

  try {
    const cotizacion = await aceptarCotizacionPublica(req.params.token, codigo);
    res.status(200).json({ cotizacion });
  } catch (error) {
    if (error instanceof EnlaceInvalidoError) {
      res.status(401).json({ message: 'Enlace inválido o expirado.' });
      return;
    }
    if (error instanceof DemasiadosIntentosError) {
      res.status(429).json({ message: 'Demasiados intentos. Intente nuevamente más tarde.' });
      return;
    }
    if (error instanceof CodigoInvalidoError) {
      res.status(401).json({ message: 'Código incorrecto.' });
      return;
    }
    if (error instanceof CotizacionNoEncontradaError || error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof AccionNoPermitidaError) {
      res.status(409).json({ message: 'Esta cotización no está en un estado que permita aceptarla.' });
      return;
    }
    if (error instanceof YaExisteAceptadaError) {
      res.status(409).json({ message: 'Ya existe una cotización ACEPTADA para esta solicitud.' });
      return;
    }
    throw error;
  }
}

// Endpoint público (sin requireAuth): el cliente rechaza la cotización.
// Mismas exigencias que aceptarController.
export async function rechazarController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const codigo = extraerCodigoValido(body);

  if (!codigo) {
    res.status(400).json({ message: 'codigo es requerido y debe tener 6 dígitos.' });
    return;
  }

  try {
    const cotizacion = await rechazarCotizacionPublica(req.params.token, codigo);
    res.status(200).json({ cotizacion });
  } catch (error) {
    if (error instanceof EnlaceInvalidoError) {
      res.status(401).json({ message: 'Enlace inválido o expirado.' });
      return;
    }
    if (error instanceof DemasiadosIntentosError) {
      res.status(429).json({ message: 'Demasiados intentos. Intente nuevamente más tarde.' });
      return;
    }
    if (error instanceof CodigoInvalidoError) {
      res.status(401).json({ message: 'Código incorrecto.' });
      return;
    }
    if (error instanceof CotizacionNoEncontradaError || error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof AccionNoPermitidaError) {
      res.status(409).json({ message: 'Esta cotización no está en un estado que permita rechazarla.' });
      return;
    }
    throw error;
  }
}

// Endpoint público (sin requireAuth): el cliente sube el comprobante de
// transferencia (multipart/form-data, campo "archivo" + campo "codigo").
// La subida se procesa manualmente (en vez de como middleware de ruta)
// para poder responder con mensajes 400 claros ante un archivo inválido o
// demasiado grande, en lugar de caer en el manejador de errores genérico.
export async function subirComprobanteController(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve) => {
    uploadComprobante(req, res, (err: unknown) => {
      procesarComprobante(req, res, err).finally(resolve);
    });
  });
}

// F-02: con `memoryStorage`, `req.file.buffer` vive solo en memoria hasta
// este punto — no se escribe nada a disco todavía. El archivo se escribe
// recién más abajo, DESPUÉS de que `registrarComprobantePublico()` haya
// verificado token + código + estado y haya persistido la referencia en
// BD. Si el código es incorrecto o el estado no lo permite, el buffer se
// descarta sin que el disco llegue a tocarse — ya no hace falta ningún
// `unlink` de limpieza.
async function procesarComprobante(req: Request, res: Response, err: unknown): Promise<void> {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      message: `El archivo excede el tamaño máximo permitido (${COMPROBANTE_MAX_BYTES / (1024 * 1024)} MB).`,
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

  const body = (req.body ?? {}) as Record<string, unknown>;
  const codigo = extraerCodigoValido(body);
  if (!codigo) {
    res.status(400).json({ message: 'codigo es requerido y debe tener 6 dígitos.' });
    return;
  }

  try {
    const nombreArchivo = generarNombreComprobante(req.file.mimetype);
    const cotizacion = await registrarComprobantePublico(req.params.token, codigo, nombreArchivo);
    // Solo se llega aquí si el token+código+estado ya fueron verificados
    // y la referencia quedó persistida en BD — recién ahora se escribe el
    // archivo real a disco.
    await fs.promises.writeFile(path.join(COMPROBANTES_DIR, nombreArchivo), req.file.buffer);
    res.status(200).json({ cotizacion });
  } catch (error) {
    if (error instanceof EnlaceInvalidoError) {
      res.status(401).json({ message: 'Enlace inválido o expirado.' });
      return;
    }
    if (error instanceof DemasiadosIntentosError) {
      res.status(429).json({ message: 'Demasiados intentos. Intente nuevamente más tarde.' });
      return;
    }
    if (error instanceof CodigoInvalidoError) {
      res.status(401).json({ message: 'Código incorrecto.' });
      return;
    }
    if (error instanceof CotizacionNoEncontradaError || error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof AccionNoPermitidaError) {
      res.status(409).json({
        message: 'Solo se puede subir un comprobante para una cotización ACEPTADA, con método TRANSFERENCIA y anticipo PENDIENTE.',
      });
      return;
    }
    console.error('Error no controlado al registrar comprobante:', error instanceof Error ? error.message : error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
}

// Endpoint interno (ADMIN/COMERCIAL): confirma o rechaza el anticipo de
// una cotización ACEPTADA. `req.user.sub` (JWT interno, nunca el token
// público) es quien queda registrado como `anticipo_confirmado_por` —
// un cliente no tiene ninguna vía de alcanzar esta ruta.
export async function gestionarAnticipoController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const accion = body.accion;

  if (accion !== 'VALIDAR' && accion !== 'RECHAZAR') {
    res.status(400).json({ message: 'accion es requerida y debe ser VALIDAR o RECHAZAR.' });
    return;
  }

  const confirmadoPor = req.user?.sub;
  if (!confirmadoPor) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    const cotizacion = await gestionarAnticipo(req.params.id, accion, confirmadoPor);
    res.status(200).json({ cotizacion });
  } catch (error) {
    if (error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof AnticipoNoGestionableError) {
      res.status(409).json({
        message: 'El anticipo de esta cotización no está en un estado que permita esta acción (debe estar ACEPTADA con anticipo PENDIENTE).',
      });
      return;
    }
    throw error;
  }
}

// Endpoint interno (ADMIN/COMERCIAL): descarga el comprobante ya subido.
// La ruta absoluta se construye SIEMPRE a partir de COMPROBANTES_DIR (fijo)
// + el nombre de archivo real leído de la base de datos — el cliente
// nunca provee ni conoce ese nombre, por lo que no puede pedir un archivo
// arbitrario del disco.
export async function descargarComprobanteController(req: Request, res: Response): Promise<void> {
  const nombreArchivo = await obtenerNombreComprobante(req.params.id);
  if (!nombreArchivo) {
    res.status(404).json({ message: 'Esta cotización no tiene comprobante registrado.' });
    return;
  }

  const rutaAbsoluta = path.join(COMPROBANTES_DIR, nombreArchivo);
  res.sendFile(rutaAbsoluta, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ message: 'El archivo del comprobante no se encontró.' });
    }
  });
}

// Endpoint público (sin requireAuth): el cliente sube el comprobante de
// transferencia del SALDO. Mismo patrón exacto que subirComprobanteController
// (F-02: memoryStorage, se escribe a disco solo después de validar en BD),
// reutilizando la misma carpeta/config de multer — es el mismo tipo de
// documento, solo cambia a qué campo de la cotización se asocia.
export async function subirComprobanteSaldoController(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve) => {
    uploadComprobante(req, res, (err: unknown) => {
      procesarComprobanteSaldo(req, res, err).finally(resolve);
    });
  });
}

async function procesarComprobanteSaldo(req: Request, res: Response, err: unknown): Promise<void> {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({
      message: `El archivo excede el tamaño máximo permitido (${COMPROBANTE_MAX_BYTES / (1024 * 1024)} MB).`,
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

  const body = (req.body ?? {}) as Record<string, unknown>;
  const codigo = extraerCodigoValido(body);
  if (!codigo) {
    res.status(400).json({ message: 'codigo es requerido y debe tener 6 dígitos.' });
    return;
  }

  try {
    const nombreArchivo = generarNombreComprobante(req.file.mimetype);
    const cotizacion = await registrarComprobanteSaldoPublico(req.params.token, codigo, nombreArchivo);
    await fs.promises.writeFile(path.join(COMPROBANTES_DIR, nombreArchivo), req.file.buffer);
    res.status(200).json({ cotizacion });
  } catch (error) {
    if (error instanceof EnlaceInvalidoError) {
      res.status(401).json({ message: 'Enlace inválido o expirado.' });
      return;
    }
    if (error instanceof DemasiadosIntentosError) {
      res.status(429).json({ message: 'Demasiados intentos. Intente nuevamente más tarde.' });
      return;
    }
    if (error instanceof CodigoInvalidoError) {
      res.status(401).json({ message: 'Código incorrecto.' });
      return;
    }
    if (error instanceof CotizacionNoEncontradaError || error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof AccionNoPermitidaError) {
      res.status(409).json({
        message: 'Solo se puede subir un comprobante de saldo para una cotización ACEPTADA, con saldo PENDIENTE y sin un método de pago distinto ya definido.',
      });
      return;
    }
    console.error('Error no controlado al registrar comprobante de saldo:', error instanceof Error ? error.message : error);
    res.status(500).json({ message: 'Error interno del servidor.' });
  }
}

// Endpoint interno (ADMIN/COMERCIAL): valida o rechaza el saldo. `metodo`
// solo es obligatorio cuando la cotización aún no tiene un método de
// saldo fijado (caso EFECTIVO); si ya se subió un comprobante de
// transferencia, se ignora cualquier `metodo` distinto a TRANSFERENCIA.
export async function gestionarSaldoController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const accion = body.accion;
  const metodo = body.metodo;

  if (accion !== 'VALIDAR' && accion !== 'RECHAZAR') {
    res.status(400).json({ message: 'accion es requerida y debe ser VALIDAR o RECHAZAR.' });
    return;
  }
  if (metodo !== undefined && metodo !== 'TRANSFERENCIA' && metodo !== 'EFECTIVO') {
    res.status(400).json({ message: 'metodo debe ser TRANSFERENCIA o EFECTIVO.' });
    return;
  }

  const confirmadoPor = req.user?.sub;
  if (!confirmadoPor) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    const cotizacion = await gestionarSaldo(req.params.id, accion, confirmadoPor, metodo as string | undefined);
    res.status(200).json({ cotizacion });
  } catch (error) {
    if (error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof SaldoNoGestionableError) {
      res.status(409).json({
        message: 'El saldo de esta cotización no está en un estado que permita esta acción (debe estar ACEPTADA con saldo PENDIENTE).',
      });
      return;
    }
    if (error instanceof MetodoSaldoRequeridoError) {
      res.status(400).json({ message: 'metodo es requerido cuando el saldo todavía no tiene un método de pago definido.' });
      return;
    }
    if (error instanceof MetodoSaldoInvalidoError) {
      res.status(400).json({ message: 'metodo inválido o distinto al ya definido para esta cotización.' });
      return;
    }
    if (error instanceof ComprobanteSaldoRequeridoError) {
      res.status(409).json({ message: 'El pago por TRANSFERENCIA requiere un comprobante subido antes de validar.' });
      return;
    }
    throw error;
  }
}

// H-E (auditoría post-V9): endpoint dedicado y explícito (no una acción
// más dentro de gestionarSaldoController) para reabrir un saldo
// RECHAZADO. Restringido a ADMIN/COMERCIAL por el middleware de router
// (igual que el resto de este archivo).
export async function reabrirSaldoController(req: Request, res: Response): Promise<void> {
  try {
    const cotizacion = await reabrirSaldo(req.params.id);
    res.status(200).json({ cotizacion });
  } catch (error) {
    if (error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof SaldoNoRechazadoError) {
      res.status(409).json({ message: 'Solo se puede reabrir un saldo que esté RECHAZADO.' });
      return;
    }
    throw error;
  }
}

// Endpoint interno (ADMIN/COMERCIAL): descarga el comprobante de saldo.
// Mismo tratamiento que descargarComprobanteController.
export async function descargarComprobanteSaldoController(req: Request, res: Response): Promise<void> {
  const nombreArchivo = await obtenerNombreComprobanteSaldo(req.params.id);
  if (!nombreArchivo) {
    res.status(404).json({ message: 'Esta cotización no tiene comprobante de saldo registrado.' });
    return;
  }

  const rutaAbsoluta = path.join(COMPROBANTES_DIR, nombreArchivo);
  res.sendFile(rutaAbsoluta, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ message: 'El archivo del comprobante no se encontró.' });
    }
  });
}
