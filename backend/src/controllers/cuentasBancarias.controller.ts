import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import {
  listarCuentasBancarias,
  obtenerCuentaBancaria,
  crearCuentaBancaria,
  editarCuentaBancaria,
  cambiarActivoCuentaBancaria,
  CuentaBancariaNoEncontradaError,
  TipoCuentaInvalidoError,
  DatosCuentaBancariaInvalidosError,
  BancoRequeridoError,
  BancoCatalogoInvalidoError,
  type LogoPendiente,
} from '../services/cuentasBancarias.service.js';
import { listarBancosCatalogo, TipoEntidadInvalidoError } from '../services/bancosCatalogo.service.js';
import {
  uploadLogoBanco,
  generarNombreLogoBanco,
  contenidoRealCoincideConMime,
  LOGOS_BANCOS_DIR,
  LOGO_BANCO_MAX_BYTES,
} from '../config/uploadsLogosBancos.js';

// PC-2026-01 (Fase D): el logo se sirve como archivo estático público
// (server.ts: app.use('/uploads/logos-bancos', express.static(...))) — el
// nombre de archivo ya es un UUID generado por el servidor, nunca el
// nombre original del cliente, así que no hay riesgo de ruta arbitraria.
function construirLogoUrl(logoPath: string | null): string | null {
  return logoPath ? `/uploads/logos-bancos/${logoPath}` : null;
}

// La cuenta individual (obtener/crear/editar) nunca expone el nombre de archivo
// crudo del logo propio: solo si lo tiene.
function aRespuestaCuenta<T extends { logo_propio_path: string | null }>(cuenta: T) {
  const { logo_propio_path, ...resto } = cuenta;
  return { ...resto, logo_propio: logo_propio_path !== null };
}

export async function listarController(_req: Request, res: Response): Promise<void> {
  const cuentas = await listarCuentasBancarias();
  res.status(200).json({
    // logo_url = logo efectivo (propio o heredado); logo_propio indica si la
    // cuenta tiene uno propio (V17) — la UI lo usa para ofrecer «Quitar». Los
    // nombres de archivo crudos nunca salen en la respuesta.
    cuentas: cuentas.map(({ logo_path, logo_propio_path, ...resto }) => ({
      ...resto,
      logo_url: construirLogoUrl(logo_path),
      logo_propio: logo_propio_path !== null,
    })),
  });
}

export async function listarBancosCatalogoController(_req: Request, res: Response): Promise<void> {
  const bancos = await listarBancosCatalogo();
  res.status(200).json({
    bancos: bancos.map((b) => ({
      id: b.id,
      nombre: b.nombre,
      tipo: b.tipo,
      logo_url: construirLogoUrl(b.logo_path),
    })),
  });
}

export async function obtenerController(req: Request, res: Response): Promise<void> {
  try {
    const cuenta = await obtenerCuentaBancaria(req.params.id);
    res.status(200).json({ cuenta: aRespuestaCuenta(cuenta) });
  } catch (error) {
    if (error instanceof CuentaBancariaNoEncontradaError) {
      res.status(404).json({ message: 'Cuenta bancaria no encontrada.' });
      return;
    }
    throw error;
  }
}

// multipart/form-data: campos de texto en req.body (multer los deja como
// string), `logo` como archivo opcional en req.file (memoryStorage: nunca
// se escribe a disco hasta que la fila de BD ya se confirmó).
function extraerCamposFormulario(body: Record<string, unknown>) {
  const leerTexto = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  const leerBooleano = (v: unknown): boolean | undefined => {
    if (v === 'true' || v === true) return true;
    if (v === 'false' || v === false) return false;
    return undefined;
  };
  return {
    titular: leerTexto(body.titular),
    tipoCuenta: leerTexto(body.tipoCuenta),
    numeroCuenta: leerTexto(body.numeroCuenta),
    bancoCatalogoId: leerTexto(body.bancoCatalogoId) ?? null,
    bancoPersonalizadoNombre: leerTexto(body.bancoPersonalizadoNombre) ?? null,
    tipoEntidad: leerTexto(body.tipoEntidad),
    titularVisibleCliente: leerBooleano(body.titularVisibleCliente),
    activo: leerBooleano(body.activo),
    quitarLogo: leerBooleano(body.quitarLogo) ?? false,
  };
}

async function procesarLogoSubido(req: Request): Promise<{ logo: LogoPendiente | null; error?: string }> {
  if (!req.file) {
    return { logo: null };
  }
  if (!contenidoRealCoincideConMime(req.file.buffer, req.file.mimetype)) {
    return { logo: null, error: 'El contenido del archivo no corresponde a una imagen PNG o JPEG válida.' };
  }
  const nombreArchivo = generarNombreLogoBanco(req.file.mimetype);
  return { logo: { nombreArchivo, buffer: req.file.buffer } };
}

async function escribirLogoPendiente(logo: LogoPendiente | null): Promise<void> {
  if (!logo) return;
  await fs.promises.writeFile(path.join(LOGOS_BANCOS_DIR, logo.nombreArchivo), logo.buffer);
}

