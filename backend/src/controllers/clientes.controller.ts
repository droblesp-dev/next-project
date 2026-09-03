import type { Request, Response } from 'express';
import { listarClientes, crearCliente } from '../services/clientes.service.js';

export async function listarController(_req: Request, res: Response): Promise<void> {
  const clientes = await listarClientes();
  res.status(200).json({ clientes });
}

export async function crearController(req: Request, res: Response): Promise<void> {
  const { nombre, empresa, email, telefono } = (req.body ?? {}) as {
    nombre?: unknown;
    empresa?: unknown;
    email?: unknown;
    telefono?: unknown;
  };

  if (
    typeof nombre !== 'string' || !nombre.trim() || nombre.length > 150 ||
    typeof email !== 'string' || !email.trim() || !email.includes('@') || email.length > 150 ||
    typeof telefono !== 'string' || !telefono.trim() || telefono.length > 30
  ) {
    res.status(400).json({ message: 'nombre, email y telefono son requeridos y deben tener un formato/longitud válidos.' });
    return;
  }

  if (empresa !== undefined && empresa !== null && (typeof empresa !== 'string' || empresa.length > 150)) {
    res.status(400).json({ message: 'empresa debe ser texto de hasta 150 caracteres.' });
    return;
  }

  const { cliente, creado } = await crearCliente({
    nombre,
    empresa: typeof empresa === 'string' ? empresa : null,
    email,
    telefono,
  });

  res.status(creado ? 201 : 200).json({ cliente, creado });
}
