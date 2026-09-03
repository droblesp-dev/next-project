import type { Request, Response } from 'express';
import { login, getUsuarioActual } from '../services/auth.service.js';

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
