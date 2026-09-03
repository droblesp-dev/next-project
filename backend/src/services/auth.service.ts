import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import {
  findByEmailWithRol,
  findByIdWithRol,
  type UsuarioPublico,
} from '../repositories/usuarios.repository.js';

// Hash bcrypt "señuelo", sin relación con ninguna contraseña real.
// Se usa únicamente para que la comparación tarde lo mismo cuando el
// email no existe, y así no delatar por timing si un email está o no
// registrado.
const DUMMY_HASH = '$2a$10$q.7Pxg.mIxFF1/JGHdTM..6tGY95w3q6Hs1u0NTjnSaNf.3W1cRzO';

export interface JwtPayload {
  sub: string;
  rol: string;
}

export interface LoginResult {
  token: string;
  usuario: UsuarioPublico;
}

export async function login(email: string, password: string): Promise<LoginResult | null> {
  const usuario = await findByEmailWithRol(email);

  if (!usuario) {
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }

  const passwordValida = await bcrypt.compare(password, usuario.password_hash);

  if (!passwordValida || !usuario.activo) {
    return null;
  }

  const payload: JwtPayload = { sub: usuario.id, rol: usuario.rol };
  const signOptions: jwt.SignOptions = {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  };
  const token = jwt.sign(payload, env.jwtSecret, signOptions);

  return {
    token,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      activo: usuario.activo,
      rol: usuario.rol,
    },
  };
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

export async function getUsuarioActual(id: string): Promise<UsuarioPublico | null> {
  return findByIdWithRol(id);
}
