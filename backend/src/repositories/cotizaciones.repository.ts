import type { Pool, PoolClient } from 'pg';
import { pool } from '../config/db.js';

// `valor` es NUMERIC en PostgreSQL; el driver `pg` lo devuelve como string
// (no lo convierte a number) para no perder precisión — se respeta ese
// comportamiento real en lugar de asumir un tipo numérico en TypeScript.
export interface Cotizacion {
  id: string;
  codigo: string | null;
  solicitud_id: string;
  valor: string;
  estado: string;
  descripcion: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
  fecha_vigencia: string | null;
  aceptada_en: string | null;
  rechazada_en: string | null;
  subtotal: string | null;
  iva_porcentaje: string | null;
  iva_valor: string | null;
  total: string | null;
  anticipo_porcentaje: string | null;
  anticipo_valor: string | null;
  saldo_pendiente: string | null;
  metodo_anticipo: string | null;
  estado_anticipo: string | null;
  anticipo_confirmado_en: string | null;
  anticipo_confirmado_por: string | null;
  comprobante_recibido: boolean;
  metodo_saldo: string | null;
  estado_saldo: string;
  saldo_confirmado_en: string | null;
  saldo_confirmado_por: string | null;
  saldo_comprobante_recibido: boolean;
}

type Executor = Pool | PoolClient;

// `fecha_vigencia`/`aceptada_en` ya existían en el esquema (V1) pero no se
// exponían: necesarias para la vista pública de cotización (vigencia) y
// para registrar/mostrar la fecha real de aceptación.
// Los 8 campos de IVA/anticipo (Fase D.2) también ya existían en el
// esquema desde V1, sin usarse: ahora se calculan y persisten desde
// crearCotizacion(). `rechazada_en` (V5) se agrega en Fase D.5 para
// registrar el rechazo público. `anticipo_confirmado_en/_por` se agregan
// en D.6. `comprobante_anticipo` (la referencia real del archivo) se
// mantiene deliberadamente FUERA de COLUMNAS — igual que
// `acceso_codigo_hash` — y solo se expone como el booleano calculado
// `comprobante_recibido`: ni el listado interno ni la vista pública deben
// conocer jamás el nombre/ruta real del archivo (Comercial lo descarga
// mediante un endpoint dedicado que resuelve la ruta en el servidor).
// Bloque saldo/entrega/cierre: `comprobante_saldo` se mantiene fuera de
// COLUMNAS, mismo tratamiento que `comprobante_anticipo` — solo se expone
// el booleano calculado `saldo_comprobante_recibido`. `saldo_pendiente`
// sigue siendo exclusivamente el monto fijo calculado en crearCotizacion();
// ninguna función de este archivo permite escribirlo.
// `codigo` (V12 — numeración comercial independiente COT-XXXXXX): lo asigna
// un trigger de PostgreSQL en el INSERT, igual que solicitudes.codigo (V10)
// — nunca se escribe desde la aplicación, solo se lee vía COLUMNAS, que ya
// propaga el cambio a listAll/findById/create (RETURNING) y a cada UPDATE
// condicional de este archivo sin tocarlos individualmente.
const COLUMNAS = `id, codigo, solicitud_id, valor, estado, descripcion, creado_por, creado_en, actualizado_en, fecha_vigencia, aceptada_en, rechazada_en, subtotal, iva_porcentaje, iva_valor, total, anticipo_porcentaje, anticipo_valor, saldo_pendiente, metodo_anticipo, estado_anticipo, anticipo_confirmado_en, anticipo_confirmado_por, (comprobante_anticipo IS NOT NULL) AS comprobante_recibido, metodo_saldo, estado_saldo, saldo_confirmado_en, saldo_confirmado_por, (comprobante_saldo IS NOT NULL) AS saldo_comprobante_recibido`;

export async function listAll(): Promise<Cotizacion[]> {
  const result = await pool.query<Cotizacion>(
    `SELECT ${COLUMNAS} FROM cotizaciones ORDER BY creado_en DESC`
  );
  return result.rows;
}

