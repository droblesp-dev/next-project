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

// FORMULARIO-01: variante exclusiva de la integración Cliente -> Solicitud ->
// Lead del formulario público (crearSolicitud() en solicitudes.service.ts).
// A diferencia de create() (lead "en blanco", sin cliente/solicitud, usado por
// POST /api/leads — AsistenteComercial), este INSERT nace YA vinculado y YA
// TIBIO: la solicitud recién enviada es evidencia suficiente de intención real
// (distinto del significado histórico de TIBIO = "tuvo un seguimiento humano";
// aquí el propio envío del formulario cumple ese rol). Nunca se llama sola:
// siempre dentro de la misma transacción que crea la solicitud.
export async function createConVinculo(
  executor: Executor,
  data: { nombre: string; telefono: string; email: string | null; fuente: string; clienteId: string; solicitudId: string }
): Promise<Lead> {
  const result = await executor.query<Lead>(
    `INSERT INTO leads (id, nombre, telefono, email, fuente, cliente_id, solicitud_id, clasificacion, estado)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'TIBIO', 'ACTIVO')
     RETURNING ${COLUMNAS}`,
    [data.nombre, data.telefono, data.email, data.fuente, data.clienteId, data.solicitudId]
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

// Enlace de solicitud (lead TIBIO): variantes con `executor` para operar
// dentro de la transacción que también crea la solicitud. FOR UPDATE
// serializa dos usos simultáneos del mismo enlace.
export async function findByIdForUpdate(executor: Executor, id: string): Promise<Lead | null> {
  const result = await executor.query<Lead>(`SELECT ${COLUMNAS} FROM leads WHERE id = $1 FOR UPDATE`, [id]);
  return result.rows[0] ?? null;
}

// Condición transaccional de uso único: solo afecta al lead si sigue
// ACTIVO + TIBIO y sin solicitud. Devuelve null si ya no cumple.
export async function vincularSolicitudDesdeEnlace(
  executor: Executor,
  data: { leadId: string; clienteId: string; solicitudId: string }
): Promise<Lead | null> {
  const result = await executor.query<Lead>(
    `UPDATE leads
     SET cliente_id = $2, solicitud_id = $3, clasificacion = 'CALIENTE', actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACTIVO' AND clasificacion = 'TIBIO' AND solicitud_id IS NULL
     RETURNING ${COLUMNAS}`,
    [data.leadId, data.clienteId, data.solicitudId]
  );
  return result.rows[0] ?? null;
}

// ASISTENTE-COMERCIAL-05 (autorización explícita, corregida tras revisión de
// T5): coincidencia ALTA de identidad — teléfono normalizado
// (+593XXXXXXXXX) Y correo normalizado (trim+lowercase) iguales, ambos
// exactos. `email = $2` con `$2 = NULL` nunca iguala nada en PostgreSQL
// (semántica NULL de SQL), así que un prospecto que no dejó correo en
// ninguno de los dos formularios jamás produce una coincidencia "alta" por
// esta vía — comportamiento correcto y gratuito, sin lógica adicional.
//
// USO EXCLUSIVO: "Hablar con un asesor" (leads.service.ts::crearLead) — NO
// el formulario principal (ver buscarLeadOrfanoPorTelefonoYEmail más abajo,
// con restricción adicional). "Hablar con un asesor" nunca crea una
// Solicitud, así que puede reutilizar el lead de CUALQUIER captación previa
// (con o sin solicitud_id ya vinculado) — es correcto que encuentre, por
// ejemplo, el lead de una Solicitud ya existente (Ejemplo/Escenario 1).
// `ORDER BY creado_en DESC`: si el mismo teléfono+correo tiene varios leads
// (varias Solicitudes legítimas, cada una con el suyo — ver
// buscarLeadOrfanoPorTelefonoYEmail), se adjunta el seguimiento al más
// RECIENTE (la captación más relevante/activa) — nunca se tocan los demás,
// nunca se fusionan entre sí (T5 del bloque de corrección).
// `FOR UPDATE`: bloquea la fila encontrada dentro de la transacción del
// llamador, para que dos peticiones casi simultáneas que reutilicen el
// MISMO lead existente queden serializadas (ver nota de concurrencia en el
// informe del bloque — esto NO cubre el caso de dos peticiones simultáneas
// cuyo lead todavía no existe: eso requeriría una restricción UNIQUE, fuera
// del alcance autorizado aquí).
export async function buscarPorTelefonoYEmail(
  executor: Executor,
  telefono: string,
  email: string
): Promise<Lead | null> {
  const result = await executor.query<Lead>(
    `SELECT ${COLUMNAS} FROM leads WHERE telefono = $1 AND email = $2 ORDER BY creado_en DESC LIMIT 1 FOR UPDATE`,
    [telefono, email]
  );
  return result.rows[0] ?? null;
}

// ASISTENTE-COMERCIAL-05 (corrección tras revisión de T5 — "la decisión
// funcional cambió"): búsqueda EXCLUSIVA del formulario principal
// (solicitudes.service.ts::crearSolicitud) — a diferencia de
// buscarPorTelefonoYEmail, exige además `solicitud_id IS NULL`: SOLO
// considera "reutilizable" un lead que todavía no pertenece a ninguna
// Solicitud (es decir, que nació de "Hablar con un asesor" y sigue suelto).
// Un lead que YA está vinculado a una Solicitud anterior del mismo
// teléfono+correo NUNCA aparece en esta búsqueda — cada Solicitud nueva
// conserva su propio lead (Escenario 3/4 del bloque de corrección: múltiples
// Solicitudes legítimas de un mismo Cliente nunca comparten ni se roban el
// lead de otra). Mismo `FOR UPDATE` por el mismo motivo de concurrencia.
export async function buscarLeadOrfanoPorTelefonoYEmail(
  executor: Executor,
  telefono: string,
  email: string
): Promise<Lead | null> {
  const result = await executor.query<Lead>(
    `SELECT ${COLUMNAS} FROM leads
     WHERE telefono = $1 AND email = $2 AND solicitud_id IS NULL
     ORDER BY creado_en DESC LIMIT 1 FOR UPDATE`,
    [telefono, email]
  );
  return result.rows[0] ?? null;
}

// ASISTENTE-COMERCIAL-05: reutiliza un lead existente para una NUEVA
// Solicitud del formulario principal — vincula cliente_id/solicitud_id (al
// más reciente, si el lead ya tenía una solicitud vinculada de antes) y
// promueve FRIO -> TIBIO sin nunca degradar una clasificación más avanzada
// (TIBIO/CALIENTE/CONVERTIDO/RECURRENTE quedan intactas vía el CASE). Nunca
// toca nombre/telefono/email/fuente del lead (esos campos documentan el
// primer contacto real, no se reescriben por una interacción posterior).
// Condición WHERE: mismo principio de protección ya usado en
// vincularSolicitudDesdeEnlace/actualizarLead — un lead DESCARTADO,
// CONVERTIDO o RECURRENTE nunca se reescribe automáticamente; el llamador
// debe crear un lead nuevo en ese caso (fallback, nunca deja una Solicitud
// sin ningún lead).
export async function reutilizarParaSolicitud(
  executor: Executor,
  data: { leadId: string; clienteId: string; solicitudId: string }
): Promise<Lead | null> {
  const result = await executor.query<Lead>(
    `UPDATE leads
     SET cliente_id = $2,
         solicitud_id = $3,
         clasificacion = CASE WHEN clasificacion = 'FRIO' THEN 'TIBIO' ELSE clasificacion END,
         actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACTIVO' AND clasificacion NOT IN ('CONVERTIDO', 'RECURRENTE')
     RETURNING ${COLUMNAS}`,
    [data.leadId, data.clienteId, data.solicitudId]
  );
  return result.rows[0] ?? null;
}

// ASISTENTE-COMERCIAL-05: mismo principio, pero para "Hablar con un asesor"
// — solo promueve FRIO -> TIBIO si corresponde (nunca degrada), sin tocar
// cliente_id/solicitud_id/fuente/nombre/telefono/email. Misma protección de
// estado que reutilizarParaSolicitud.
export async function promoverSiFrio(executor: Executor, leadId: string): Promise<Lead | null> {
  const result = await executor.query<Lead>(
    `UPDATE leads
     SET clasificacion = CASE WHEN clasificacion = 'FRIO' THEN 'TIBIO' ELSE clasificacion END,
         actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACTIVO' AND clasificacion NOT IN ('CONVERTIDO', 'RECURRENTE')
     RETURNING ${COLUMNAS}`,
    [leadId]
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

// Solo lectura: ¿la solicitud tiene alguna cotización (en cualquier estado)?
// Se usa para proteger la solicitud vinculada a un lead CALIENTE.
export async function existeCotizacionDeSolicitud(solicitudId: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM cotizaciones WHERE solicitud_id = $1 LIMIT 1', [solicitudId]);
  return (result.rowCount ?? 0) > 0;
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

// ASISTENTE-COMERCIAL-05 (autorización explícita): `comercialId` se ensancha
// a `string | null` — la columna `lead_seguimientos.comercial_id` ya era
// NULLABLE en el esquema (verificado), simplemente ningún llamador anterior
// pasaba `null`. El único caso real que lo necesita es el seguimiento
// automático que registra "Hablar con un asesor" cuando reutiliza un lead
// existente (petición pública, sin sesión de ningún comercial). `executor`
// opcional (por defecto `pool`) permite participar en la transacción del
// llamador — todos los llamadores existentes, que no lo pasan, se comportan
// exactamente igual que antes.
export async function crearSeguimiento(
  leadId: string,
  comercialId: string | null,
  tipo: string,
  observacion: string | null,
  executor: Executor = pool
): Promise<LeadSeguimiento> {
  const result = await executor.query<LeadSeguimiento>(
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
