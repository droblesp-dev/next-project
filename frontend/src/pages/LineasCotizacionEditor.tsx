import { useEffect, useRef, useState } from 'react';
import { fetchAutenticado } from '../lib/authClient';
import {
  lineaVacia,
  MAX_DESCRIPCION,
  MAX_LINEAS,
  resumirLineas,
  type LineaFormulario,
} from '../lib/lineasCotizacion';

interface Sugerencia {
  descripcion: string;
  ultimo_precio_unitario?: string | null;
}

interface Props {
  token: string;
  lineas: LineaFormulario[];
  onCambio: (lineas: LineaFormulario[]) => void;
  ivaPorcentaje: number;
  anticipoPorcentaje: number;
  // Aviso opcional (p. ej. línea derivada de un borrador histórico).
  nota?: string | null;
}

const formatoDinero = (n: number): string => n.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Editor de líneas de detalle: descripción (con sugerencias de conceptos ya usados en cotizaciones enviadas), cantidad, precio unitario
// y subtotal. El resumen es una vista previa; el backend recalcula y es quien guarda los importes.
export default function LineasCotizacionEditor({ token, lineas, onCambio, ivaPorcentaje, anticipoPorcentaje, nota }: Props) {
  const [activa, setActiva] = useState<string | null>(null);
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current);
  }, []);

  function actualizar(clave: string, cambio: Partial<LineaFormulario>) {
    onCambio(lineas.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));
  }

  function buscar(clave: string, texto: string) {
    actualizar(clave, { descripcion: texto });
    setActiva(clave);
    if (temporizador.current) clearTimeout(temporizador.current);
    if (texto.trim().length < 2) {
      setSugerencias([]);
      return;
    }
    temporizador.current = setTimeout(async () => {
      try {
        const r = await fetchAutenticado(`/api/cotizaciones/items/sugerencias?q=${encodeURIComponent(texto.trim())}`, token);
        const d = await r.json().catch(() => null);
        setSugerencias(r.ok && Array.isArray(d?.sugerencias) ? d.sugerencias : []);
      } catch {
        setSugerencias([]);
      }
    }, 250);
  }

  function elegir(linea: LineaFormulario, s: Sugerencia) {
    // El precio sugerido solo se aplica si la línea aún no tiene uno.
    actualizar(linea.clave, {
      descripcion: s.descripcion,
      precio: linea.precio.trim() === '' && s.ultimo_precio_unitario ? String(s.ultimo_precio_unitario) : linea.precio,
    });
    setSugerencias([]);
    setActiva(null);
  }

  const resumen = resumirLineas(lineas, ivaPorcentaje, anticipoPorcentaje);
  const entrada = 'w-full bg-background border-0 border-b border-outline text-on-surface px-1 py-2 text-sm focus:ring-0 focus:border-primary-container outline-none placeholder:text-on-surface-variant';

  return (
    <div className="md:col-span-3 space-y-2" data-testid="editor-lineas">
      <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">Detalle de la cotización</p>
      {nota ? <p className="text-xs border border-primary-container text-primary-container px-2 py-1">{nota}</p> : null}
      <div className="space-y-2">
        {lineas.map((l, i) => (
          <div key={l.clave} className="grid grid-cols-12 gap-2 items-start">
            <div className="col-span-12 md:col-span-5 relative">
              <input
                aria-label={`Descripción línea ${i + 1}`}
                className={entrada}
                value={l.descripcion}
                maxLength={MAX_DESCRIPCION}
                placeholder="Concepto"
                autoComplete="off"
                onChange={(e) => buscar(l.clave, e.target.value)}
                onBlur={() => setTimeout(() => setActiva((a) => (a === l.clave ? null : a)), 150)}
              />
              {activa === l.clave && sugerencias.length > 0 ? (
                <ul className="absolute z-10 mt-1 w-full border border-outline bg-surface-container text-on-surface shadow text-sm max-h-48 overflow-auto" role="listbox">
                  {sugerencias.map((s) => (
                    <li key={s.descripcion}>
                      <button type="button" className="w-full text-left px-2 py-1 hover:bg-surface-container-high" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(l, s)}>
                        {s.descripcion}
                        {s.ultimo_precio_unitario ? <span className="text-on-surface-variant"> · {s.ultimo_precio_unitario}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <input
              aria-label={`Cantidad línea ${i + 1}`}
              className={`${entrada} col-span-4 md:col-span-2`}
              inputMode="decimal"
              value={l.cantidad}
              onChange={(e) => actualizar(l.clave, { cantidad: e.target.value })}
            />
            <input
              aria-label={`Precio unitario línea ${i + 1}`}
              className={`${entrada} col-span-4 md:col-span-2`}
              inputMode="decimal"
              placeholder="0.00"
              value={l.precio}
              onChange={(e) => actualizar(l.clave, { precio: e.target.value })}
            />
            <div className="col-span-3 md:col-span-2 py-1.5 text-sm text-right tabular-nums" aria-label={`Subtotal línea ${i + 1}`}>
              {resumen.subtotalesLinea[i] ?? '—'}
            </div>
            <button
              type="button"
              aria-label={`Quitar línea ${i + 1}`}
              className="col-span-1 text-on-surface-variant hover:text-error disabled:opacity-30"
              disabled={lineas.length <= 1}
              onClick={() => onCambio(lineas.filter((x) => x.clave !== l.clave))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="text-sm text-primary-container hover:underline disabled:opacity-40"
        disabled={lineas.length >= MAX_LINEAS}
        onClick={() => onCambio([...lineas, lineaVacia()])}
      >
        + Agregar línea
      </button>
      <dl className="text-sm grid grid-cols-2 gap-x-4 max-w-xs ml-auto tabular-nums" aria-label="Resumen de importes">
        <dt>Subtotal</dt>
        <dd className="text-right">{formatoDinero(resumen.subtotal)}</dd>
        <dt>IVA ({ivaPorcentaje}%)</dt>
        <dd className="text-right">{formatoDinero(resumen.iva)}</dd>
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold">{formatoDinero(resumen.total)}</dd>
      </dl>
    </div>
  );
}
