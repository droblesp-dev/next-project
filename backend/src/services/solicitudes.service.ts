import { pool } from '../config/db.js';
import * as clientesRepo from '../repositories/clientes.repository.js';
import * as solicitudesRepo from '../repositories/solicitudes.repository.js';
import * as leadsRepo from '../repositories/leads.repository.js';
import type { Solicitud } from '../repositories/solicitudes.repository.js';

export class SolicitudNoEncontradaError extends Error {}
export class TransicionInvalidaError extends Error {}
export class EstadoInvalidoError extends Error {}

// SOLICITUD-RECUPERACION-01A: distingue específicamente el conflicto de la
// restricción UNIQUE de idempotencia (uq_solicitudes_idempotency_key) de
// cualquier otro error de PostgreSQL — nunca se trata como "repetición de
// la misma operación" un error distinto (ver crearSolicitud más abajo).
function esConflictoIdempotencyKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505' &&
    (error as { constraint?: string }).constraint === 'uq_solicitudes_idempotency_key'
  );
}

const ESTADOS_VALIDOS = ['NUEVA', 'EN_REVISION', 'COTIZADA', 'CANCELADA'];

// Transiciones aprobadas para Fase 4 (origen -> destinos permitidos).
// COTIZADA y CANCELADA son terminales (sin destinos).
//
// COTIZADA se retira como destino alcanzable desde aquí (autorización
// explícita — "IMPLEMENTACIÓN AUTORIZADA — SOLICITUDES COMERCIAL"): deja de
// ser una transición manual. La única vía real hacia COTIZADA pasa a ser el
// efecto transaccional de cotizaciones.service.ts::cambiarEstadoCotizacion()
// al formalizar una cotización como ENVIADA (ver ese archivo) — un UPDATE
// interno directo sobre la tabla, no una llamada a esta función. Por eso
// 'COTIZADA' sigue en ESTADOS_VALIDOS (sigue siendo un valor legítimo de
// solicitudes.estado) pero ya no aparece como destino de ningún origen: una
// llamada externa a cambiarEstadoSolicitud(id, 'COTIZADA') ahora siempre
// falla con TransicionInvalidaError, cerrando también la vía de backend, no
// solo ocultando el botón en el frontend.
const TRANSICIONES: Record<string, string[]> = {
  NUEVA: ['EN_REVISION', 'CANCELADA'],
  EN_REVISION: ['CANCELADA'],
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
  // FORMULARIO-01: cuando es true, la solicitud lleva una nota en
  // `especificaciones` ("cantidad aún no definida") y además se crea el
  // Lead TIBIO vinculado (ver más abajo) — ninguna otra regla cambia.
  cantidadDesconocida?: boolean;
}

// FORMULARIO-01 (autorización explícita — "CIERRE DEL FORMULARIO PÚBLICO
// NEXTPROJECT"): flujo find-or-create de cliente + creación de solicitud +
// creación del Lead TIBIO vinculado, dentro de una única transacción
// (extensión de la decisión aprobada 2.5, mismo patrón). Garantiza
// atomicidad entre las 3 escrituras — si cualquiera falla, ROLLBACK
// completo (no queda cliente/solicitud sin Lead, ni Lead sin solicitud).
// NO garantiza unicidad de clientes.email (ver 2.4, sin cambios).
//
// El Lead nace SIEMPRE TIBIO + ACTIVO + fuente 'WEB' (decisión explícita del
// bloque — el formulario público no pregunta "cómo nos encontraste"; ver
// leadsRepo.createConVinculo). Esta función es EXCLUSIVA de POST
// /api/solicitudes: crearSolicitudPorEnlace() (leads.service.ts) sigue su
// propio camino sin cambios — ese flujo ya tiene un Lead previo (el que el
// comercial contactó), por lo que jamás debe crear uno nuevo aquí.
//
// SOLICITUD-RECUPERACION-01A (autorización explícita, migración V11):
// `idempotencyKey` identifica la OPERACIÓN DE ENVÍO (no al cliente ni a sus
// datos) — la genera el frontend y la reutiliza en cada reintento de la
// MISMA operación (pérdida de respuesta, doble pestaña, doble clic efectivo
// pese a `enviandoRef`). Si el INSERT de solicitudesRepo.create() choca con
// la restricción UNIQUE uq_solicitudes_idempotency_key (porque otra
// ejecución de esta función, para la misma clave, ya hizo COMMIT antes),
// TODA la transacción se revierte aquí (cliente y lead incluidos, si se
// habían llegado a crear) y se devuelve la solicitud YA existente — nunca
// una segunda fila, nunca un segundo Lead (ver el `catch` más abajo). La
// garantía de "1 sola Solicitud" bajo concurrencia real la da la
// restricción UNIQUE + el bloqueo que PostgreSQL aplica sobre un valor
// indexado en conflicto entre transacciones simultáneas — no un SELECT
// previo sin protección (ver informe del bloque).
export interface ResultadoCrearSolicitud {
  solicitud: Solicitud;
  // SOLICITUD-RECUPERACION-01B (autorización explícita): distingue una
  // creación real (COMMIT nuevo) de una repetición idempotente (misma
  // operación reintentada) — sin esto, el controller no podría saber si
  // debe disparar el correo de confirmación o no. Es una señal puramente en
  // memoria de ESTA llamada (nunca se persiste, no se necesita estructura
  // nueva): "preferir alcance mínimo" del bloque.
  esNueva: boolean;
  // Datos mínimos para dirigir el correo de confirmación — SOLO presente
  // cuando esNueva=true (en una repetición, el correo original ya se envió
  // o se decidió no enviarlo en el intento que sí creó la fila; nunca se
  // reenvía por una repetición de la misma operación — ver informe,
  // "IMPORTANTE SOBRE EMAIL DUPLICADO").
  destinatario: { nombre: string; email: string } | null;
}