export async function findById(id: string): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `SELECT ${COLUMNAS} FROM cotizaciones WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

// PC-2026-01, Etapa 4: bloquea (FOR UPDATE) la fila de la cotización dentro
// de la transacción del `client` recibido — mismo patrón ya usado en
// ordenEvidencia.repository.ts::findEstadoParaActualizar, para serializar
// intentos concurrentes de gestionar/confirmar el mismo pago. Solo expone
// los campos que la integración de transferencias_pago necesita decidir,
// no el objeto completo.
export interface CotizacionLockTransferencia {
  estado: string;
  estado_anticipo: string | null;
  estado_saldo: string;
  anticipo_valor: string | null;
  saldo_pendiente: string | null;
  comprobante_anticipo: string | null;
  comprobante_saldo: string | null;
  metodo_anticipo: string | null;
  metodo_saldo: string | null;
}

export async function lockParaTransferencia(
  id: string,
  client: PoolClient
): Promise<CotizacionLockTransferencia | null> {
  const result = await client.query<CotizacionLockTransferencia>(
    `SELECT estado, estado_anticipo, estado_saldo, anticipo_valor, saldo_pendiente, comprobante_anticipo, comprobante_saldo, metodo_anticipo, metodo_saldo
     FROM cotizaciones WHERE id = $1 FOR UPDATE`,
    [id]
  );
  return result.rows[0] ?? null;
}

// Fase 1 (autorización explícita — "Implementación Fase 1: envío
// automático de cotizaciones por correo"): única consulta de solo lectura
// para resolver el correo real del cliente de una cotización, mediante la
// relación ya existente cotizaciones.solicitud_id -> solicitudes.cliente_id
// -> clientes.email — ningún JOIN ni relación nueva, solo lectura de FK ya
// aprobadas. `solicitud_codigo` viaja junto porque ya es el identificador
// legible que el cliente reconoce (se le entregó en el correo de
// confirmación de su solicitud, Fase SOLICITUD-RECUPERACION-01B) — sirve
// para que el correo de esta fase pueda referenciar la misma solicitud sin
// inventar un identificador nuevo. Nunca se expone aquí nada del código de
// acceso ni de su hash.
export interface ContactoParaCorreo {
  clienteNombre: string;
  clienteEmail: string;
  solicitudCodigo: string | null;
  // Código comercial propio de la cotización (COT-XXXXXX, V12); NULL en cotizaciones históricas.
  cotizacionCodigo: string | null;
}

export async function obtenerContactoParaCorreo(cotizacionId: string): Promise<ContactoParaCorreo | null> {
  const result = await pool.query<ContactoParaCorreo>(
    `SELECT cl.nombre AS "clienteNombre", cl.email AS "clienteEmail", s.codigo AS "solicitudCodigo", c.codigo AS "cotizacionCodigo"
     FROM cotizaciones c
     JOIN solicitudes s ON s.id = c.solicitud_id
     JOIN clientes cl ON cl.id = s.cliente_id
     WHERE c.id = $1`,
    [cotizacionId]
  );
  return result.rows[0] ?? null;
}

export async function create(
  executor: Executor,
  data: {
    solicitudId: string;
    valor: number;
    descripcion: string | null;
    creadoPor: string;
    subtotal: number;
    ivaPorcentaje: number;
    ivaValor: number;
    total: number;
    anticipoPorcentaje: number;
    anticipoValor: number;
    saldoPendiente: number;
    metodoAnticipo: string | null;
    estadoAnticipo: string;
    diasVigencia: number;
  }
): Promise<Cotizacion> {
  const result = await executor.query<Cotizacion>(
    `INSERT INTO cotizaciones (
       id, solicitud_id, valor, descripcion, creado_por,
       subtotal, iva_porcentaje, iva_valor, total,
       anticipo_porcentaje, anticipo_valor, saldo_pendiente,
       metodo_anticipo, estado_anticipo, fecha_vigencia
     )
     VALUES (
       gen_random_uuid(), $1, $2, $3, $4,
       $5, $6, $7, $8,
       $9, $10, $11,
       $12, $13, CURRENT_TIMESTAMP + ($14 || ' days')::INTERVAL
     )
     RETURNING ${COLUMNAS}`,
    [
      data.solicitudId,
      data.valor,
      data.descripcion,
      data.creadoPor,
      data.subtotal,
      data.ivaPorcentaje,
      data.ivaValor,
      data.total,
      data.anticipoPorcentaje,
      data.anticipoValor,
      data.saldoPendiente,
      data.metodoAnticipo,
      data.estadoAnticipo,
      data.diasVigencia,
    ]
  );
  return result.rows[0];
}

// UPDATE condicional (misma técnica que solicitudes.repository.ts): solo
// aplica el cambio si el estado actual sigue siendo uno de los orígenes
// válidos para la transición solicitada. El índice único parcial
// `ux_cotizaciones_una_aceptada` (ya existente, no se toca) es quien
// garantiza a nivel de PostgreSQL que no haya dos cotizaciones ACEPTADA
// para la misma solicitud; una violación de esa unicidad se traduce en el
// service a un error de dominio específico.
// `executor` opcional (por defecto el pool): permite invocar este mismo
// UPDATE condicional dentro de una transacción ya abierta por el service
// (ver cambiarAEnviadaConSolicitud, más abajo en cotizaciones.service.ts)
// sin duplicar la sentencia SQL. Todos los llamadores existentes, que no
// pasan `executor`, se comportan exactamente igual que antes.
export async function updateEstado(
  id: string,
  nuevoEstado: string,
  estadosOrigenValidos: string[],
  executor: Executor = pool
): Promise<Cotizacion | null> {
  const result = await executor.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = ANY($3::varchar[])
     RETURNING ${COLUMNAS}`,
    [id, nuevoEstado, estadosOrigenValidos]
  );
  return result.rows[0] ?? null;
}

