// Utilidades de presentación de la cotización pública del cliente: formato monetario y de fechas
// de Ecuador, etiquetas comprensibles para los estados y mensajes de «siguiente paso» derivados del
// estado real (nunca de un texto guardado de una acción anterior).

// ---------------------------------------------------------------------------
// Formato es-EC

// «1234.5» -> «$1.234,50». Los importes llegan del backend como texto numérico (NUMERIC de
// PostgreSQL); se formatean a mano para no depender del ICU del navegador (es-EC no agrupa los
// miles de 4 cifras). null/undefined/no numérico -> «—», nunca un importe inventado.
export function formatearMoneda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(numero)) return '—';

  const negativo = numero < 0;
  const [entero, decimales] = Math.abs(numero).toFixed(2).split('.');
  const agrupado = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}$${agrupado},${decimales}`;
}

// «15.00» -> «15 %». Sin dato -> «—».
export function formatearPorcentaje(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '—';
  return `${Number.isInteger(numero) ? numero : numero.toFixed(2).replace('.', ',')} %`;
}

// Fecha y hora en la zona horaria de Ecuador, en español. Fecha inválida -> «—».
export function formatearFechaHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ---------------------------------------------------------------------------
// Etiquetas de estado

const ETIQUETA_COTIZACION: Record<string, string> = {
  ENVIADA: 'Pendiente de tu respuesta',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  VENCIDA: 'Vencida',
  CANCELADA: 'Cancelada',
};

export function etiquetaEstadoCotizacion(estado: string): string {
  return ETIQUETA_COTIZACION[estado] ?? estado;
}

const ETIQUETA_PAGO: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  VALIDADO: 'Pago confirmado',
  RECHAZADO: 'Comprobante rechazado',
  NO_APLICA: 'No aplica',
};

export function etiquetaEstadoPago(estado: string | null | undefined): string {
  if (!estado) return '—';
  return ETIQUETA_PAGO[estado] ?? estado;
}

const ETIQUETA_METODO: Record<string, string> = { TRANSFERENCIA: 'Transferencia bancaria', EFECTIVO: 'Efectivo (presencial)' };

export function etiquetaMetodoPago(metodo: string | null | undefined): string {
  if (!metodo) return 'Por definir';
  return ETIQUETA_METODO[metodo] ?? metodo;
}

// Motivo de rechazo que ve el cliente (catálogo cerrado del backend). OTRO usa el detalle que escribió
// COMERCIAL. Nunca se muestra el código técnico.
export function textoMotivoRechazo(motivo: string | null | undefined, detalle: string | null | undefined): string {
  switch (motivo) {
    case 'COMPROBANTE_INCORRECTO':
      return 'El comprobante no corresponde a este pago.';
    case 'IMPORTE_INCORRECTO':
      return 'El importe del comprobante no coincide con el valor a pagar.';
    case 'COMPROBANTE_ILEGIBLE':
      return 'El comprobante no se puede leer con claridad.';
    case 'OTRO':
      return detalle?.trim() || 'Contacta a tu asesor comercial para conocer el detalle.';
    default:
      return 'El comprobante no pudo ser aceptado.';
  }
}

// ---------------------------------------------------------------------------
// Siguiente paso, derivado del estado vigente

export interface EstadoCotizacionParaMensaje {
  estado: string;
  estado_anticipo: string | null;
  metodo_anticipo: string | null;
  comprobante_recibido: boolean;
  estado_saldo: string;
  saldo_comprobante_recibido: boolean;
  saldo_habilitado: boolean;
}

// Una sola frase que describe la situación ACTUAL y qué debe hacer el cliente. Se recalcula con cada
// respuesta del backend, por lo que nunca queda un mensaje antiguo describiendo un estado ya superado.
export function mensajeSiguientePaso(c: EstadoCotizacionParaMensaje): string {
  switch (c.estado) {
    case 'ENVIADA':
      return 'Revisa las condiciones y acepta o rechaza la cotización.';
    case 'RECHAZADA':
      return 'Rechazaste esta cotización. Si cambias de opinión, contacta a tu asesor comercial.';
    case 'VENCIDA':
      return 'Esta cotización venció. Solicita una nueva a tu asesor comercial.';
    case 'CANCELADA':
      return 'Esta cotización fue cancelada.';
    case 'ACEPTADA':
      break;
    default:
      return '';
  }

  if (c.estado_saldo === 'VALIDADO') return 'Todos los pagos están confirmados. Gracias por tu confianza.';
  if (c.estado_saldo === 'RECHAZADO') return 'Corrige el comprobante del saldo y vuelve a subirlo.';
  if (c.saldo_comprobante_recibido) return 'Recibimos tu comprobante del saldo. Está en revisión; aún no se ha acreditado el pago.';

  switch (c.estado_anticipo) {
    case 'NO_APLICA':
      return 'No se requiere anticipo. El siguiente paso es el pago del saldo.';
    case 'RECHAZADO':
      return 'Corrige el comprobante del anticipo y vuelve a subirlo.';
    case 'PENDIENTE':
      if (c.metodo_anticipo === 'EFECTIVO') return 'Realiza el pago del anticipo de forma presencial.';
      return c.comprobante_recibido
        ? 'Recibimos tu comprobante del anticipo. Está en revisión; aún no se ha acreditado el pago.'
        : 'Realiza la transferencia del anticipo y sube tu comprobante.';
    case 'VALIDADO':
      return c.saldo_habilitado
        ? 'Tu anticipo está confirmado. El siguiente paso es el pago del saldo.'
        : 'Tu anticipo está confirmado.';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Archivo del comprobante

export const TIPOS_COMPROBANTE_ACEPTADOS = ['application/pdf', 'image/jpeg', 'image/png'];
export const COMPROBANTE_MAX_BYTES = 5 * 1024 * 1024;

// Mismos formatos y tamaño que valida el backend (que además revisa el contenido real). null = válido.
export function validarArchivoComprobante(archivo: { type: string; size: number }): string | null {
  if (!TIPOS_COMPROBANTE_ACEPTADOS.includes(archivo.type)) {
    return 'Formato no permitido. Solo se aceptan PDF, JPG o PNG.';
  }
  if (archivo.size > COMPROBANTE_MAX_BYTES) {
    return `El archivo excede el tamaño máximo permitido (${COMPROBANTE_MAX_BYTES / (1024 * 1024)} MB).`;
  }
  if (archivo.size === 0) {
    return 'El archivo está vacío.';
  }
  return null;
}

// «1.5 MB» / «320 KB» para mostrar junto al nombre.
export function formatearTamano(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function esImagen(tipo: string): boolean {
  return tipo === 'image/jpeg' || tipo === 'image/png';
}

// Con muchas cuentas receptoras, una cuadrícula de tarjetas vuelve la pantalla interminable: a partir de
// este número se ofrece un selector desplegable.
export const MAX_CUENTAS_COMO_TARJETAS = 5;

export function usarSelectorDeCuentas(totalCuentas: number): boolean {
  return totalCuentas > MAX_CUENTAS_COMO_TARJETAS;
}