function manejarErrorCuentaBancaria(error: unknown, res: Response): boolean {
  if (error instanceof TipoCuentaInvalidoError || error instanceof DatosCuentaBancariaInvalidosError) {
    res.status(400).json({ message: error.message });
    return true;
  }
  if (error instanceof BancoRequeridoError || error instanceof BancoCatalogoInvalidoError) {
    res.status(400).json({ message: error.message });
    return true;
  }
  if (error instanceof TipoEntidadInvalidoError) {
    res.status(400).json({ message: error.message });
    return true;
  }
  if (error instanceof CuentaBancariaNoEncontradaError) {
    res.status(404).json({ message: 'Cuenta bancaria no encontrada.' });
    return true;
  }
  return false;
}

export async function crearController(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve) => {
    uploadLogoBanco(req, res, (err: unknown) => {
      procesarCrear(req, res, err).finally(resolve);
    });
  });
}

async function procesarCrear(req: Request, res: Response, err: unknown): Promise<void> {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ message: `El logo excede el tamaño máximo permitido (${LOGO_BANCO_MAX_BYTES / (1024 * 1024)} MB).` });
    return;
  }
  if (err) {
    res.status(400).json({ message: 'No se pudo procesar el archivo de logo.' });
    return;
  }

  const campos = extraerCamposFormulario((req.body ?? {}) as Record<string, unknown>);
  if (!campos.titular || !campos.tipoCuenta || !campos.numeroCuenta) {
    res.status(400).json({ message: 'titular, tipoCuenta y numeroCuenta son requeridos.' });
    return;
  }

  const { logo, error: errorLogo } = await procesarLogoSubido(req);
  if (errorLogo) {
    res.status(400).json({ message: errorLogo });
    return;
  }

  const creadoPor = req.user?.sub;
  if (!creadoPor) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    const { cuenta, archivoLogoAEscribir } = await crearCuentaBancaria(
      {
        titular: campos.titular,
        tipoCuenta: campos.tipoCuenta,
        numeroCuenta: campos.numeroCuenta,
        bancoCatalogoId: campos.bancoCatalogoId,
        bancoPersonalizadoNombre: campos.bancoPersonalizadoNombre,
        tipoEntidad: campos.tipoEntidad,
        titularVisibleCliente: campos.titularVisibleCliente,
        activo: campos.activo,
        logo,
        quitarLogo: campos.quitarLogo,
      },
      creadoPor
    );
    await escribirLogoPendiente(archivoLogoAEscribir);
    res.status(201).json({ cuenta: aRespuestaCuenta(cuenta) });
  } catch (error) {
    if (manejarErrorCuentaBancaria(error, res)) return;
    throw error;
  }
}

export async function editarController(req: Request, res: Response): Promise<void> {
  await new Promise<void>((resolve) => {
    uploadLogoBanco(req, res, (err: unknown) => {
      procesarEditar(req, res, err).finally(resolve);
    });
  });
}

async function procesarEditar(req: Request, res: Response, err: unknown): Promise<void> {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ message: `El logo excede el tamaño máximo permitido (${LOGO_BANCO_MAX_BYTES / (1024 * 1024)} MB).` });
    return;
  }
  if (err) {
    res.status(400).json({ message: 'No se pudo procesar el archivo de logo.' });
    return;
  }

  const campos = extraerCamposFormulario((req.body ?? {}) as Record<string, unknown>);
  if (!campos.titular || !campos.tipoCuenta || !campos.numeroCuenta) {
    res.status(400).json({ message: 'titular, tipoCuenta y numeroCuenta son requeridos.' });
    return;
  }

  const { logo, error: errorLogo } = await procesarLogoSubido(req);
  if (errorLogo) {
    res.status(400).json({ message: errorLogo });
    return;
  }

  const editadoPor = req.user?.sub;
  if (!editadoPor) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  try {
    const { cuenta, archivoLogoAEscribir } = await editarCuentaBancaria(
      req.params.id,
      {
        titular: campos.titular,
        tipoCuenta: campos.tipoCuenta,
        numeroCuenta: campos.numeroCuenta,
        bancoCatalogoId: campos.bancoCatalogoId,
        bancoPersonalizadoNombre: campos.bancoPersonalizadoNombre,
        tipoEntidad: campos.tipoEntidad,
        titularVisibleCliente: campos.titularVisibleCliente,
        logo,
        quitarLogo: campos.quitarLogo,
      },
      editadoPor
    );
    await escribirLogoPendiente(archivoLogoAEscribir);
    res.status(200).json({ cuenta: aRespuestaCuenta(cuenta) });
  } catch (error) {
    if (manejarErrorCuentaBancaria(error, res)) return;
    throw error;
  }
}

export async function cambiarActivoController(req: Request, res: Response): Promise<void> {
  const { activo } = (req.body ?? {}) as { activo?: unknown };
  if (typeof activo !== 'boolean') {
    res.status(400).json({ message: 'activo debe ser un valor booleano.' });
    return;
  }

  try {
    const cuenta = await cambiarActivoCuentaBancaria(req.params.id, activo);
    res.status(200).json({ cuenta: aRespuestaCuenta(cuenta) });
  } catch (error) {
    if (error instanceof CuentaBancariaNoEncontradaError) {
      res.status(404).json({ message: 'Cuenta bancaria no encontrada.' });
      return;
    }
    throw error;
  }
}
