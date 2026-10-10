import type { Request, Response } from 'express';
import {
  listarSolicitudes,
  obtenerSolicitud,
  crearSolicitud,
  cambiarEstadoSolicitud,
  SolicitudNoEncontradaError,
  TransicionInvalidaError,
  EstadoInvalidoError,
} from '../services/solicitudes.service.js';
import { enviarConfirmacionSolicitud } from '../services/email.service.js';

export async function listarController(_req: Request, res: Response): Promise<void> {
  const solicitudes = await listarSolicitudes();
  res.status(200).json({ solicitudes });
}

export async function obtenerController(req: Request, res: Response): Promise<void> {
  const solicitud = await obtenerSolicitud(req.params.id);
  if (!solicitud) {
    res.status(404).json({ message: 'Solicitud no encontrada.' });
    return;
  }
  res.status(200).json({ solicitud });
}

export interface CuerpoSolicitudValidado {
  nombre: string;
  empresa: string | null;
  email: string;
  telefono: string;
  servicio: string;
  descripcion: string;
  cantidad: number;
  fechaRequerida: string | null;
  // FORMULARIO-01: presente únicamente cuando el propio cliente indicó "Aún
  // no lo sé" — `cantidad` igual queda en 1 (placeholder válido para el CHECK
  // de PostgreSQL), y esto es lo que distingue "1 pieza real" de "cantidad
  // sin definir todavía" para quien lea la solicitud.
  cantidadDesconocida: boolean;
}

// FORMULARIO-01: validación de teléfono ecuatoriano (celular 09XXXXXXXX o
// convencional 0[2-7]XXXXXXX; con o sin +593/593 como prefijo). Devuelve el
// valor NORMALIZADO a formato +593XXXXXXXXX para almacenar — nunca reescribe
// lo que el usuario ve en el campo del formulario (eso es responsabilidad
// exclusiva del frontend, que no toca el input mientras el usuario escribe).
const TELEFONO_EC_REGEX = /^0(9\d{8}|[2-7]\d{7})$/;

// FORMULARIO-UX-08.1 (autorización explícita — hallazgo de la auditoría
// FORMULARIO-UX-08): mismo regex ya usado por leads.controller.ts (y por
// ambos formularios del frontend) — antes este archivo solo comprobaba
// `email.includes('@')`, aceptando correos claramente inválidos
// ("carlos@", "carlos@empresa", "@empresa.com", "a@b@c.com") que su propio
// frontend ya rechazaba. Se corrige para que ambos endpoints públicos
// (/api/solicitudes y /api/leads) exijan el mismo formato real.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// SOLICITUD-RECUPERACION-01A (autorización explícita): formato aceptado
// para el encabezado Idempotency-Key — string opaco generado por el
// frontend (crypto.randomUUID(), 36 caracteres con guiones), validado de
// forma genérica (no se exige específicamente formato UUID, cualquier
// token razonable del mismo alfabeto cabe) y acotado al tamaño real de la
// columna `solicitudes.idempotency_key VARCHAR(100)` (migración V11).
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9_-]{8,100}$/;

export function normalizarTelefonoEc(valor: string): { valido: boolean; normalizado: string } {
  let limpio = valor.trim().replace(/[\s\-().]/g, '');
  if (limpio.startsWith('+593')) {
    limpio = '0' + limpio.slice(4);
  } else if (limpio.startsWith('593') && limpio.length === 12) {
    limpio = '0' + limpio.slice(3);
  }
  const valido = TELEFONO_EC_REGEX.test(limpio);
  return { valido, normalizado: valido ? '+593' + limpio.slice(1) : valor.trim() };
}

// Validación del cuerpo de una solicitud pública. Compartida por
// POST /api/solicitudes y por el formulario contextual de enlace de lead
// (mismos campos y mismas reglas base). Mensajes y orden de validación
// intactos para el consumidor por defecto (crearSolicitudPorEnlaceController,
// leads.controller.ts, que sigue llamando sin `opciones` — comportamiento
// EXACTAMENTE igual que antes, sin cambios).
//
// FORMULARIO-01: `opciones` es exclusivamente para POST /api/solicitudes
// (crearController, abajo) — valida teléfono EC estricto, admite "cantidad
// desconocida" y rechaza fecha_requerida pasada. Ninguna de estas 3 reglas
// nuevas se activa para el formulario de enlace de lead (fuera del alcance
// de este bloque — "no modificar otros flujos que no sean estrictamente
// necesarios").
export interface OpcionesValidacionSolicitud {
  validarTelefonoEc?: boolean;
  permitirCantidadDesconocida?: boolean;
  rechazarFechaPasada?: boolean;
}