// Edición de condiciones comerciales — EXCLUSIVA de BORRADOR (autorización
// explícita — "IMPLEMENTACIÓN AUTORIZADA — EDICIÓN DE COTIZACIONES
// BORRADOR"). UPDATE condicional (mismo patrón que updateEstado): solo
// aplica si la fila SIGUE en BORRADOR en este instante. `fecha_vigencia` se
// recalcula igual que en create() — CURRENT_TIMESTAMP + dias_vigencia — pero
// tomando el momento de la EDICIÓN como punto de partida (no el de la
// creación original), manteniendo el mismo criterio ya usado por el sistema
// ("la vigencia corre desde ahora"). Ningún campo derivado (subtotal/
// iva_valor/total/anticipo_valor/saldo_pendiente/estado_anticipo) se acepta
// como entrada — todos llegan ya calculados por
// cotizaciones.service.ts::calcularCondicionesComerciales().
export async function updateCondiciones(
  id: string,
  data: {
    valor: number;
    descripcion: string | null;
    subtotal: number;
    ivaPorcentaje: number;
    ivaValor: number;
    total: number;
    anticipoPorcentaje: number;
    anticipoValor: number;
    saldoPendiente: number;
    metodoAnticipo: string | null;
    estadoAnticipo: string;
    diasVigencia: number;
  },
  // Opcional: permite ejecutarlo dentro de la transacción que bloquea la fila y escribe las líneas de detalle (V28).
  executor: Executor = pool
): Promise<Cotizacion | null> {
  const result = await executor.query<Cotizacion>(
    `UPDATE cotizaciones
     SET valor = $2, descripcion = $3,
         subtotal = $4, iva_porcentaje = $5, iva_valor = $6, total = $7,
         anticipo_porcentaje = $8, anticipo_valor = $9, saldo_pendiente = $10,
         metodo_anticipo = $11, estado_anticipo = $12,
         fecha_vigencia = CURRENT_TIMESTAMP + ($13 || ' days')::INTERVAL,
         actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'BORRADOR'
     RETURNING ${COLUMNAS}`,
    [
      id,
      data.valor,
      data.descripcion,
      data.subtotal,
      data.ivaPorcentaje,
      data.ivaValor,
      data.total,
      data.anticipoPorcentaje,
      data.anticipoValor,
      data.saldoPendiente,
      data.metodoAnticipo,
      data.estadoAnticipo,
      data.diasVigencia,
    ]
  );
  return result.rows[0] ?? null;
}

