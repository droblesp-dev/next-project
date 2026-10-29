// Resumen de los accesos que el modo SOMBRA del chat habría denegado (evento CHAT_ACCESO_SOMBRA_DENEGADO). Lee las líneas JSON
// del registro del servidor, que solo contienen usuario, solicitud, operación y fecha (nunca contenido de mensajes), y calcula
// los indicadores de la condición de salida a modo estricto: tolerancia cero a accesos legítimos denegados sin explicar en la
// ventana indicada (por defecto, 7 días). Función pura: no toca la base de datos ni el sistema de archivos.
export interface EventoSombra {
  fecha: string;
  usuarioId: string;
  solicitudId: string;
  operacion: string;
}

export interface OpcionesResumen {
  ahora?: Date;
  // Ventana en días para la condición de salida.
  dias?: number;
  // Pares «usuarioId|solicitudId» ya explicados y aceptados (por ejemplo, un OPERATIVO que aún no fue incorporado).
  explicados?: ReadonlySet<string>;
}

export interface ResumenSombra {
  totalEventos: number;
  eventosEnVentana: number;
  porDia: Record<string, number>;
  porOperacion: Record<string, number>;
  paresEnVentana: Array<{ usuarioId: string; solicitudId: string; eventos: number; operaciones: string[]; ultimaFecha: string; explicado: boolean }>;
  sinExplicarEnVentana: number;
  // La condición 3 de salida a estricto se cumple si no queda ningún par sin explicar en la ventana.
  cumpleCondicion: boolean;
}

export function interpretarLinea(linea: string): EventoSombra | null {
  const texto = linea.trim();
  if (!texto.startsWith('{') || !texto.includes('CHAT_ACCESO_SOMBRA_DENEGADO')) return null;
  try {
    const dato = JSON.parse(texto) as Record<string, unknown>;
    if (dato.tipo !== 'SEGURIDAD' || dato.evento !== 'CHAT_ACCESO_SOMBRA_DENEGADO') return null;
    const { fecha, usuarioId, solicitudId, operacion } = dato;
    if (typeof fecha !== 'string' || typeof usuarioId !== 'string' || typeof solicitudId !== 'string' || typeof operacion !== 'string') return null;
    if (Number.isNaN(new Date(fecha).getTime())) return null;
    return { fecha, usuarioId, solicitudId, operacion };
  } catch {
    return null;
  }
}

export function resumirSombra(lineas: Iterable<string>, opciones: OpcionesResumen = {}): ResumenSombra {
  const ahora = opciones.ahora ?? new Date();
  const dias = opciones.dias ?? 7;
  const explicados = opciones.explicados ?? new Set<string>();
  const desde = ahora.getTime() - dias * 86_400_000;

  const resumen: ResumenSombra = {
    totalEventos: 0,
    eventosEnVentana: 0,
    porDia: {},
    porOperacion: {},
    paresEnVentana: [],
    sinExplicarEnVentana: 0,
    cumpleCondicion: true,
  };
  const pares = new Map<string, { usuarioId: string; solicitudId: string; eventos: number; operaciones: Set<string>; ultima: string }>();

  for (const linea of lineas) {
    const evento = interpretarLinea(linea);
    if (!evento) continue;
    resumen.totalEventos += 1;
    const instante = new Date(evento.fecha).getTime();
    if (instante < desde || instante > ahora.getTime()) continue;
    resumen.eventosEnVentana += 1;
    const dia = evento.fecha.slice(0, 10);
    resumen.porDia[dia] = (resumen.porDia[dia] ?? 0) + 1;
    resumen.porOperacion[evento.operacion] = (resumen.porOperacion[evento.operacion] ?? 0) + 1;
    const clave = `${evento.usuarioId}|${evento.solicitudId}`;
    const par = pares.get(clave) ?? { usuarioId: evento.usuarioId, solicitudId: evento.solicitudId, eventos: 0, operaciones: new Set<string>(), ultima: evento.fecha };
    par.eventos += 1;
    par.operaciones.add(evento.operacion);
    if (evento.fecha > par.ultima) par.ultima = evento.fecha;
    pares.set(clave, par);
  }

  for (const [clave, par] of pares) {
    const explicado = explicados.has(clave);
    resumen.paresEnVentana.push({
      usuarioId: par.usuarioId,
      solicitudId: par.solicitudId,
      eventos: par.eventos,
      operaciones: [...par.operaciones].sort(),
      ultimaFecha: par.ultima,
      explicado,
    });
    if (!explicado) resumen.sinExplicarEnVentana += 1;
  }
  resumen.paresEnVentana.sort((a, b) => b.eventos - a.eventos);
  resumen.cumpleCondicion = resumen.sinExplicarEnVentana === 0;
  return resumen;
}
