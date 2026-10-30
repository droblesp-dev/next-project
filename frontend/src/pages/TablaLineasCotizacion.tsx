import { formatearMoneda } from '../lib/cotizacionPublica';
import { formatearCantidad, type LineaDetalle } from '../lib/lineasCotizacion';

// Detalle de la cotización en solo lectura: descripción, cantidad, precio unitario y subtotal, tal como los guardó el backend.
// Sin líneas (cotización histórica) no muestra nada: el resumen de importes de la pantalla sigue siendo la referencia.
export default function TablaLineasCotizacion({ items }: { items: LineaDetalle[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="overflow-x-auto" data-testid="tabla-lineas-cotizacion">
      <table className="w-full text-sm border-collapse">
        <caption className="sr-only">Detalle de la cotización</caption>
        <thead>
          <tr className="border-b border-outline text-left text-xs uppercase text-on-surface-variant">
            <th scope="col" className="py-2 pr-3">Concepto</th>
            <th scope="col" className="py-2 px-3 text-right">Cantidad</th>
            <th scope="col" className="py-2 px-3 text-right">Precio unitario</th>
            <th scope="col" className="py-2 pl-3 text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((l, i) => (
            <tr key={i} className="border-b border-outline/50 align-top">
              <td className="py-2 pr-3 break-words">{l.descripcion}</td>
              <td className="py-2 px-3 text-right tabular-nums">{formatearCantidad(l.cantidad)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{formatearMoneda(l.precio_unitario)}</td>
              <td className="py-2 pl-3 text-right tabular-nums">{formatearMoneda(l.subtotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
