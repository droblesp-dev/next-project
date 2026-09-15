import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

export interface Lead {
  id: string;
  nombre: string;
  telefono: string;
  email: string | null;
  fuente: string;
  estado: string;
  clasificacion: string;
  comercial_id: string | null;
  cliente_id: string | null;
  solicitud_id: string | null;
  ultimo_contacto: string | null;
  proximo_seguimiento: string | null;
  observaciones: string | null;
  creado_en: string;
  actualizado_en: string;
}

type Executor = Pool | PoolClient;

const COLUMNAS = `id, nombre, telefono, email, fuente, estado, clasificacion,
                   comercial_id, cliente_id, solicitud_id, ultimo_contacto,
                   proximo_seguimiento, observaciones, creado_en, actualizado_en`;

export async function listAll(): Promise<Lead[]> {
  const result = await pool.query<Lead>(`SELECT ${COLUMNAS} FROM leads ORDER BY creado_en DESC`);
  return result.rows;
}

export async function findById(id: string): Promise<Lead | null> {
  const result = await pool.query<Lead>(`SELECT ${COLUMNAS} FROM leads WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function create(
  executor: Executor,
  data: { nombre: string; telefono: string; email: string | null; fuente: string }
): Promise<Lead> {
  const result = await executor.query<Lead>(
    `INSERT INTO leads (id, nombre, telefono, email, fuente)
     VALUES (gen_random_uuid(), $1, $2, $3, $4)
     RETURNING ${COLUMNAS}`,
    [data.nombre, data.telefono, data.email, data.fuente]
  );
  return result.rows[0];
}

// UPDATE dinámico y seguro: los nombres de columna en `data` provienen
// siempre de una whitelist fija construida en leads.service.ts (nunca se
// vuelca aquí el body de una petición sin filtrar); los valores siempre
// viajan parametrizados. Solo se tocan los campos realmente presentes.
export async function update(id: string, data: Record<string, unknown>): Promise<Lead | null> {
  const campos = Object.keys(data);
  if (campos.length === 0) {
    return findById(id);
  }

  const asignaciones = campos.map((campo, i) => `${campo} = $${i + 2}`).join(', ');
  const valores = campos.map((campo) => data[campo]);

  const result = await pool.query<Lead>(
    `UPDATE leads SET ${asignaciones}, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING ${COLUMNAS}`,
    [id, ...valores]
  );
  return result.rows[0] ?? null;
}

export async function updateComercial(id: string, comercialId: string): Promise<Lead | null> {
  const result = await pool.query<Lead>(
    `UPDATE leads SET comercial_id = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING ${COLUMNAS}`,
    [id, comercialId]
  );
  return result.rows[0] ?? null;
}

// Consultas de solo lectura contra tablas de Fases 4/5/7 (clientes,
// solicitudes, cotizaciones) para validar vínculos y verificar evidencia
// real de conversión — ninguna de estas funciones escribe en esas tablas
// ni modifica los repositorios ya existentes de esas fases.

export async function existeCliente(id: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM clientes WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function buscarSolicitud(id: string): Promise<{ id: string; cliente_id: string } | null> {
  const result = await pool.query<{ id: string; cliente_id: string }>(
    'SELECT id, cliente_id FROM solicitudes WHERE id = $1',
    [id]
  );
  return result.rows[0] ?? null;
}

export async function existeCotizacionAceptada(solicitudId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM cotizaciones WHERE solicitud_id = $1 AND estado = 'ACEPTADA'`,
    [solicitudId]
  );
  return (result.rowCount ?? 0) > 0;
}

// RECURRENTE exige que la nueva solicitud sea POSTERIOR a la solicitud que
// ya fue convertida (no simplemente "otra distinta") — se ancla en el
// propio creado_en de la solicitud ya vinculada al lead.
export async function existeSolicitudPosteriorALaConvertida(
  clienteId: string,
  solicitudConvertidaId: string
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM solicitudes
     WHERE cliente_id = $1
       AND id <> $2
       AND creado_en > (SELECT creado_en FROM solicitudes WHERE id = $2)`,
    [clienteId, solicitudConvertidaId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---- lead_seguimientos ----------------------------------------------
// Entidad propia (Fase 10, corrección de seguimiento): un registro por
// cada contacto real, nunca se sobreescribe. `leads.repository.ts` la
// aloja aquí mismo (alternativa explícitamente permitida) para minimizar
// archivos nuevos.

export interface LeadSeguimiento {
  id: string;
  lead_id: string;
  comercial_id: string | null;
  tipo: string;
  observacion: string | null;
  fecha: string;
}

const COLUMNAS_SEGUIMIENTO = 'id, lead_id, comercial_id, tipo, observacion, fecha';

export async function crearSeguimiento(
  leadId: string,
  comercialId: string,
  tipo: string,
  observacion: string | null
): Promise<LeadSeguimiento> {
  const result = await pool.query<LeadSeguimiento>(
    `INSERT INTO lead_seguimientos (id, lead_id, comercial_id, tipo, observacion)
     VALUES (gen_random_uuid(), $1, $2, $3, $4)
     RETURNING ${COLUMNAS_SEGUIMIENTO}`,
    [leadId, comercialId, tipo, observacion]
  );
  return result.rows[0];
}

export async function listarSeguimientos(leadId: string): Promise<LeadSeguimiento[]> {
  const result = await pool.query<LeadSeguimiento>(
    `SELECT ${COLUMNAS_SEGUIMIENTO} FROM lead_seguimientos WHERE lead_id = $1 ORDER BY fecha DESC`,
    [leadId]
  );
  return result.rows;
}