// `acceso_codigo_hash` (Fase B) se mantiene deliberadamente fuera de
// `COLUMNAS`/`Cotizacion`: nunca debe viajar en la respuesta de ningún
// listado/consulta general (interno o público). Estas dos funciones son
// el único punto de lectura/escritura de ese campo.
// Aceptación/rechazo público (Fase D.5): UPDATE condicional — solo aplica
// si la fila SIGUE en estado ENVIADA en este instante (protege contra
// condiciones de carrera: dos pestañas del cliente, o un vencimiento
// perezoso que ocurrió entre la validación y este UPDATE). Si otra
// cotización de la misma solicitud ya está ACEPTADA, `ux_cotizaciones_una_
// aceptada` rechaza el UPDATE con una violación de unicidad — el service
// la traduce a YaExisteAceptadaError, igual que en cambiarEstadoCotizacion.
// C2.2 (autorización explícita — alternativa B de la auditoría C2.1):
// acepta un `Executor` opcional (por defecto `pool`, igual que el resto de
// este archivo) para poder ejecutarse dentro de la misma transacción que
// convierte el lead vinculado — ver cotizaciones.service.ts::
// aceptarCotizacionPublica(). Ningún llamador existente que no pase
// `executor` cambia de comportamiento.
export async function marcarAceptada(id: string, executor: Executor = pool): Promise<Cotizacion | null> {
  const result = await executor.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado = 'ACEPTADA', aceptada_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ENVIADA'
     RETURNING ${COLUMNAS}`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function marcarRechazada(id: string): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado = 'RECHAZADA', rechazada_en = CURRENT_TIMESTAMP, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ENVIADA'
     RETURNING ${COLUMNAS}`,
    [id]
  );
  return result.rows[0] ?? null;
}

// Vencimiento perezoso (Fase D.3): UPDATE condicional sin scheduler/cron,
// mismo patrón ya usado para alertas. Solo afecta filas ENVIADA cuya
// fecha_vigencia ya pasó — nunca toca ACEPTADA/RECHAZADA/CANCELADA/
// VENCIDA/BORRADOR ni filas ENVIADA sin fecha_vigencia asignada (datos
// previos a D.2). No elimina ninguna fila: solo cambia su estado.
export async function marcarVencidasSiCorresponde(): Promise<void> {
  await pool.query(
    `UPDATE cotizaciones
     SET estado = 'VENCIDA', actualizado_en = CURRENT_TIMESTAMP
     WHERE estado = 'ENVIADA'
       AND fecha_vigencia IS NOT NULL
       AND fecha_vigencia < CURRENT_TIMESTAMP`
  );
}

// Comprobante de transferencia del anticipo (Fase D.6): UPDATE condicional — solo aplica si la
// cotización sigue ACEPTADA, el método es TRANSFERENCIA y el anticipo admite una carga nueva:
//   - PENDIENTE sin comprobante previo (una segunda carga NO sobrescribe en silencio el que está en
//     revisión), o
//   - RECHAZADO: el cliente corrige y vuelve a subir; el anticipo regresa a PENDIENTE y se limpian
//     los datos del rechazo anterior (el rechazo y su motivo siguen en transferencias_pago, y el
//     archivo anterior en comprobantes_pago_cliente).
// `nombreArchivo` es siempre un nombre generado por el propio backend (uploadsComprobantes.ts).
export async function guardarComprobante(
  id: string,
  nombreArchivo: string,
  executor: Executor = pool
): Promise<Cotizacion | null> {
  const result = await executor.query<Cotizacion>(
    `UPDATE cotizaciones
     SET comprobante_anticipo = $2, estado_anticipo = 'PENDIENTE',
         anticipo_confirmado_en = NULL, anticipo_confirmado_por = NULL, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA' AND metodo_anticipo = 'TRANSFERENCIA'
       AND ((estado_anticipo = 'PENDIENTE' AND comprobante_anticipo IS NULL) OR estado_anticipo = 'RECHAZADO')
     RETURNING ${COLUMNAS}`,
    [id, nombreArchivo]
  );
  return result.rows[0] ?? null;
}

// Único punto que lee el nombre REAL del archivo — usado exclusivamente
// por el endpoint interno de descarga, que resuelve la ruta absoluta en
// el servidor (COMPROBANTES_DIR + este nombre). El cliente nunca ve ni
// envía este valor.
export async function obtenerNombreComprobante(id: string): Promise<string | null> {
  const result = await pool.query<{ comprobante_anticipo: string | null }>(
    'SELECT comprobante_anticipo FROM cotizaciones WHERE id = $1',
    [id]
  );
  return result.rows[0]?.comprobante_anticipo ?? null;
}

