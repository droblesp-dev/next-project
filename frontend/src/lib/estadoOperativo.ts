// #2: qué le toca gestionar a Operativo según el estado de la orden. Resume las reglas reales del backend
// (ordenes.service.ts): PENDIENTE → EN_PROCESO; EN_PROCESO → PAUSADA o FINALIZADA (con avance 100, al menos una
// evidencia y una observación final); PAUSADA → EN_PROCESO. La entrega y el cierre los confirma Comercial/Admin.

export interface GestionOperativo {
  estado: string;
  accion: string;
  puedeActuar: boolean;
}

const ETIQUETA: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  EN_PROCESO: 'En proceso',
  PAUSADA: 'Pausada',
  FINALIZADA: 'Finalizada',
  CERRADA: 'Cerrada',
  CANCELADA: 'Cancelada',
};

export function gestionOperativo(estado: string, avance: number): GestionOperativo {
  const nombre = ETIQUETA[estado] ?? estado.replace(/_/g, ' ');
  switch (estado) {
    case 'PENDIENTE':
      return { estado: nombre, puedeActuar: true, accion: 'Iniciarla: pasarla a EN PROCESO. El avance solo puede registrarse una vez iniciada.' };
    case 'EN_PROCESO':
      return {
        estado: nombre,
        puedeActuar: true,
        accion:
          avance >= 100
            ? 'Finalizarla (requiere al menos una evidencia y una observación final) o pausarla.'
            : 'Registrar el avance hasta 100 %, subir al menos una evidencia y una observación final para poder finalizarla; también puede pausarla.',
      };
    case 'PAUSADA':
      return { estado: nombre, puedeActuar: true, accion: 'Reanudarla (EN PROCESO) cuando corresponda.' };
    case 'FINALIZADA':
      return { estado: nombre, puedeActuar: false, accion: 'Sin acciones de Operativo: la entrega y el cierre los confirma Comercial o Administración.' };
    case 'CERRADA':
      return { estado: nombre, puedeActuar: false, accion: 'Orden cerrada: sin acciones.' };
    case 'CANCELADA':
      return { estado: nombre, puedeActuar: false, accion: 'Orden cancelada: sin acciones.' };
    default:
      return { estado: nombre, puedeActuar: false, accion: 'Sin acciones disponibles.' };
  }
}
