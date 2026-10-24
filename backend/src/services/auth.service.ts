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
//
// CORRECCIÓN FASE 4 (hallazgo #2): costo bcrypt 12, igual al estándar real verificado del sistema
// (usuarios.service.ts::SALT_ROUNDS, usado por crearUsuario() para TODO usuario nuevo real desde
// esta corrección). El valor anterior (costo 10) coincidía con los scripts de seed/generación de
// hash ya desalineados en ese momento y producía una diferencia de tiempo medible (~3.3x, Fase 4)
// entre un correo existente y uno inexistente. Hash generado una sola vez a partir de una cadena
// arbitraria sin relación con ninguna contraseña real — nunca se usa para autenticar a nadie.
const DUMMY_HASH = '$2a$12$HtdOriBIV2tdo7n/j8UouOfLIPALxdlflzU0cbRvsG.P5e5IkjazK';

export interface JwtPayload {
  sub: string;
  rol: string;
  // Versión de sesión (V18). Los tokens emitidos antes de V18 no la traen: se interpretan como 0.
  sv?: number;
}

export interface LoginResult {
  token: string;
  usuario: UsuarioPublico;
}

// Único punto donde se firma un JWT de sesión (login y cambio de contraseña).
export function emitirToken(usuarioId: string, rol: string, sessionVersion: number): string {
  const payload: JwtPayload = { sub: usuarioId, rol, sv: sessionVersion };
  const signOptions: jwt.SignOptions = {
    algorithm: 'HS256',
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(payload, env.jwtSecret, signOptions);
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

  const token = emitirToken(usuario.id, usuario.rol, usuario.session_version);

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
  return jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;
}

export async function getUsuarioActual(id: string): Promise<UsuarioPublico | null> {
  return findByIdWithRol(id);
}
