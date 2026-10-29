// Caducidad de las cotizaciones (#4/#5). Una cotización ENVIADA vence automáticamente al cumplirse su fecha de
// caducidad (el backend la marca VENCIDA al consultarla); por eso la interfaz ya no ofrece «Marcar vencida».

export const ETIQUETA_CADUCIDAD = 'Fecha de caducidad';

// Mensaje que ve el cliente cuando el enlace es de una cotización vencida (el backend responde 410).
export const MENSAJE_CLIENTE_COTIZACION_VENCIDA = 'Esta cotización caducó. Consulte con su asesor comercial.';

// Aviso interno junto a la fecha de caducidad. Solo la VENCIDA lleva aviso.
// La fecha solo se cita si ya pasó: una cotización dada de baja antes de tiempo por la API no «caducó el» una fecha futura.
export function avisoCaducidad(estado: string, fechaVigencia: string | null, ahora: Date = new Date()): string | null {
  if (estado !== 'VENCIDA') return null;
  const pasada = fechaVigencia !== null && new Date(fechaVigencia).getTime() <= ahora.getTime();
  const cuando = pasada ? ` el ${new Date(fechaVigencia as string).toLocaleString()}` : '';
  return `Esta cotización caducó${cuando}. El cliente debe consultar con su asesor comercial.`;
}

// Explicación del estado cuando ya no admite acciones.
export function explicacionEstadoSinAcciones(estado: string): string {
  switch (estado) {
    case 'VENCIDA':
      return 'Venció automáticamente al cumplirse su fecha de caducidad. El enlace del cliente le informa que caducó.';
    case 'CANCELADA':
      return 'Fue cancelada. El enlace del cliente ya no muestra sus datos.';
    default:
      return 'Este estado no admite más transiciones.';
  }
}

// Nota bajo las acciones de una cotización enviada: recuerda que no hay que vencerla a mano.
export function notaVencimientoAutomatico(estado: string): string | null {
  return estado === 'ENVIADA' ? 'Vence automáticamente al cumplirse su fecha de caducidad.' : null;
}
