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
  solicitarRecuperacionCodigo,
  verificarRecuperacionCodigo,
  aceptarCotizacionPublica,
  rechazarCotizacionPublica,
  registrarComprobantePublico,
  obtenerNombreComprobante,
  registrarComprobanteSaldoPublico,
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
  SaldoRequiereAnticipoValidadoError,
  ComprobanteYaRecibidoError,
  CotizacionVencidaError,
  CuentaIndicadaInvalidaError,
  type EscrituraArchivo,
  AnticipoNoGestionableError,
  SaldoNoGestionableError,
  MetodoSaldoRequeridoError,
  MetodoSaldoInvalidoError,
  ComprobanteSaldoRequeridoError,
  SaldoNoRechazadoError,
  CotizacionNoEditableError,
} from '../services/cotizaciones.service.js';
import {
  uploadComprobante,
  generarNombreComprobante,
  contenidoComprobanteCoincideConMime,
  COMPROBANTES_DIR,
  COMPROBANTE_MAX_BYTES,
} from '../config/uploadsComprobantes.js';
import {
  enviarEnlaceCotizacion,
  enviarComprobanteRechazado,
  enviarComprobanteRecibido,
  enviarPagoConfirmado,
} from '../services/email.service.js';
import * as cotizacionesRepo from '../repositories/cotizaciones.repository.js';
import { listarCuentasReceptorasActivas } from '../services/cuentasBancarias.service.js';
import { listarConCuentaIndicada } from '../repositories/comprobantesPagoCliente.repository.js';
import {
  registrarGestionPago,
  rechazarPago,
  confirmarAcreditacionDirecta,
  registrarConfirmacionTelefonica,
  obtenerHistorial,
  CotizacionNoAceptadaError,
  ImporteInvalidoError,
  CuentaBancariaInvalidaError,
  MotivoRechazoInvalidoError,
  PagoNoRechazableError,
  PagoNoConfirmableError,
  VerificadorInvalidoError,
  DatosDeGestionInvalidosError,
  AnticipoRequiereComprobanteError,
  AnticipoRequiereRevisionError,
  type DatosDeGestion,
} from '../services/transferenciasPago.service.js';

function extraerCodigoValido(body: Record<string, unknown>): string | null {
  const codigo = body.codigo;
  if (typeof codigo !== 'string' || !/^\d{6}$/.test(codigo)) {
    return null;
  }
  return codigo;
}

// #4: respuesta (410) cuando el enlace público es de una cotización VENCIDA.
const MENSAJE_COTIZACION_VENCIDA = 'Esta cotización caducó. Consulte con su asesor comercial.';