export function validarCuerpoSolicitud(
  body: Record<string, unknown>,
  opciones: OpcionesValidacionSolicitud = {}
): { ok: true; data: CuerpoSolicitudValidado } | { ok: false; message: string } {
  const { nombre, empresa, email, telefono, servicio, descripcion, cantidad, cantidad_desconocida, fecha_requerida } = body;

  if (
    typeof nombre !== 'string' || !nombre.trim() || nombre.length > 150 ||
    typeof email !== 'string' || !email.trim() || email.length > 150 ||
    typeof telefono !== 'string' || !telefono.trim() || telefono.length > 30 ||
    typeof servicio !== 'string' || !servicio.trim() || servicio.length > 150 ||
    typeof descripcion !== 'string' || !descripcion.trim()
  ) {
    return {
      ok: false,
      message: 'nombre, email, telefono, servicio y descripcion son requeridos y deben tener un formato/longitud válidos.',
    };
  }

  // FORMULARIO-UX-08.1 (autorización explícita): validación de FORMATO real del correo,
  // separada de la comprobación anterior (igual patrón que `telefonoValidado` justo abajo) —
  // antes de este bloque, cualquier string con una "@" pasaba, sin importar el resto.
  if (!EMAIL_REGEX.test(email.trim())) {
    return {
      ok: false,
      message: 'Ingresa un correo electrónico válido.',
    };
  }

  let telefonoValidado = telefono;
  if (opciones.validarTelefonoEc) {
    const resultado = normalizarTelefonoEc(telefono);
    if (!resultado.valido) {
      // FORMULARIO-UX-06.1 (autorización explícita): mismo mensaje comprensible
      // que el frontend (validarFormularioLocal en App.tsx) — cubre tanto un
      // formato inválido como el intento de escribir más de un número.
      return {
        ok: false,
        message: 'Ingresa un solo número de contacto válido de Ecuador.',
      };
    }
    telefonoValidado = resultado.normalizado;
  }

  if (empresa !== undefined && empresa !== null && (typeof empresa !== 'string' || empresa.length > 150)) {
    return { ok: false, message: 'empresa debe ser texto de hasta 150 caracteres.' };
  }

  const pideCantidadDesconocida = opciones.permitirCantidadDesconocida === true && cantidad_desconocida === true;
  let cantidadNum: number;
  if (pideCantidadDesconocida) {
    cantidadNum = 1;
  } else {
    cantidadNum = typeof cantidad === 'number' ? cantidad : Number(cantidad);
    if (cantidad === undefined || cantidad === null || cantidad === '' || !Number.isInteger(cantidadNum) || cantidadNum <= 0) {
      return { ok: false, message: 'cantidad es requerida y debe ser un número entero mayor que 0.' };
    }
  }

  let fechaRequerida: string | null = null;
  if (fecha_requerida !== undefined && fecha_requerida !== null && fecha_requerida !== '') {
    if (typeof fecha_requerida !== 'string' || Number.isNaN(Date.parse(fecha_requerida))) {
      return { ok: false, message: 'fecha_requerida no es una fecha válida.' };
    }
    if (opciones.rechazarFechaPasada) {
      // Comparación por día calendario (no por instante): "hoy" sigue siendo válido.
      const hoy = new Date();
      const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
      if (fecha_requerida.slice(0, 10) < hoyStr) {
        return { ok: false, message: 'fecha_requerida no puede ser una fecha pasada.' };
      }
    }
    fechaRequerida = fecha_requerida;
  }

  return {
    ok: true,
    data: {
      nombre,
      empresa: typeof empresa === 'string' ? empresa : null,
      email,
      telefono: telefonoValidado,
      servicio,
      descripcion,
      cantidad: cantidadNum,
      fechaRequerida,
      cantidadDesconocida: pideCantidadDesconocida,
    },
  };
}