export async function crearSolicitud(
  input: CrearSolicitudInput,
  idempotencyKey: string
): Promise<ResultadoCrearSolicitud> {
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
      especificaciones: input.cantidadDesconocida
        ? 'Cantidad: el cliente indicó que aún no la conoce (a definir en la revisión comercial).'
        : null,
      idempotencyKey,
    });

    // ASISTENTE-COMERCIAL-05 (autorización explícita — "evitar duplicación de
    // Lead entre ambos formularios", CORREGIDO tras revisión de T5): antes de
    // crear un lead nuevo, se busca uno YA EXISTENTE con el mismo teléfono
    // normalizado + correo normalizado (coincidencia ALTA — `input.telefono`
    // ya llega normalizado a +593XXXXXXXXX desde `validarCuerpoSolicitud`,
    // único llamador real de esta función) QUE AÚN NO ESTÉ VINCULADO A
    // NINGUNA SOLICITUD (`buscarLeadOrfanoPorTelefonoYEmail`, no la búsqueda
    // general). Esto es deliberado y crítico: un lead que ya pertenece a una
    // Solicitud anterior del mismo Cliente NUNCA se reutiliza ni se le
    // reescribe su `solicitud_id` — cada Solicitud nueva del formulario
    // principal conserva SIEMPRE su propio lead, aunque el teléfono y el
    // correo sean idénticos a una Solicitud previa (múltiples Solicitudes
    // legítimas, decisión explícita — ver informe). Solo se reutiliza un
    // lead "huérfano" (típicamente, uno nacido de "Hablar con un asesor" que
    // todavía no se había vinculado a ninguna Solicitud). Si existe uno así
    // y sigue en un estado reutilizable, se vincula a este Cliente/Solicitud
    // (promueve FRIO->TIBIO sin degradar) dentro de la MISMA transacción. Si
    // no existe ninguno huérfano, se crea un lead nuevo TIBIO+ACTIVO,
    // exactamente como antes de este bloque.
    let leadReutilizado = null;
    if (emailNormalizado) {
      const leadExistente = await leadsRepo.buscarLeadOrfanoPorTelefonoYEmail(client, input.telefono.trim(), emailNormalizado);
      if (leadExistente) {
        leadReutilizado = await leadsRepo.reutilizarParaSolicitud(client, {
          leadId: leadExistente.id,
          clienteId: cliente.id,
          solicitudId: solicitud.id,
        });
      }
    }

    if (!leadReutilizado) {
      await leadsRepo.createConVinculo(client, {
        nombre: input.nombre.trim(),
        telefono: input.telefono.trim(),
        email: emailNormalizado,
        fuente: 'WEB',
        clienteId: cliente.id,
        solicitudId: solicitud.id,
      });
    }

    await client.query('COMMIT');
    return { solicitud, esNueva: true, destinatario: { nombre: cliente.nombre, email: cliente.email } };
  } catch (error) {
    await client.query('ROLLBACK');
    // SOLICITUD-RECUPERACION-01A: si el INSERT chocó específicamente con la
    // restricción UNIQUE de idempotency_key, esta petición NO es una
    // operación nueva — es la MISMA operación de envío reintentada (pérdida
    // de respuesta HTTP, dos pestañas, retry). La solicitud original ya
    // quedó comprometida por el intento que sí llegó a hacer COMMIT (en esta
    // misma ejecución concurrente o en una anterior) — se devuelve esa fila
    // ya existente en lugar de propagar el error, sin crear una segunda
    // Solicitud ni un segundo Lead. Cualquier otro error (incluida una
    // violación de unicidad distinta) se relanza sin tocar, igual que antes.
    if (esConflictoIdempotencyKey(error)) {
      const existente = await solicitudesRepo.findByIdempotencyKey(client, idempotencyKey);
      if (existente) {
        return { solicitud: existente, esNueva: false, destinatario: null };
      }
    }
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
