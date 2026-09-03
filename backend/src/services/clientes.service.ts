import { pool } from '../config/db.js';
import { listAll, findByEmail, create, type Cliente } from '../repositories/clientes.repository.js';

export async function listarClientes(): Promise<Cliente[]> {
  return listAll();
}

export interface CrearClienteInput {
  nombre: string;
  empresa?: string | null;
  email: string;
  telefono: string;
}

export interface CrearClienteResultado {
  cliente: Cliente;
  creado: boolean;
}

// Sin UNIQUE en clientes.email (decisión aprobada de Fase 4): se busca y
// reutiliza el cliente existente en vez de crear uno nuevo. Esto reduce el
// riesgo de duplicados pero no lo elimina bajo concurrencia real — ver
// informe de cierre, sección "Gestión de clientes.email".
export async function crearCliente(input: CrearClienteInput): Promise<CrearClienteResultado> {
  const emailNormalizado = input.email.trim().toLowerCase();

  const existente = await findByEmail(pool, emailNormalizado);
  if (existente) {
    return { cliente: existente, creado: false };
  }

  const nuevo = await create(pool, {
    nombre: input.nombre.trim(),
    empresa: input.empresa?.trim() || null,
    email: emailNormalizado,
    telefono: input.telefono.trim(),
  });

  return { cliente: nuevo, creado: true };
}
