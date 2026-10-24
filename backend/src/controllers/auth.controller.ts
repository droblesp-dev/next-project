import type { Request, Response } from 'express';
import { login, getUsuarioActual } from '../services/auth.service.js';
import {
  cambiarPassword,
  ConfirmacionNoCoincideError,
  DatosCambioPasswordInvalidosError,
  DemasiadosIntentosError,
  FuncionNoDisponibleError,
  PasswordActualIncorrectaError,
  PasswordIgualALaActualError,
  PasswordNoFuerteError,
  UsuarioNoDisponibleError,
} from '../services/cambioPassword.service.js';
import { MENSAJES_PROBLEMA } from '../services/politicaPassword.js';

const MENSAJE_LOGIN_INVALIDO = 'Credenciales inválidas.';

export async function loginController(req: Request, res: Response): Promise<void> {
  const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };

  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    res.status(400).json({ message: 'email y password son requeridos.' });
    return;
  }

  const resultado = await login(email.trim(), password);

  if (!resultado) {
    res.status(401).json({ message: MENSAJE_LOGIN_INVALIDO });
    return;
  }

  res.status(200).json({
    token: resultado.token,
    usuario: resultado.usuario,
  });
}

export async function meController(req: Request, res: Response): Promise<void> {
  const usuarioId = req.user?.sub;

  if (!usuarioId) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  const usuario = await getUsuarioActual(usuarioId);

  if (!usuario) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  res.status(200).json({ usuario });
}

// Fase 2C: cambio de contraseña del usuario AUTENTICADO sobre su propia cuenta (el id sale del
// token, nunca del cuerpo). La contraseña actual incorrecta responde 400 y NO 401: el frontend
// trata cualquier 401 como sesión vencida y cerraría la sesión.
export async function cambiarPasswordController(req: Request, res: Response): Promise<void> {
  const usuarioId = req.user?.sub;
  if (!usuarioId) {
    res.status(401).json({ message: 'No autenticado.' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    const resultado = await cambiarPassword({
      usuarioId,
      passwordActual: body.passwordActual,
      passwordNueva: body.passwordNueva,
      confirmacion: body.confirmacion,
    });
    res.status(200).json({ token: resultado.token, usuario: resultado.usuario });
  } catch (error) {
    if (error instanceof DatosCambioPasswordInvalidosError) {
      res.status(400).json({ message: error.message });
      return;
    }
    if (error instanceof PasswordActualIncorrectaError) {
      res.status(400).json({ message: 'La contraseña actual no es correcta.' });
      return;
    }
    if (error instanceof ConfirmacionNoCoincideError) {
      res.status(400).json({ message: 'La nueva contraseña y su confirmación no coinciden.' });
      return;
    }
    if (error instanceof PasswordIgualALaActualError) {
      res.status(400).json({ message: 'La nueva contraseña debe ser distinta de la actual.' });
      return;
    }
    if (error instanceof PasswordNoFuerteError) {
      res.status(400).json({
        message: 'La nueva contraseña no es lo bastante segura.',
        nivel: error.nivel,
        problemas: error.problemas,
        detalles: error.problemas.map((p) => MENSAJES_PROBLEMA[p]),
      });
      return;
    }
    if (error instanceof DemasiadosIntentosError) {
      res.setHeader('Retry-After', String(error.reintentarEnSegundos));
      res.status(429).json({
        message: 'Demasiados intentos fallidos. Inténtalo de nuevo más tarde.',
        reintentarEnSegundos: error.reintentarEnSegundos,
      });
      return;
    }
    if (error instanceof FuncionNoDisponibleError) {
      res.status(503).json({ message: 'El cambio de contraseña todavía no está disponible en este entorno.' });
      return;
    }
    if (error instanceof UsuarioNoDisponibleError) {
      res.status(401).json({ message: 'No autenticado.' });
      return;
    }
    throw error;
  }
}
