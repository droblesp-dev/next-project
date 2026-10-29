// Lógica pura de la gestión de pagos de COMERCIAL («Dinero acreditado», seguimiento y bloqueo del saldo). Sin React ni
// red: las reglas de presentación se prueban aparte (dineroAcreditado.test.ts). El backend sigue siendo la autoridad:
// estas funciones solo evitan viajes inútiles y explican por qué una acción no está disponible.

export type TipoPago = 'ANTICIPO' | 'SALDO';

// Hace falta una gestión vigente PENDIENTE para considerar que COMERCIAL revisó el comprobante.
export interface GestionVigente {
  estado: string;
}

export const MENSAJE_SALDO_BLOQUEADO =
  'El saldo no puede gestionarse mientras el anticipo no esté VALIDADO o NO_APLICA.';

// El saldo solo se gestiona con el anticipo VALIDADO o NO_APLICA (PENDIENTE, RECHAZADO y vacío lo bloquean).
export function saldoBloqueadoPorAnticipo(estadoAnticipo: string | null | undefined): boolean {
  return !(estadoAnticipo === 'VALIDADO' || estadoAnticipo === 'NO_APLICA');
}

// «Dinero acreditado» solo para transferencias; el efectivo conserva su flujo propio y no se presenta como una
// acreditación bancaria.
export function etiquetaAccionAcreditacion(metodo: string | null | undefined): string {
  return metodo === 'EFECTIVO' ? 'EFECTIVO RECIBIDO' : 'DINERO ACREDITADO';
}

export function etiquetaConfirmarAcreditacion(metodo: string | null | undefined): string {
  return metodo === 'EFECTIVO' ? 'CONFIRMAR EFECTIVO RECIBIDO' : 'CONFIRMAR DINERO ACREDITADO';
}

export function textoAclaracionAcreditacion(metodo: string | null | undefined): string {
  return metodo === 'EFECTIVO'
    ? 'Registro de que ADMIN confirmó por teléfono que recibió el efectivo. No es una acreditación bancaria.'
    : 'Registro de que ADMIN confirmó por teléfono que el dinero ingresó a la cuenta. Es una confirmación comunicada por teléfono, no una verificación bancaria automática.';
}

export interface EvaluacionAcreditacion {
  permitido: boolean;
  motivo: string | null;
}

// Requisitos para registrar «Dinero acreditado». Anticipo por TRANSFERENCIA: comprobante del cliente + revisión previa de
// COMERCIAL (gestión vigente PENDIENTE). Saldo por TRANSFERENCIA: comprobante del saldo. Efectivo: sin comprobante.
export function evaluarAcreditacion(datos: {
  tipoPago: TipoPago;
  metodo: string | null | undefined;
  comprobanteRecibido: boolean;
  gestionVigente: GestionVigente | null | undefined;
}): EvaluacionAcreditacion {
  if (datos.metodo !== 'TRANSFERENCIA') return { permitido: true, motivo: null };
  if (!datos.comprobanteRecibido) {
    return {
      permitido: false,
      motivo:
        datos.tipoPago === 'ANTICIPO'
          ? 'El cliente todavía no ha subido el comprobante del anticipo.'
          : 'El cliente todavía no ha subido el comprobante del saldo.',
    };
  }
  if (datos.tipoPago === 'ANTICIPO' && datos.gestionVigente?.estado !== 'PENDIENTE') {
    return { permitido: false, motivo: 'Registre primero la gestión (revisión) del comprobante.' };
  }
  return { permitido: true, motivo: null };
}

// Un seguimiento (ADMIN sin respuesta, el dinero todavía no aparece) anota una observación sobre una gestión ya
// registrada: no puede ser la primera.
export function puedeRegistrarSeguimiento(gestionVigente: GestionVigente | null | undefined): boolean {
  return gestionVigente?.estado === 'PENDIENTE';
}

// Convierte el valor de un <input type="datetime-local"> (hora local, sin zona) en ISO 8601. Vacío = la hora de la
// llamada no se conoce (se envía null: nunca se sustituye por la hora del registro). No admite fechas futuras.
export function llamadaAIso(
  valor: string,
  ahora: Date = new Date()
): { iso: string | null; error: string | null } {
  const texto = valor.trim();
  if (texto === '') return { iso: null, error: null };
  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) {
    return { iso: null, error: 'La fecha y hora de la llamada no son válidas.' };
  }
  if (fecha.getTime() > ahora.getTime() + 5 * 60 * 1000) {
    return { iso: null, error: 'La hora de la llamada no puede ser posterior al momento actual.' };
  }
  return { iso: fecha.toISOString(), error: null };
}

export const OBSERVACIONES_MAX = 1000;

export function validarObservaciones(texto: string, obligatoria: boolean): string | null {
  const limpio = texto.trim();
  if (obligatoria && limpio === '') return 'Escriba una observación (por ejemplo: «ADMIN no respondió»).';
  if (limpio.length > OBSERVACIONES_MAX) return `Las observaciones no pueden superar ${OBSERVACIONES_MAX} caracteres.`;
  return null;
}

// Línea de trazabilidad del historial: quién verificó (ADMIN) y quién registró (COMERCIAL).
export function lineaTrazabilidad(transferencia: {
  verificado_por_nombre?: string | null;
  registrado_por_nombre?: string | null;
}): string | null {
  const partes: string[] = [];
  if (transferencia.verificado_por_nombre) partes.push(`Verificó (ADMIN): ${transferencia.verificado_por_nombre}`);
  if (transferencia.registrado_por_nombre) partes.push(`Registró: ${transferencia.registrado_por_nombre}`);
  return partes.length > 0 ? partes.join(' · ') : null;
}
