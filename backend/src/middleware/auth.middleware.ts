import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../services/auth.service.js';
import { findSesionById } from '../repositories/usuarios.repository.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// H-01: además de la firma/expiración del JWT, se vuelve a consultar
// `usuarios.activo` en cada request autenticada. Un JWT ya emitido antes
// de que un ADMIN desactive esa cuenta dejaba de reflejar la
// desactivación hasta su expiración natural (hasta JWT_EXPIRES_IN) — este
// chequeo corta el acceso de inmediato. No cambia el formato del JWT, su
// duración, ni los roles/permisos — reutiliza `findByIdWithRol()`, ya
// existente, sin modificarla. Express 4 no captura promesas rechazadas de
// middleware automáticamente, por eso todo el cuerpo va en un try/catch.
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Token no proporcionado.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();

  if (!token) {
    res.status(401).json({ message: 'Token no proporcionado.' });
    return;
  }

  try {
    const payload = verifyToken(token);

    const usuario = await findSesionById(payload.sub);
    if (!usuario || !usuario.activo) {
      res.status(401).json({ message: 'Usuario inactivo o inexistente.' });
      return;
    }
    // V18: un token emitido antes de un cambio de contraseña lleva una versión anterior.
    // Los tokens sin `sv` (anteriores a V18) cuentan como versión 0.
    if ((payload.sv ?? 0) !== usuario.session_version) {
      res.status(401).json({ message: 'Sesión inválida o cerrada. Inicia sesión de nuevo.' });
      return;
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: 'Token inválido o expirado.' });
  }
}

export function requireRole(...rolesPermitidos: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'No autenticado.' });
      return;
    }

    if (!rolesPermitidos.includes(req.user.rol)) {
      res.status(403).json({ message: 'No autorizado.' });
      return;
    }

    next();
  };
}
