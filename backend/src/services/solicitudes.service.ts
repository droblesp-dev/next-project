import { pool } from '../config/db.js';
import * as clientesRepo from '../repositories/clientes.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import type { Solicitud } from '../repositories/solicitudes.repository.js';

export class SolicitudNoEncontradaError extends Error {}
export class TransicionInvalidaError extends Error {}
export class EstadoInvalidoError extends Error {}

const ESTADOS_VALIDOS = ['NUEVA', 'EN_REVISION', 'COTIZADA', 'CANCELADA'];

// Transiciones aprobadas para Fase 4 (origen -> destinos permitidos).
// COTIZADA y CANCELADA son terminales (sin destinos).
const TRANSICIONES: Record<string, string[]> = {
  NUEVA: ['EN_REVISION', 'CANCELADA'],
  EN_REVISION: ['COTIZADA', 'CANCELADA'],
  COTIZADA: [],
  CANCELADA: [],
};

export async function listarSolicitudes(): Promise<Solicitud[]> {
  return solicitudesRepo.listAll();
}

export async function obtenerSolicitud(id: string): Promise<Solicitud | null> {
  return solicitudesRepo.findById(id);
}

export interface CrearSolicitudInput {
  nombre: string;
  empresa?: string | null;
  email: string;
  telefono: string;
  servicio: string;
  descripcion: string;
  cantidad: number;
  fechaRequerida?: string | null;
}

// Flujo find-or-create de cliente + creación de solicitud, dentro de una
// única transacción (decisión aprobada 2.5). Garantiza atomicidad entre
// ambas escrituras, NO garantiza unicidad de clientes.email (ver 2.4).
export async function crearSolicitud(input: CrearSolicitudInput): Promise<Solicitud> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const emailNormalizado = input.email.trim().toLowerCase();
    let cliente = await clientesRepo.findByEmail(client, emailNormalizado);

    if (!cliente) {
      cliente = await clientesRepo.create(client, {
        nombre: input.nombre.trim(),
        empresa: input.empresa?.trim() || null,
        email: emailNormalizado,
        telefono: input.telefono.trim(),
      });
    }

    const solicitud = await solicitudesRepo.create(client, {
      clienteId: cliente.id,
      servicio: input.servicio.trim(),
      descripcion: input.descripcion.trim(),
      cantidad: input.cantidad,
      fechaRequerida: input.fechaRequerida ?? null,
    });

    await client.query('COMMIT');
    return solicitud;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function cambiarEstadoSolicitud(id: string, nuevoEstado: string): Promise<Solicitud> {
  if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
    throw new EstadoInvalidoError();
  }

  const estadosOrigenValidos = Object.entries(TRANSICIONES)
    .filter(([, destinos]) => destinos.includes(nuevoEstado))
    .map(([origen]) => origen);

  if (estadosOrigenValidos.length === 0) {
    // Ningún estado puede transicionar hacia `nuevoEstado` (ej. NUEVA,
    // o intentar "volver" a un estado terminal).
    throw new TransicionInvalidaError();
  }

  const actualizado = await solicitudesRepo.updateEstado(id, nuevoEstado, estadosOrigenValidos);
  if (actualizado) {
    return actualizado;
  }

  // El UPDATE no afectó ninguna fila: puede ser porque no existe, o porque
  // su estado actual no admite esta transición. Se distingue solo para dar
  // un mensaje claro — la corrección/atomicidad ya la garantizó el UPDATE.
  const actual = await solicitudesRepo.findById(id);
  if (!actual) {
    throw new SolicitudNoEncontradaError();
  }
  throw new TransicionInvalidaError();
}