export async function crearController(req: Request, res: Response): Promise<void> {
  // SOLICITUD-RECUPERACION-01A (autorización explícita, Bloque C/T7/T8): se
  // valida ANTES que el cuerpo — es metadato de la operación HTTP, no un
  // dato del formulario. Formato: string no vacío, 8-100 caracteres,
  // [A-Za-z0-9_-] (mismo largo que la columna, VARCHAR(100) — ver V11).
  // Ausente o con formato inválido -> 400 (preferencia explícita del bloque:
  // "400 controlado, si no existe una razón arquitectónica para hacerlo
  // opcional" — no existe tal razón: es el único consumidor real de este
  // endpoint, el formulario público, que siempre puede generarla).
  const idempotencyKeyHeader = req.header('Idempotency-Key');
  if (typeof idempotencyKeyHeader !== 'string' || !idempotencyKeyHeader.trim()) {
    res.status(400).json({ message: 'El encabezado Idempotency-Key es requerido.' });
    return;
  }
  const idempotencyKey = idempotencyKeyHeader.trim();
  if (!IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
    res.status(400).json({ message: 'El encabezado Idempotency-Key no tiene un formato válido.' });
    return;
  }

  const validacion = validarCuerpoSolicitud((req.body ?? {}) as Record<string, unknown>, {
    validarTelefonoEc: true,
    permitirCantidadDesconocida: true,
    rechazarFechaPasada: true,
  });
  if (!validacion.ok) {
    res.status(400).json({ message: validacion.message });
    return;
  }

  // Bloque Q (seguridad, SOLICITUD-RECUPERACION-01A): la respuesta sigue
  // siendo exactamente la misma que ya devolvía este endpoint para una
  // creación exitosa (el objeto `solicitud` completo, vía COLUMNAS) tanto si
  // se creó ahora como si se devolvió la existente por repetición de la
  // misma clave — nunca se agrega idempotency_key ni ningún dato adicional
  // de la solicitud a la respuesta pública.
  const resultado = await crearSolicitud(validacion.data, idempotencyKey);

  // SOLICITUD-RECUPERACION-01B (autorización explícita): el correo se envía
  // SIEMPRE DESPUÉS de que crearSolicitud() ya hizo su COMMIT real — nunca
  // dentro de esa transacción. Solo se intenta cuando esNueva=true (una
  // repetición idempotente NUNCA reenvía el correo — ver
  // "IMPORTANTE SOBRE EMAIL DUPLICADO" del informe: la detección es el
  // propio mecanismo de 01A, sin persistencia adicional). El `try/catch` es
  // una segunda red de seguridad (enviarConfirmacionSolicitud ya nunca
  // lanza por diseño): un fallo de Brevo NUNCA debe afectar esta respuesta
  // 201, que ya representa una solicitud real y válida.
  let emailConfirmation: 'sent' | 'failed' | 'skipped' = 'skipped';
  if (resultado.esNueva && resultado.destinatario) {
    try {
      const envio = await enviarConfirmacionSolicitud({
        destinatarioEmail: resultado.destinatario.email,
        destinatarioNombre: resultado.destinatario.nombre,
        solicitudCodigo: resultado.solicitud.codigo ?? '',
      });
      emailConfirmation = envio.estado;
    } catch {
      emailConfirmation = 'failed';
    }
  }

  // `emailConfirmation` es un indicador adicional, no sensible — el
  // contrato existente (`solicitud` con el mismo shape de siempre) no se
  // toca; el frontend sigue sin depender de este campo para considerar
  // exitoso el registro (sigue siendo 201 + `solicitud.codigo`).
  res.status(201).json({ solicitud: resultado.solicitud, emailConfirmation });
}

export async function cambiarEstadoController(req: Request, res: Response): Promise<void> {
  const { estado } = (req.body ?? {}) as { estado?: unknown };

  if (typeof estado !== 'string' || !estado.trim()) {
    res.status(400).json({ message: 'estado es requerido.' });
    return;
  }

  try {
    const solicitud = await cambiarEstadoSolicitud(req.params.id, estado.trim());
    res.status(200).json({ solicitud });
  } catch (error) {
    if (error instanceof SolicitudNoEncontradaError) {
      res.status(404).json({ message: 'Solicitud no encontrada.' });
      return;
    }
    if (error instanceof TransicionInvalidaError) {
      res.status(409).json({ message: 'Transición de estado no permitida.' });
      return;
    }
    if (error instanceof EstadoInvalidoError) {
      res.status(400).json({ message: 'Estado inválido.' });
      return;
    }
    throw error;
  }
}