// Confirmación/rechazo de anticipo por Comercial (Fase D.6): UPDATE
// condicional — solo aplica si la cotización sigue ACEPTADA y su
// anticipo sigue PENDIENTE (evita re-gestionar uno ya resuelto).
// `confirmadoPor` es siempre `req.user.sub` de un ADMIN/COMERCIAL
// autenticado (la ruta está detrás de requireAuth+requireRole) — nunca
// puede originarse en el flujo público.
export async function actualizarEstadoAnticipo(
  id: string,
  nuevoEstadoAnticipo: string,
  confirmadoPor: string,
  executor: Executor = pool
): Promise<Cotizacion | null> {
  const result = await executor.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado_anticipo = $2, anticipo_confirmado_en = CURRENT_TIMESTAMP, anticipo_confirmado_por = $3, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA' AND estado_anticipo = 'PENDIENTE'
     RETURNING ${COLUMNAS}`,
    [id, nuevoEstadoAnticipo, confirmadoPor]
  );
  return result.rows[0] ?? null;
}

// Comprobante de saldo (bloque saldo/entrega/cierre): mismo patrón que guardarComprobante().
// Regla QA-04: el saldo solo admite comprobante cuando el anticipo ya está VALIDADO (acreditación
// confirmada) o no aplica — la condición vive en el propio UPDATE para que ni una llamada directa
// ni dos solicitudes concurrentes puedan saltársela. `metodo_saldo` no se elige de antemano: esta
// subida lo fija implícitamente en TRANSFERENCIA (si ya era EFECTIVO, el UPDATE no aplica).
export async function guardarComprobanteSaldo(
  id: string,
  nombreArchivo: string,
  executor: Executor = pool
): Promise<Cotizacion | null> {
  const result = await executor.query<Cotizacion>(
    `UPDATE cotizaciones
     SET comprobante_saldo = $2, metodo_saldo = 'TRANSFERENCIA', estado_saldo = 'PENDIENTE',
         saldo_confirmado_en = NULL, saldo_confirmado_por = NULL, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA'
       AND estado_anticipo IN ('VALIDADO', 'NO_APLICA')
       AND ((estado_saldo = 'PENDIENTE' AND comprobante_saldo IS NULL) OR estado_saldo = 'RECHAZADO')
       AND (metodo_saldo IS NULL OR metodo_saldo = 'TRANSFERENCIA')
     RETURNING ${COLUMNAS}`,
    [id, nombreArchivo]
  );
  return result.rows[0] ?? null;
}

// Único punto que lee el nombre REAL del comprobante de saldo — mismo
// tratamiento que obtenerNombreComprobante() para el anticipo.
export async function obtenerNombreComprobanteSaldo(id: string): Promise<string | null> {
  const result = await pool.query<{ comprobante_saldo: string | null }>(
    'SELECT comprobante_saldo FROM cotizaciones WHERE id = $1',
    [id]
  );
  return result.rows[0]?.comprobante_saldo ?? null;
}

// Validación/rechazo de saldo (ADMIN/COMERCIAL, ruta ya restringida a
// nivel de router). `metodoSaldo` se persiste en la MISMA sentencia que
// VALIDAR — cubre el caso EFECTIVO, donde el método nunca se fijó antes
// (no hay comprobante que lo determine implícitamente). UPDATE
// condicional: solo aplica si la cotización sigue ACEPTADA con saldo
// PENDIENTE y con el anticipo ya resuelto (VALIDADO o NO_APLICA). Un anticipo
// PENDIENTE, RECHAZADO o NULL (cotizaciones anteriores a D.2) NO cumple la
// condición: es la defensa atómica final de la regla, la misma que ya aplica
// `guardarComprobanteSaldo`, para que ninguna vía interna ni dos solicitudes
// concurrentes puedan saltársela.
export async function validarSaldo(
  id: string,
  confirmadoPor: string,
  metodoSaldo: string,
  executor: Executor = pool
): Promise<Cotizacion | null> {
  const result = await executor.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado_saldo = 'VALIDADO', metodo_saldo = $3, saldo_confirmado_en = CURRENT_TIMESTAMP, saldo_confirmado_por = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA' AND estado_saldo = 'PENDIENTE'
       AND estado_anticipo IN ('VALIDADO', 'NO_APLICA')
     RETURNING ${COLUMNAS}`,
    [id, confirmadoPor, metodoSaldo]
  );
  return result.rows[0] ?? null;
}

