import type { Request, Response } from 'express';
import {
  listarUsuarios,
  listarAdminsActivos,
  crearUsuario,
  cambiarActivo,
  cambiarRol,
  EmailDuplicadoError,
  RolInvalidoError,
  UltimoAdminError,
  UsuarioNoEncontradoError,
} from '../services/usuarios.service.js';

export async function listarController(_req: Request, res: Response): Promise<void> {
  const usuarios = await listarUsuarios();
  res.status(200).json({ usuarios });
}

// PC-2026-01 (continuación — Frontend Secciones C/D): accesible también a
// COMERCIAL (ver routes/usuarios.routes.ts, registrada antes del bloque
// requireRole('ADMIN') del router) — solo id+nombre, nunca el listado
// completo de usuarios.
export async function listarAdminsActivosController(_req: Request, res: Response): Promise<void> {
  const admins = await listarAdminsActivos();
  res.status(200).json({ admins });
}

export async function crearController(req: Request, res: Response): Promise<void> {
  const { nombre, email, password, rol } = (req.body ?? {}) as {
    nombre?: unknown;
    email?: unknown;
    password?: unknown;
    rol?: unknown;
  };

  if (
    typeof nombre !== 'string' ||
    !nombre.trim() ||
    typeof email !== 'string' ||
    !email.trim() ||
    typeof password !== 'string' ||
    !password ||
    typeof rol !== 'string' ||
    !rol.trim()
  ) {
    res.status(400).json({ message: 'nombre, email, password y rol son requeridos.' });
    return;
  }

  try {
    const usuario = await crearUsuario({
      nombre: nombre.trim(),
      email: email.trim(),
      password,
      rol: rol.trim(),
    });
    res.status(201).json({ usuario });
  } catch (error) {
    if (error instanceof EmailDuplicadoError) {
      res.status(409).json({ message: 'El email ya está registrado.' });
      return;
    }
    if (error instanceof RolInvalidoError) {
      res.status(400).json({ message: 'Rol inválido.' });
      return;
    }
    throw error;
  }
}

export async function cambiarActivoController(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { activo } = (req.body ?? {}) as { activo?: unknown };

  if (typeof activo !== 'boolean') {
    res.status(400).json({ message: 'activo debe ser un valor booleano.' });
    return;
  }

  try {
    const usuario = await cambiarActivo(id, activo);
    res.status(200).json({ usuario });
  } catch (error) {
    if (error instanceof UltimoAdminError) {
      res.status(409).json({ message: 'No es posible desactivar al último administrador activo.' });
      return;
    }
    if (error instanceof UsuarioNoEncontradoError) {
      res.status(404).json({ message: 'Usuario no encontrado.' });
      return;
    }
    throw error;
  }
}

export async function cambiarRolController(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { rol } = (req.body ?? {}) as { rol?: unknown };

  if (typeof rol !== 'string' || !rol.trim()) {
    res.status(400).json({ message: 'rol es requerido.' });
    return;
  }

  try {
    const usuario = await cambiarRol(id, rol.trim());
    res.status(200).json({ usuario });
  } catch (error) {
    if (error instanceof UltimoAdminError) {
      res.status(409).json({ message: 'No es posible reasignar el rol del último administrador activo.' });
      return;
    }
    if (error instanceof RolInvalidoError) {
      res.status(400).json({ message: 'Rol inválido.' });
      return;
    }
    if (error instanceof UsuarioNoEncontradoError) {
      res.status(404).json({ message: 'Usuario no encontrado.' });
      return;
    }
    throw error;
  }
}
