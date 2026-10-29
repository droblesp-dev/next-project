// #7: contadores de mensajes pendientes. El backend entrega, por solicitud, cuántos mensajes del rol contrario
// (visibles y autorizados) no ha leído el usuario; aquí solo se transforma y se presenta ese dato.
export interface PendientesRespuesta {
  activo: boolean;
  total: number;
  por_solicitud: Array<{ solicitud_id: string; pendientes: number }>;
}

export type PendientesPorSolicitud = Record<string, number>;

// Convierte la respuesta del backend en un mapa solicitud -> cantidad, ignorando entradas sin pendientes o inválidas.
export function pendientesPorSolicitud(respuesta: PendientesRespuesta | null | undefined): PendientesPorSolicitud {
  const mapa: PendientesPorSolicitud = {};
  if (!respuesta || !respuesta.activo || !Array.isArray(respuesta.por_solicitud)) return mapa;
  for (const fila of respuesta.por_solicitud) {
    if (fila && typeof fila.solicitud_id === 'string' && Number.isFinite(fila.pendientes) && fila.pendientes > 0) {
      mapa[fila.solicitud_id] = Math.floor(fila.pendientes);
    }
  }
  return mapa;
}

// El icono solo se muestra cuando hay pendientes.
export function hayPendientes(pendientes: number | undefined): boolean {
  return typeof pendientes === 'number' && pendientes > 0;
}

// Texto del contador: tope visual «99+» para no desbordar la insignia.
export function textoContador(pendientes: number): string {
  return pendientes > 99 ? '99+' : String(pendientes);
}

export function etiquetaMensajesPendientes(pendientes: number): string {
  return pendientes === 1 ? 'Abrir mensajes de la solicitud: 1 mensaje sin leer' : `Abrir mensajes de la solicitud: ${pendientes} mensajes sin leer`;
}

// Intervalo de consulta periódica (sin WebSockets) mientras la pestaña está visible.
export const INTERVALO_PENDIENTES_MS = 45_000;