export async function rechazarSaldo(
  id: string,
  confirmadoPor: string,
  executor: Executor = pool
): Promise<Cotizacion | null> {
  const result = await executor.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado_saldo = 'RECHAZADO', saldo_confirmado_en = CURRENT_TIMESTAMP, saldo_confirmado_por = $2, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA' AND estado_saldo = 'PENDIENTE'
       AND estado_anticipo IN ('VALIDADO', 'NO_APLICA')
     RETURNING ${COLUMNAS}`,
    [id, confirmadoPor]
  );
  return result.rows[0] ?? null;
}

// H-E (auditoría post-V9): recuperación explícita de un saldo RECHAZADO —
// vuelve a PENDIENTE en un estado limpio (mismo estado que antes del
// primer intento): se borran metodo_saldo/comprobante_saldo/
// saldo_confirmado_en/_por para que "pueda presentarse nuevamente
// comprobante y gestionarse normalmente" (decisión explícita), sin
// arrastrar el método o comprobante del intento rechazado. Los comprobantes
// que subió el cliente no se pierden: quedan en comprobantes_pago_cliente (V19).
export async function reabrirSaldo(id: string): Promise<Cotizacion | null> {
  const result = await pool.query<Cotizacion>(
    `UPDATE cotizaciones
     SET estado_saldo = 'PENDIENTE', metodo_saldo = NULL, comprobante_saldo = NULL,
         saldo_confirmado_en = NULL, saldo_confirmado_por = NULL, actualizado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND estado = 'ACEPTADA' AND estado_saldo = 'RECHAZADO'
       AND estado_anticipo IN ('VALIDADO', 'NO_APLICA')
     RETURNING ${COLUMNAS}`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function guardarCodigoAcceso(id: string, hash: string): Promise<void> {
  await pool.query('UPDATE cotizaciones SET acceso_codigo_hash = $2 WHERE id = $1', [id, hash]);
}

// QA-06 (V23): bloqueo por intentos fallidos del código de acceso, persistente. Todo se decide en SQL con
// el reloj de la base: no depende de la memoria del proceso ni del reloj de la aplicación.
export async function accesoEstaBloqueado(id: string): Promise<boolean> {
  const result = await pool.query<{ bloqueado: boolean }>(
    'SELECT COALESCE(acceso_bloqueado_hasta > now(), false) AS bloqueado FROM cotizaciones WHERE id = $1',
    [id]
  );
  return result.rows[0]?.bloqueado ?? false;
}

// Suma un fallo (un bloqueo ya vencido reinicia la cuenta en 1; uno vigente no se modifica ni se extiende)
// y fija el bloqueo al llegar a `maxIntentos`. UPDATE atómico: dos fallos simultáneos no pierden la cuenta.
export async function registrarFalloAcceso(id: string, maxIntentos: number, bloqueoMs: number): Promise<void> {
  await pool.query(
    `UPDATE cotizaciones
     SET acceso_intentos_fallidos = CASE
           WHEN acceso_bloqueado_hasta > now() THEN acceso_intentos_fallidos
           WHEN acceso_bloqueado_hasta IS NOT NULL THEN 1
           ELSE acceso_intentos_fallidos + 1
         END,
         acceso_bloqueado_hasta = CASE
           WHEN acceso_bloqueado_hasta > now() THEN acceso_bloqueado_hasta
           WHEN (CASE WHEN acceso_bloqueado_hasta IS NOT NULL THEN 1 ELSE acceso_intentos_fallidos + 1 END) >= $2
             THEN now() + ($3::int * interval '1 millisecond')
           ELSE NULL
         END
     WHERE id = $1`,
    [id, maxIntentos, bloqueoMs]
  );
}

export async function limpiarFallosAcceso(id: string): Promise<void> {
  await pool.query(
    `UPDATE cotizaciones SET acceso_intentos_fallidos = 0, acceso_bloqueado_hasta = NULL
     WHERE id = $1 AND (acceso_intentos_fallidos <> 0 OR acceso_bloqueado_hasta IS NOT NULL)`,
    [id]
  );
}

export async function obtenerHashCodigoAcceso(id: string): Promise<string | null> {
  const result = await pool.query<{ acceso_codigo_hash: string | null }>(
    'SELECT acceso_codigo_hash FROM cotizaciones WHERE id = $1',
    [id]
  );
  return result.rows[0]?.acceso_codigo_hash ?? null;
}
