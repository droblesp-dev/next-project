// Impresión de la hoja de una cotización con el diálogo del navegador (que también permite «Guardar como PDF»). Mientras dura la
// impresión se marca <body> con `imprimiendo-cotizacion`; las reglas de index.css ocultan entonces la aplicación y muestran solo
// la hoja. El título del documento se cambia al nombre del archivo sugerido y se restaura al terminar.
const CLASE_IMPRIMIENDO = 'imprimiendo-cotizacion';

export function imprimirHojaCotizacion(nombreArchivo: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const tituloOriginal = document.title;
  let limpiado = false;
  const limpiar = () => {
    if (limpiado) return;
    limpiado = true;
    document.body.classList.remove(CLASE_IMPRIMIENDO);
    document.title = tituloOriginal;
    window.removeEventListener('afterprint', limpiar);
  };
  document.body.classList.add(CLASE_IMPRIMIENDO);
  document.title = nombreArchivo;
  window.addEventListener('afterprint', limpiar);
  // Respaldo por si el navegador no emite `afterprint` (por ejemplo, la impresión se cancela de forma anómala).
  window.setTimeout(limpiar, 120_000);
  window.print();
}
