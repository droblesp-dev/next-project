// #4 (parte de impresión / PDF): hoja imprimible de una cotización. Se construye únicamente con los importes oficiales que ya
// calculó el backend (subtotal, IVA, total, anticipo, saldo) y con los datos que la pantalla ya muestra; nunca recalcula ni
// inventa importes. No incluye el código de acceso, el enlace, datos bancarios ni teléfonos: el cliente consulta el pago en el
// enlace de la cotización. El PDF lo produce el propio navegador («Guardar como PDF» del diálogo de impresión), sin dependencias.
import { etiquetaMetodoPago, formatearFechaHora, formatearMoneda, formatearPorcentaje } from './cotizacionPublica';

export const NOMBRE_EMPRESA_HOJA = 'NEXTPROJECT';
export const SUBTITULO_EMPRESA_HOJA = 'Centro de Mecanizado Industrial';

export interface DatosHojaCotizacion {
  codigoCotizacion: string | null;
  codigoSolicitud: string | null;
  // Estado tal como lo entiende quien lee el documento (etiqueta ya presentable).
  estadoEtiqueta: string;
  estado: string;
  emitidaEn: string | null;
  vigenciaHasta: string | null;
  // Solo cuando el usuario puede ver al cliente (pantalla interna).
  cliente?: string | null;
  servicio: string;
  cantidad: number | null;
  descripcionSolicitud?: string | null;
  especificaciones?: string | null;
  observaciones?: string | null;
  subtotal: string | null;
  ivaPorcentaje: string | null;
  ivaValor: string | null;
  total: string | null;
  anticipoPorcentaje: string | null;
  anticipoValor: string | null;
  estadoAnticipo: string | null;
  metodoAnticipo: string | null;
  saldo: string | null;
}

export interface HojaCotizacion {
  empresa: string;
  subtitulo: string;
  titulo: string;
  referencias: Array<{ etiqueta: string; valor: string }>;
  filas: Array<{ concepto: string; detalle: string | null; cantidad: string; subtotal: string }>;
  totales: Array<{ etiqueta: string; valor: string; destacado?: boolean }>;
  condiciones: string[];
  observaciones: string | null;
  pie: string[];
  nombreArchivo: string;
}

function textoOpcional(valor: string | null | undefined): string | null {
  const t = (valor ?? '').trim();
  return t ? t : null;
}

// Nombre de archivo seguro para el PDF: «Cotizacion-COT-004873».
export function nombreArchivoHoja(codigo: string | null): string {
  const base = (codigo ?? 'sin-numero').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `Cotizacion-${base || 'sin-numero'}`;
}

export function construirHojaCotizacion(datos: DatosHojaCotizacion, ahora: Date = new Date()): HojaCotizacion {
  const hayAnticipo = datos.estadoAnticipo !== 'NO_APLICA' && Number(datos.anticipoValor ?? 0) > 0;

  const referencias: HojaCotizacion['referencias'] = [];
  if (datos.codigoCotizacion) referencias.push({ etiqueta: 'N.º de cotización', valor: datos.codigoCotizacion });
  if (datos.codigoSolicitud) referencias.push({ etiqueta: 'N.º de solicitud', valor: datos.codigoSolicitud });
  if (textoOpcional(datos.cliente)) referencias.push({ etiqueta: 'Cliente', valor: textoOpcional(datos.cliente) as string });
  referencias.push({ etiqueta: 'Estado', valor: datos.estadoEtiqueta });
  if (datos.emitidaEn) referencias.push({ etiqueta: 'Fecha de emisión', valor: formatearFechaHora(datos.emitidaEn) });

  const detalle = [textoOpcional(datos.descripcionSolicitud), textoOpcional(datos.especificaciones)].filter(Boolean).join(' — ');
  // Una sola línea (la cotización actual es un único concepto): el formato en columnas ya admite varias filas.
  const filas: HojaCotizacion['filas'] = [
    {
      concepto: datos.servicio,
      detalle: detalle || null,
      cantidad: datos.cantidad === null ? '—' : String(datos.cantidad),
      subtotal: formatearMoneda(datos.subtotal),
    },
  ];

  const totales: HojaCotizacion['totales'] = [
    { etiqueta: 'Subtotal (sin IVA)', valor: formatearMoneda(datos.subtotal) },
    { etiqueta: `IVA (${formatearPorcentaje(datos.ivaPorcentaje)})`, valor: formatearMoneda(datos.ivaValor) },
    { etiqueta: 'Total (con IVA)', valor: formatearMoneda(datos.total), destacado: true },
  ];
  if (hayAnticipo) {
    totales.push({ etiqueta: `Anticipo (${formatearPorcentaje(datos.anticipoPorcentaje)})`, valor: formatearMoneda(datos.anticipoValor) });
  }
  totales.push({ etiqueta: 'Saldo', valor: formatearMoneda(datos.saldo) });

  const condiciones: string[] = [];
  condiciones.push(hayAnticipo ? `Método del anticipo: ${etiquetaMetodoPago(datos.metodoAnticipo)}.` : 'No se requiere anticipo.');
  if (datos.estado === 'VENCIDA') {
    condiciones.push('Esta cotización caducó. Consulte con su asesor comercial.');
  } else if (datos.vigenciaHasta && datos.estado === 'ENVIADA') {
    condiciones.push(`Cotización vigente hasta el ${formatearFechaHora(datos.vigenciaHasta)}.`);
  } else if (datos.vigenciaHasta && datos.estado === 'BORRADOR') {
    condiciones.push(`Fecha de caducidad prevista: ${formatearFechaHora(datos.vigenciaHasta)}.`);
  }
  condiciones.push('Los datos de pago y la respuesta a la cotización se gestionan desde el enlace que le compartió su asesor comercial.');

  return {
    empresa: NOMBRE_EMPRESA_HOJA,
    subtitulo: SUBTITULO_EMPRESA_HOJA,
    titulo: 'Cotización',
    referencias,
    filas,
    totales,
    condiciones,
    observaciones: textoOpcional(datos.observaciones),
    pie: [`${NOMBRE_EMPRESA_HOJA} — ${SUBTITULO_EMPRESA_HOJA}`, `Documento generado el ${formatearFechaHora(ahora.toISOString())}`],
    nombreArchivo: nombreArchivoHoja(datos.codigoCotizacion),
  };
}
