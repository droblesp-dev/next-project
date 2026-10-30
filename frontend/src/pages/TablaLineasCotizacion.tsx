import { formatearMoneda } from '../lib/cotizacionPublica';
import { formatearCantidad, type LineaDetalle } from '../lib/lineasCotizacion';

// Detalle de la cotización en solo lectura: descripción, cantidad, precio unitario y subtotal, tal como los guardó el backend.
// Sin líneas (cotización histórica) no muestra nada: el resumen de importes de la pantalla sigue siendo la referencia.
export default function TablaLineasCotizacion({ items }: { items: LineaDetalle[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="overflow-x-auto" data-testid="tabla-lineas-cotizacion">
      <table className="w-full text-xs sm:text-sm border-collapse">
        <caption className="sr-only">Detalle de la cotización</caption>
        <thead>
          <tr className="border-b border-outline text-left text-[10px] sm:text-xs uppercase text-on-surface-variant">
            <th scope="col" className="py-2 pr-2 sm:pr-3">Concepto</th>
            <th scope="col" className="py-2 px-1.5 sm:px-3 text-right"><span className="sm:hidden">Cant.</span><span className="hidden sm:inline">Cantidad</span></th>
            <th scope="col" className="py-2 px-1.5 sm:px-3 text-right"><span className="sm:hidden">P. unit.</span><span className="hidden sm:inline">Precio unitario</span></th>
            <th scope="col" className="py-2 pl-1.5 sm:pl-3 text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l, i) => (
            <tr key={i} className="border-b border-outline/50 align-top">
              <td className="py-2 pr-2 sm:pr-3 break-words">{l.descripcion}</td>
              <td className="py-2 px-1.5 sm:px-3 text-right tabular-nums">{formatearCantidad(l.cantidad)}</td>
              <td className="py-2 px-1.5 sm:px-3 text-right tabular-nums">{formatearMoneda(l.precio_unitario)}</td>
              <td className="py-2 pl-1.5 sm:pl-3 text-right tabular-nums">{formatearMoneda(l.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
