import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { construirHojaCotizacion, type DatosHojaCotizacion, type HojaCotizacion } from '../lib/hojaCotizacion';
import { imprimirHojaCotizacion } from '../lib/imprimirHoja';

// #4 (impresión / PDF): hoja formal de la cotización. Es solo marcado: en pantalla permanece oculta (clase
// `hoja-cotizacion-portal` en index.css) y solo se muestra al imprimir. Fondo blanco y texto oscuro para impresión.
export function HojaCotizacionImprimible({ hoja }: { hoja: HojaCotizacion }) {
  return (
    <article className="hoja-cotizacion bg-white text-black p-0 font-sans" aria-label={`Hoja de ${hoja.titulo.toLowerCase()}`}>
      <header className="flex items-start justify-between border-b-2 border-black pb-3 mb-5">
        <div>
          <p className="text-2xl font-extrabold tracking-wide">{hoja.empresa}</p>
          <p className="text-sm">{hoja.subtitulo}</p>
        </div>
        <p className="text-xl font-bold uppercase">{hoja.titulo}</p>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-5">
        {hoja.referencias.map((r) => (
          <div key={r.etiqueta}>
            <dt className="text-xs uppercase text-neutral-600">{r.etiqueta}</dt>
            <dd className="font-semibold break-words">{r.valor}</dd>
          </div>
        ))}
      </dl>

      <table className="w-full text-sm border-collapse mb-5">
        <thead>
          <tr className="border-b border-black text-left text-xs uppercase">
            <th className="py-2 pr-3">Concepto</th>
            <th className="py-2 px-3 w-20 text-right">Cantidad</th>
            <th className="py-2 px-3 w-28 text-right">Precio unitario</th>
            <th className="py-2 pl-3 w-32 text-right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {hoja.filas.map((f, i) => (
            <tr key={i} className="border-b border-neutral-400 align-top">
              <td className="py-2 pr-3">
                <span className="font-semibold">{f.concepto}</span>
                {f.detalle && <span className="block text-xs text-neutral-700 whitespace-pre-wrap break-words">{f.detalle}</span>}
              </td>
              <td className="py-2 px-3 text-right">{f.cantidad}</td>
              <td className="py-2 px-3 text-right">{f.precioUnitario}</td>
              <td className="py-2 pl-3 text-right">{f.subtotal}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end mb-5">
        <table className="text-sm border-collapse w-72">
          <tbody>
            {hoja.totales.map((t) => (
              <tr key={t.etiqueta} className={t.destacado ? 'border-y-2 border-black font-bold' : ''}>
                <td className="py-1 pr-4">{t.etiqueta}</td>
                <td className="py-1 text-right">{t.valor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hoja.observaciones && (
        <section className="mb-5 text-sm">
          <p className="text-xs uppercase text-neutral-600 mb-1">Observaciones</p>
          <p className="whitespace-pre-wrap break-words">{hoja.observaciones}</p>
        </section>
      )}

      <section className="mb-6 text-sm">
        <p className="text-xs uppercase text-neutral-600 mb-1">Condiciones</p>
        <ul className="list-disc pl-5 space-y-1">
          {hoja.condiciones.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-neutral-500 pt-2 text-xs text-neutral-700">
        {hoja.pie.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </footer>
    </article>
  );
}

// Botón «Imprimir / guardar PDF» más su hoja (en un portal fuera de #root, oculta salvo al imprimir). Reutilizable en la pantalla
// pública del cliente y en el detalle interno de la cotización.
export default function BotonImprimirCotizacion({ datos, className }: { datos: DatosHojaCotizacion; className?: string }) {
  const actual = construirHojaCotizacion(datos); // se recalcula con cada render para reflejar el estado y los importes vigentes
  return (
    <>
      <button
        type="button"
        onClick={() => imprimirHojaCotizacion(actual.nombreArchivo)}
        data-imprimir-cotizacion
        className={
          className ??
          'inline-flex items-center justify-center gap-2 px-4 min-h-11 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-[\'Inter\'] text-[14px] font-semibold cursor-pointer'
        }
      >
        <Printer size={18} aria-hidden="true" />
        IMPRIMIR / GUARDAR PDF
      </button>
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="hoja-cotizacion-portal" data-hoja-cotizacion>
            <HojaCotizacionImprimible hoja={actual} />
          </div>,
          document.body
        )}
    </>
  );
}
