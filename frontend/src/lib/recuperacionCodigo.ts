// Recuperación del código de acceso de la cotización pública (QA-13). El backend ya expone
// POST /api/cotizaciones/publica/:token/recuperar-codigo/solicitar y /verificar; aquí solo se traducen sus
// estados a mensajes. Nunca se muestra ni se insinúa el correo del cliente.

export type EstadoSolicitudOtp = 'enviado' | 'no_disponible' | 'bloqueado';
export type EstadoVerificacionOtp = 'regenerado' | 'incorrecto' | 'vencido' | 'bloqueado' | 'no_disponible';

const CONTACTAR_ASESOR = 'Comuníquese con su asesor comercial.';

export function mensajeSolicitudOtp(estado: EstadoSolicitudOtp): { texto: string; avanza: boolean } {
  switch (estado) {
    case 'enviado':
      return {
        texto: 'Enviamos un código temporal de 6 dígitos al correo registrado en su solicitud. Ingréselo aquí para recibir un nuevo código de acceso.',
        avanza: true,
      };
    case 'bloqueado':
      return { texto: `Demasiados intentos. Espere unos minutos e intente de nuevo. ${CONTACTAR_ASESOR}`, avanza: false };
    default:
      return { texto: `No pudimos enviar el código temporal en este momento. ${CONTACTAR_ASESOR}`, avanza: false };
  }
}

export function mensajeVerificacionOtp(estado: EstadoVerificacionOtp): { texto: string; exito: boolean; reiniciar: boolean } {
  switch (estado) {
    case 'regenerado':
      return { texto: 'Listo: le enviamos por correo un nuevo código de acceso. Úselo en el campo de arriba para ver su cotización.', exito: true, reiniciar: false };
    case 'incorrecto':
      return { texto: 'El código temporal es incorrecto.', exito: false, reiniciar: false };
    case 'vencido':
      return { texto: 'El código temporal venció. Solicite uno nuevo.', exito: false, reiniciar: true };
    case 'bloqueado':
      return { texto: `Demasiados intentos. Espere unos minutos e intente de nuevo. ${CONTACTAR_ASESOR}`, exito: false, reiniciar: true };
    default:
      return { texto: `No se pudo completar la recuperación. ${CONTACTAR_ASESOR}`, exito: false, reiniciar: true };
  }
}