// QA-08: cuenta que el cliente indica al subir un comprobante (opcional, solo informativa). Ausente o vacía = null;
// presente pero sin formato UUID = inválida (undefined).
const UUID_CUENTA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function extraerCuentaIndicada(body: Record<string, unknown>): string | null | undefined {
  const valor = body.cuentaBancariaId;
  if (valor === undefined || valor === null || valor === '') return null;
  return typeof valor === 'string' && UUID_CUENTA.test(valor) ? valor : undefined;
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

// Endpoint interno (ADMIN/COMERCIAL): genera el enlace seguro. El código
// de 6 dígitos sigue siendo exclusivamente para que el comercial lo
// comparta manualmente (WhatsApp/otro canal, fuera del sistema — nunca por
// correo, ver email.service.ts::EnlaceCotizacionInput).
//
// Fase 1 (autorización explícita — "Implementación Fase 1: envío
// automático de cotizaciones por correo"): justo después de que el enlace
// ya se generó con éxito, se envía automáticamente por correo al cliente
// (sin el código). Un fallo de envío NUNCA revierte ni invalida el enlace
// ya generado — este bloque corre después de que `generarEnlaceCotizacion`
// ya resolvió; `emailEnviado` informa al comercial el resultado real
// ('sent'|'failed'|'skipped') para que sepa si debe avisar al cliente por
// otra vía. `enviarEnlaceCotizacion` nunca lanza (ver su documentación).
export async function generarEnlaceController(req: Request, res: Response): Promise<void> {
  try {
    const { token, codigo, destinatario } = await generarEnlaceCotizacion(req.params.id);

    let emailEnviado: 'sent' | 'failed' | 'skipped' = 'skipped';
    if (destinatario) {
      const envio = await enviarEnlaceCotizacion({
        destinatarioEmail: destinatario.email,
        destinatarioNombre: destinatario.nombre,
        solicitudCodigo: destinatario.solicitudCodigo,
        cotizacionCodigo: destinatario.cotizacionCodigo,
        token,
      });
      emailEnviado = envio.estado;
    }

    res.status(201).json({ token, codigo, emailEnviado });
  } catch (error) {
    if (error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    if (error instanceof CotizacionNoDisponibleError) {
      res.status(409).json({ message: 'Solo se puede generar o regenerar un enlace para una cotización en estado ENVIADA o ACEPTADA.' });
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
    if (error instanceof CotizacionVencidaError) {
      res.status(410).json({ message: MENSAJE_COTIZACION_VENCIDA, estado: 'VENCIDA' });
      return;
    }
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
    if (error instanceof CotizacionVencidaError) {
      res.status(410).json({ message: MENSAJE_COTIZACION_VENCIDA, estado: 'VENCIDA' });
      return;
    }
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

// Endpoint público (sin requireAuth) — "Implementación Fase 1: Recuperación
// segura del código de cotización" (autorización explícita). Paso A:
// envía un código temporal de verificación al correo YA REGISTRADO de la
// cotización que identifica el propio token — nunca acepta un correo
// alternativo en el cuerpo de la petición. La respuesta pública es
// siempre uno de 3 valores genéricos ('enviado'/'no_disponible'/
// 'bloqueado'), sin revelar si hay o no un correo asociado ni cuál es.
export async function solicitarRecuperacionCodigoController(req: Request, res: Response): Promise<void> {
  try {
    const estado = await solicitarRecuperacionCodigo(req.params.token);
    res.status(200).json({ estado });
  } catch (error) {
    if (error instanceof CotizacionVencidaError) {
      res.status(410).json({ message: MENSAJE_COTIZACION_VENCIDA, estado: 'VENCIDA' });
      return;
    }
    if (error instanceof EnlaceInvalidoError) {
      res.status(401).json({ message: 'Enlace inválido o expirado.' });
      return;
    }
    if (error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    throw error;
  }
}

// Endpoint público (sin requireAuth) — Paso B + Paso C del mismo bloque:
// verifica el código temporal (OTP) y, solo si coincide y el correo pudo
// enviarse, regenera el código de acceso real. El OTP nunca se registra
// en logs ni se incluye en ninguna respuesta — mismo criterio que el
// código de acceso real.
export async function verificarRecuperacionCodigoController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const otp = body.otp;

  if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
    res.status(400).json({ message: 'otp es requerido y debe tener 6 dígitos.' });
    return;
  }

  try {
    const estado = await verificarRecuperacionCodigo(req.params.token, otp);
    res.status(200).json({ estado });
  } catch (error) {
    if (error instanceof CotizacionVencidaError) {
      res.status(410).json({ message: MENSAJE_COTIZACION_VENCIDA, estado: 'VENCIDA' });
      return;
    }
    if (error instanceof EnlaceInvalidoError) {
      res.status(401).json({ message: 'Enlace inválido o expirado.' });
      return;
    }
    if (error instanceof CotizacionNoEncontradaError) {
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
    if (error instanceof CotizacionVencidaError) {
      res.status(410).json({ message: MENSAJE_COTIZACION_VENCIDA, estado: 'VENCIDA' });
      return;
    }
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
    if (error instanceof CotizacionVencidaError) {
      res.status(410).json({ message: MENSAJE_COTIZACION_VENCIDA, estado: 'VENCIDA' });
      return;
    }
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
// Escritura/limpieza del archivo del comprobante (se ejecuta dentro de la transacción del servicio).
function escrituraComprobante(nombreArchivo: string, buffer: Buffer): EscrituraArchivo {
  const ruta = path.join(COMPROBANTES_DIR, nombreArchivo);
  return {
    escribir: () => fs.promises.writeFile(ruta, buffer),
    deshacer: () => fs.promises.unlink(ruta),
  };
}

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

  if (!contenidoComprobanteCoincideConMime(req.file.buffer, req.file.mimetype)) {
    res.status(400).json({ message: 'El contenido del archivo no corresponde a un PDF, JPG o PNG válido.' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const codigo = extraerCodigoValido(body);
  if (!codigo) {
    res.status(400).json({ message: 'codigo es requerido y debe tener 6 dígitos.' });
    return;
  }
  const cuentaIndicada = extraerCuentaIndicada(body);
  if (cuentaIndicada === undefined) {
    res.status(400).json({ message: 'cuentaBancariaId no es válido.' });
    return;
  }

  try {
    const nombreArchivo = generarNombreComprobante(req.file.mimetype);
    // El archivo se escribe dentro de la transacción del servicio, solo después de verificar token +
    // código + estado (F-02) y antes del COMMIT: si la escritura falla no queda ninguna referencia.
    const cotizacion = await registrarComprobantePublico(
      req.params.token,
      codigo,
      nombreArchivo,
      escrituraComprobante(nombreArchivo, (req.file as Express.Multer.File).buffer),
      cuentaIndicada
    );
    res.status(200).json({ cotizacion });
    // Mejora 5: aviso de «comprobante recibido» (solo informa la recepción; no dice que esté aceptado ni acreditado).
    // Va DESPUÉS de responder y nunca modifica la respuesta ni el estado: un fallo de correo solo se registra.
    await notificarCliente(cotizacion.id, { tipo: 'ANTICIPO', evento: 'RECIBIDO' });
  } catch (error) {
    if (error instanceof CotizacionVencidaError) {
      res.status(410).json({ message: MENSAJE_COTIZACION_VENCIDA, estado: 'VENCIDA' });
      return;
    }
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
    if (error instanceof CuentaIndicadaInvalidaError) {
      res.status(400).json({ message: 'La cuenta indicada no está disponible. Elija una de las cuentas mostradas.' });
      return;
    }
    if (error instanceof ComprobanteYaRecibidoError) {
      res.status(409).json({ message: 'Ya recibimos tu comprobante y está en revisión. No es necesario enviarlo de nuevo.' });
      return;
    }
    if (error instanceof AccionNoPermitidaError) {
      res.status(409).json({
        message: 'Solo se puede subir un comprobante para una cotización ACEPTADA, con método TRANSFERENCIA y anticipo pendiente o rechazado.',
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
const ACCIONES_PAGO = ['VALIDAR', 'RECHAZAR', 'GESTIONAR', 'CONFIRMAR_TELEFONICA'] as const;
type AccionPago = (typeof ACCIONES_PAGO)[number];

// «Dinero acreditado» es el nombre con el que la interfaz presenta la acción CONFIRMAR_TELEFONICA (COMERCIAL registra
// que ADMIN le confirmó por teléfono que el dinero ingresó). Se acepta como alias: el contrato anterior no cambia.
function normalizarAccionPago(accion: unknown): unknown {
  return accion === 'DINERO_ACREDITADO' ? 'CONFIRMAR_TELEFONICA' : accion;
}
const MENSAJE_ACCION_PAGO = `accion es requerida y debe ser una de: ${ACCIONES_PAGO.join(', ')} (o DINERO_ACREDITADO, alias de CONFIRMAR_TELEFONICA).`;

// Datos opcionales de trazabilidad de la gestión (V20): observaciones, hora REAL de la llamada con ADMIN (solo si se
// conoce) y `seguimiento` (ADMIN sin respuesta / el dinero todavía no aparece: exige observación y el pago sigue
// PENDIENTE). La validación de fondo (largo, fecha futura, observación obligatoria) vive en el servicio.
function leerDatosDeGestion(body: Record<string, unknown>): DatosDeGestion {
  const { observaciones, llamadaEn, seguimiento } = body;
  if (observaciones !== undefined && observaciones !== null && typeof observaciones !== 'string') {
    throw new DatosDeGestionInvalidosError('observaciones debe ser texto.');
  }
  if (seguimiento !== undefined && typeof seguimiento !== 'boolean') {
    throw new DatosDeGestionInvalidosError('seguimiento debe ser verdadero o falso.');
  }
  if (llamadaEn !== undefined && llamadaEn !== null && llamadaEn !== '' && typeof llamadaEn !== 'string') {
    throw new DatosDeGestionInvalidosError('llamadaEn debe ser una fecha y hora en texto ISO 8601.');
  }
  return {
    observaciones: (observaciones as string | null | undefined) ?? null,
    llamadaEn: typeof llamadaEn === 'string' && llamadaEn !== '' ? new Date(llamadaEn) : null,
    seguimiento: seguimiento === true,
  };
}

function manejarErrorTransferencia(error: unknown, res: Response): boolean {
  if (error instanceof CotizacionNoEncontradaError) {
    res.status(404).json({ message: 'Cotización no encontrada.' });
    return true;
  }
  if (error instanceof CotizacionNoAceptadaError) {
    res.status(409).json({ message: 'La cotización debe estar ACEPTADA para gestionar un pago.' });
    return true;
  }
  if (error instanceof ImporteInvalidoError) {
    res.status(400).json({ message: 'importeDeclarado debe ser un número mayor que cero.' });
    return true;
  }
  if (error instanceof CuentaBancariaInvalidaError) {
    res.status(400).json({ message: 'cuentaBancariaId no corresponde a ninguna cuenta bancaria existente y activa.' });
    return true;
  }
  if (error instanceof MotivoRechazoInvalidoError) {
    res.status(400).json({ message: error.message });
    return true;
  }
  if (error instanceof PagoNoRechazableError || error instanceof PagoNoConfirmableError) {
    res.status(409).json({
      message: 'El pago de esta cotización no está en un estado que permita esta acción (debe estar ACEPTADA con el pago PENDIENTE).',
    });
    return true;
  }
  if (error instanceof VerificadorInvalidoError) {
    res.status(400).json({ message: error.message });
    return true;
  }
  if (error instanceof MetodoSaldoRequeridoError) {
    res.status(400).json({ message: 'metodo es requerido cuando el saldo todavía no tiene un método de pago definido.' });
    return true;
  }
  if (error instanceof MetodoSaldoInvalidoError) {
    res.status(400).json({ message: 'metodo inválido o distinto al ya definido para esta cotización.' });
    return true;
  }
  if (error instanceof ComprobanteSaldoRequeridoError) {
    res.status(409).json({ message: 'El pago por TRANSFERENCIA requiere un comprobante subido antes de validar.' });
    return true;
  }
  // Regla F1: el saldo no se gestiona mientras el anticipo esté PENDIENTE, RECHAZADO o sin definir.
  // Debe ir antes que AccionNoPermitidaError (su clase base) para conservar el mensaje específico.
  if (error instanceof SaldoRequiereAnticipoValidadoError) {
    res.status(409).json({
      message: 'El saldo no puede gestionarse mientras el anticipo no esté VALIDADO o NO_APLICA.',
    });
    return true;
  }
  if (error instanceof AnticipoRequiereComprobanteError) {
    res.status(409).json({
      message: 'Para registrar «Dinero acreditado» de un anticipo por TRANSFERENCIA el cliente debe haber subido el comprobante.',
    });
    return true;
  }
  if (error instanceof AnticipoRequiereRevisionError) {
    res.status(409).json({
      message: 'Registre primero la revisión (gestión) del comprobante antes de confirmar el dinero acreditado o de anotar un seguimiento.',
    });
    return true;
  }
  if (error instanceof DatosDeGestionInvalidosError) {
    res.status(400).json({ message: error.message });
    return true;
  }
  if (error instanceof AccionNoPermitidaError) {
    res.status(409).json({ message: 'La acción no está permitida en el estado actual de la cotización.' });
    return true;
  }
  return false;
}

// Avisa al cliente por correo de un cambio en su pago. Se invoca SOLO después de que la transición ya
// quedó confirmada en la BD (rechazarPago / confirmación de acreditación), por lo que cada evento
// ocurre una única vez (una segunda acción sobre el mismo pago responde 409 y no llega aquí). Un fallo
// de correo o de lectura NUNCA modifica ni revierte el estado del pago: solo se registra.
async function notificarCliente(
  cotizacionId: string,
  aviso:
    | { tipo: 'ANTICIPO' | 'SALDO'; evento: 'CONFIRMADO' }
    | { tipo: 'ANTICIPO' | 'SALDO'; evento: 'RECIBIDO' }
    | { tipo: 'ANTICIPO' | 'SALDO'; evento: 'RECHAZADO'; motivo: string; detalle: string | null }
): Promise<void> {
  try {
    const contacto = await cotizacionesRepo.obtenerContactoParaCorreo(cotizacionId);
    const email = contacto?.clienteEmail.trim();
    if (!contacto || !email) return;

    const base = {
      destinatarioEmail: email,
      destinatarioNombre: contacto.clienteNombre,
      solicitudCodigo: contacto.solicitudCodigo,
      cotizacionCodigo: contacto.cotizacionCodigo,
      tipoPago: aviso.tipo,
    };
    if (aviso.evento === 'RECHAZADO') {
      await enviarComprobanteRechazado({ ...base, motivo: aviso.motivo, detalle: aviso.detalle });
    } else if (aviso.evento === 'RECIBIDO') {
      await enviarComprobanteRecibido(base);
    } else {
      await enviarPagoConfirmado(base);
    }
  } catch (error) {
    console.error('[EMAIL] No se pudo notificar el cambio de pago:', error instanceof Error ? error.message : error);
  }
}

export async function gestionarAnticipoController(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const accion = normalizarAccionPago(body.accion);

  if (typeof accion !== 'string' || !ACCIONES_PAGO.includes(accion as AccionPago)) {
    res.status(400).json({ message: MENSAJE_ACCION_PAGO });
    return;
  }

  const usuarioId = req.user?.sub;
  const rol = req.user?.rol;
  if (!usuarioId || !rol) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  // PC-2026-01, Etapa 4: separación de permisos — rechazo documental
  // exclusivo de COMERCIAL, confirmación de acreditación directa exclusiva
  // de ADMIN y registro de confirmación telefónica exclusivo de COMERCIAL.
  // GESTIONAR (registrar/revisar comprobante) sigue abierto a ambos, igual
  // que el acceso de hoy a este endpoint.
  if (accion === 'RECHAZAR' && rol !== 'COMERCIAL') {
    res.status(403).json({ message: 'Solo COMERCIAL puede rechazar un comprobante.' });
    return;
  }
  if (accion === 'VALIDAR' && rol !== 'ADMIN') {
    res.status(403).json({ message: 'Solo ADMIN puede confirmar directamente la acreditación del pago.' });
    return;
  }
  if (accion === 'CONFIRMAR_TELEFONICA' && rol !== 'COMERCIAL') {
    res.status(403).json({ message: 'Solo COMERCIAL puede registrar una confirmación telefónica.' });
    return;
  }

  try {
    const datos = leerDatosDeGestion(body);
    if (accion === 'VALIDAR' || accion === 'RECHAZAR') {
      // Mantiene exactamente el contrato de respuesta ya existente —
      // `{ cotizacion }` — para no romper al frontend actual.
      if (accion === 'VALIDAR') {
        await confirmarAcreditacionDirecta({ cotizacionId: req.params.id, tipoPago: 'ANTICIPO', adminId: usuarioId, ...datos });
        await notificarCliente(req.params.id, { tipo: 'ANTICIPO', evento: 'CONFIRMADO' });
      } else {
        const motivoRechazo = body.motivoRechazo;
        const motivoRechazoDetalle = body.motivoRechazoDetalle;
        if (typeof motivoRechazo !== 'string') {
          res.status(400).json({ message: 'motivoRechazo es requerido para rechazar.' });
          return;
        }
        await rechazarPago({
          cotizacionId: req.params.id,
          tipoPago: 'ANTICIPO',
          motivoRechazo,
          motivoRechazoDetalle: typeof motivoRechazoDetalle === 'string' ? motivoRechazoDetalle : null,
          rechazadoPor: usuarioId,
          ...datos,
        });
        await notificarCliente(req.params.id, {
          tipo: 'ANTICIPO',
          evento: 'RECHAZADO',
          motivo: motivoRechazo,
          detalle: typeof motivoRechazoDetalle === 'string' ? motivoRechazoDetalle : null,
        });
      }
      const cotizacion = await obtenerCotizacion(req.params.id);
      res.status(200).json({ cotizacion });
      return;
    }

    if (accion === 'GESTIONAR') {
      const importeDeclarado = Number(body.importeDeclarado);
      const transferencia = await registrarGestionPago({
        cotizacionId: req.params.id,
        tipoPago: 'ANTICIPO',
        importeDeclarado,
        bancoOrigen: typeof body.bancoOrigen === 'string' ? body.bancoOrigen : null,
        referenciaBancaria: typeof body.referenciaBancaria === 'string' ? body.referenciaBancaria : null,
        cuentaBancariaId: typeof body.cuentaBancariaId === 'string' ? body.cuentaBancariaId : null,
        gestionadoPor: usuarioId,
        ...datos,
      });
      const cotizacion = await obtenerCotizacion(req.params.id);
      res.status(200).json({ cotizacion, transferencia });
      return;
    }

    // CONFIRMAR_TELEFONICA
    const verificadorId = body.verificadorId;
    if (typeof verificadorId !== 'string') {
      res.status(400).json({ message: 'verificadorId es requerido.' });
      return;
    }
    const transferencia = await registrarConfirmacionTelefonica({
      cotizacionId: req.params.id,
      tipoPago: 'ANTICIPO',
      verificadorId,
      registradoPor: usuarioId,
      ...datos,
    });
    await notificarCliente(req.params.id, { tipo: 'ANTICIPO', evento: 'CONFIRMADO' });
    const cotizacion = await obtenerCotizacion(req.params.id);
    res.status(200).json({ cotizacion, transferencia });
  } catch (error) {
    if (manejarErrorTransferencia(error, res)) return;
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

  if (!contenidoComprobanteCoincideConMime(req.file.buffer, req.file.mimetype)) {
    res.status(400).json({ message: 'El contenido del archivo no corresponde a un PDF, JPG o PNG válido.' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const codigo = extraerCodigoValido(body);
  if (!codigo) {
    res.status(400).json({ message: 'codigo es requerido y debe tener 6 dígitos.' });
    return;
  }
  const cuentaIndicada = extraerCuentaIndicada(body);
  if (cuentaIndicada === undefined) {
    res.status(400).json({ message: 'cuentaBancariaId no es válido.' });
    return;
  }

  try {
    const nombreArchivo = generarNombreComprobante(req.file.mimetype);
    const cotizacion = await registrarComprobanteSaldoPublico(
      req.params.token,
      codigo,
      nombreArchivo,
      escrituraComprobante(nombreArchivo, (req.file as Express.Multer.File).buffer),
      cuentaIndicada
    );
    res.status(200).json({ cotizacion });
    // Mejora 5: aviso de «comprobante recibido» (solo informa la recepción; no dice que esté aceptado ni acreditado).
    // Va DESPUÉS de responder y nunca modifica la respuesta ni el estado: un fallo de correo solo se registra.
    await notificarCliente(cotizacion.id, { tipo: 'SALDO', evento: 'RECIBIDO' });
  } catch (error) {
    if (error instanceof CotizacionVencidaError) {
      res.status(410).json({ message: MENSAJE_COTIZACION_VENCIDA, estado: 'VENCIDA' });
      return;
    }
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
    if (error instanceof SaldoRequiereAnticipoValidadoError) {
      res.status(409).json({
        message: 'Podrás subir el comprobante del saldo cuando tu anticipo haya sido validado por nuestro equipo.',
      });
      return;
    }
    if (error instanceof CuentaIndicadaInvalidaError) {
      res.status(400).json({ message: 'La cuenta indicada no está disponible. Elija una de las cuentas mostradas.' });
      return;
    }
    if (error instanceof ComprobanteYaRecibidoError) {
      res.status(409).json({ message: 'Ya recibimos tu comprobante y está en revisión. No es necesario enviarlo de nuevo.' });
      return;
    }
    if (error instanceof AccionNoPermitidaError) {
      res.status(409).json({
        message: 'Solo se puede subir un comprobante de saldo para una cotización ACEPTADA, con saldo pendiente o rechazado y sin un método de pago distinto ya definido.',
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
  const accion = normalizarAccionPago(body.accion);
  const metodo = body.metodo;

  if (typeof accion !== 'string' || !ACCIONES_PAGO.includes(accion as AccionPago)) {
    res.status(400).json({ message: MENSAJE_ACCION_PAGO });
    return;
  }
  if (metodo !== undefined && metodo !== 'TRANSFERENCIA' && metodo !== 'EFECTIVO') {
    res.status(400).json({ message: 'metodo debe ser TRANSFERENCIA o EFECTIVO.' });
    return;
  }

  const usuarioId = req.user?.sub;
  const rol = req.user?.rol;
  if (!usuarioId || !rol) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  if (accion === 'RECHAZAR' && rol !== 'COMERCIAL') {
    res.status(403).json({ message: 'Solo COMERCIAL puede rechazar un comprobante.' });
    return;
  }
  if (accion === 'VALIDAR' && rol !== 'ADMIN') {
    res.status(403).json({ message: 'Solo ADMIN puede confirmar directamente la acreditación del pago.' });
    return;
  }
  if (accion === 'CONFIRMAR_TELEFONICA' && rol !== 'COMERCIAL') {
    res.status(403).json({ message: 'Solo COMERCIAL puede registrar una confirmación telefónica.' });
    return;
  }

  try {
    const datos = leerDatosDeGestion(body);
    if (accion === 'VALIDAR' || accion === 'RECHAZAR') {
      if (accion === 'VALIDAR') {
        await confirmarAcreditacionDirecta({
          cotizacionId: req.params.id,
          tipoPago: 'SALDO',
          adminId: usuarioId,
          metodoSaldo: metodo as string | undefined,
          ...datos,
        });
        await notificarCliente(req.params.id, { tipo: 'SALDO', evento: 'CONFIRMADO' });
      } else {
        const motivoRechazo = body.motivoRechazo;
        const motivoRechazoDetalle = body.motivoRechazoDetalle;
        if (typeof motivoRechazo !== 'string') {
          res.status(400).json({ message: 'motivoRechazo es requerido para rechazar.' });
          return;
        }
        await rechazarPago({
          cotizacionId: req.params.id,
          tipoPago: 'SALDO',
          motivoRechazo,
          motivoRechazoDetalle: typeof motivoRechazoDetalle === 'string' ? motivoRechazoDetalle : null,
          rechazadoPor: usuarioId,
          ...datos,
        });
        await notificarCliente(req.params.id, {
          tipo: 'SALDO',
          evento: 'RECHAZADO',
          motivo: motivoRechazo,
          detalle: typeof motivoRechazoDetalle === 'string' ? motivoRechazoDetalle : null,
        });
      }
      const cotizacion = await obtenerCotizacion(req.params.id);
      res.status(200).json({ cotizacion });
      return;
    }

    if (accion === 'GESTIONAR') {
      const importeDeclarado = Number(body.importeDeclarado);
      const transferencia = await registrarGestionPago({
        cotizacionId: req.params.id,
        tipoPago: 'SALDO',
        importeDeclarado,
        bancoOrigen: typeof body.bancoOrigen === 'string' ? body.bancoOrigen : null,
        referenciaBancaria: typeof body.referenciaBancaria === 'string' ? body.referenciaBancaria : null,
        cuentaBancariaId: typeof body.cuentaBancariaId === 'string' ? body.cuentaBancariaId : null,
        gestionadoPor: usuarioId,
        ...datos,
      });
      const cotizacion = await obtenerCotizacion(req.params.id);
      res.status(200).json({ cotizacion, transferencia });
      return;
    }

    // CONFIRMAR_TELEFONICA
    const verificadorId = body.verificadorId;
    if (typeof verificadorId !== 'string') {
      res.status(400).json({ message: 'verificadorId es requerido.' });
      return;
    }
    const transferencia = await registrarConfirmacionTelefonica({
      cotizacionId: req.params.id,
      tipoPago: 'SALDO',
      verificadorId,
      registradoPor: usuarioId,
      metodoSaldo: metodo as string | undefined,
      ...datos,
    });
    await notificarCliente(req.params.id, { tipo: 'SALDO', evento: 'CONFIRMADO' });
    const cotizacion = await obtenerCotizacion(req.params.id);
    res.status(200).json({ cotizacion, transferencia });
  } catch (error) {
    if (manejarErrorTransferencia(error, res)) return;
    if (error instanceof SaldoNoGestionableError) {
      res.status(409).json({
        message: 'El saldo de esta cotización no está en un estado que permita esta acción (debe estar ACEPTADA con saldo PENDIENTE).',
      });
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
    if (error instanceof SaldoRequiereAnticipoValidadoError) {
      res.status(409).json({
        message: 'El saldo no puede gestionarse mientras el anticipo no esté VALIDADO o NO_APLICA.',
      });
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

// PC-2026-01, Etapa 4: historial completo de intentos de pago (ambos
// tipos, vigentes y no vigentes) de una cotización — nunca filtra nada,
// conserva los intentos anteriores tal como pide la propuesta.
export async function historialTransferenciasController(req: Request, res: Response): Promise<void> {
  try {
    const transferencias = await obtenerHistorial(req.params.id);
    // QA-08: comprobantes que subió el cliente y la cuenta que indicó (informativa; la real la confirma COMERCIAL).
    const comprobantes_cliente = await listarConCuentaIndicada(req.params.id);
    res.status(200).json({ transferencias, comprobantes_cliente });
  } catch (error) {
    if (error instanceof CotizacionNoEncontradaError) {
      res.status(404).json({ message: 'Cotización no encontrada.' });
      return;
    }
    throw error;
  }
}

// PC-2026-01: cuentas bancarias activas que el personal puede elegir como
// cuenta receptora al gestionar un pago (anticipo o saldo). Lectura únicamente.
// Acceso: ADMIN y COMERCIAL, heredado del middleware de router de
// cotizaciones.routes.ts (OPERATIVO nunca alcanza este router); no se amplían
// los permisos del router administrativo de cuentas (exclusivo de ADMIN). Solo
// id, banco, tipo y número — ver listarCuentasReceptorasActivas().
export async function listarCuentasReceptorasController(_req: Request, res: Response): Promise<void> {
  const cuentas = await listarCuentasReceptorasActivas();
  res.status(200).json({ cuentas });
}
