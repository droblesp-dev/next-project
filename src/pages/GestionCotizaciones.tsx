import { useEffect, useState, type FormEvent } from 'react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';

export interface Cotizacion {
  id: string;
  solicitud_id: string;
  valor: string;
  estado: string;
  descripcion: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
}

interface GestionCotizacionesProps {
  token: string;
  onSesionInvalida: () => void;
}

// Guía de UX únicamente (igual que en DetalleSolicitud.tsx): debe coincidir
// con TRANSICIONES en backend/src/services/cotizaciones.service.ts. El
// backend sigue siendo la única autoridad real sobre qué transición se
// acepta.
const TRANSICIONES: Record<string, string[]> = {
  BORRADOR: ['ENVIADA', 'CANCELADA'],
  ENVIADA: ['ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CANCELADA'],
  ACEPTADA: [],
  RECHAZADA: [],
  VENCIDA: [],
  CANCELADA: [],
};

export default function GestionCotizaciones({ token, onSesionInvalida }: GestionCotizacionesProps) {
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[] | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [solicitudIdNueva, setSolicitudIdNueva] = useState('');
  const [valorNuevo, setValorNuevo] = useState('');
  const [descripcionNueva, setDescripcionNueva] = useState('');
  const [creando, setCreando] = useState(false);
  const [mensajeCrear, setMensajeCrear] = useState<string | null>(null);

  const [cotizacionSeleccionada, setCotizacionSeleccionada] = useState<Cotizacion | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [mensajeCambio, setMensajeCambio] = useState<string | null>(null);

  async function cargar() {
    setLoadingLista(true);
    setErrorLista(null);

    try {
      const response = await fetchAutenticado('/api/cotizaciones', token);

      if (response.status === 403) {
        setErrorLista('No autorizado para consultar cotizaciones.');
        return;
      }
      if (!response.ok) {
        setErrorLista('No se pudo cargar el listado de cotizaciones.');
        return;
      }

      const data = (await response.json()) as { cotizaciones: Cotizacion[] };
      setCotizaciones(data.cotizaciones);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorLista('No se pudo cargar el listado de cotizaciones.');
    } finally {
      setLoadingLista(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleCrear(e: FormEvent) {
    e.preventDefault();
    setMensajeCrear(null);
    setCreando(true);

    try {
      const response = await fetchAutenticado('/api/cotizaciones', token, {
        method: 'POST',
        body: JSON.stringify({
          solicitud_id: solicitudIdNueva.trim(),
          valor: Number(valorNuevo),
          descripcion: descripcionNueva.trim() || undefined,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeCrear(data?.message || 'No se pudo crear la cotización.');
        return;
      }

      setMensajeCrear('Cotización creada correctamente.');
      setSolicitudIdNueva('');
      setValorNuevo('');
      setDescripcionNueva('');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeCrear('No se pudo crear la cotización.');
    } finally {
      setCreando(false);
    }
  }

  async function abrirDetalle(id: string) {
    setMensajeCambio(null);
    try {
      const response = await fetchAutenticado(`/api/cotizaciones/${id}`, token);
      if (!response.ok) return;
      const data = (await response.json()) as { cotizacion: Cotizacion };
      setCotizacionSeleccionada(data.cotizacion);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  async function handleCambiarEstado(nuevoEstado: string) {
    if (!cotizacionSeleccionada) return;
    setCambiando(true);
    setMensajeCambio(null);

    try {
      const response = await fetchAutenticado(`/api/cotizaciones/${cotizacionSeleccionada.id}/estado`, token, {
        method: 'PATCH',
        body: JSON.stringify({ estado: nuevoEstado }),
      });

      const data = await response.json().catch(() => null);

      if (response.status === 409) {
        setMensajeCambio(data?.message || 'Conflicto al cambiar el estado.');
        await abrirDetalle(cotizacionSeleccionada.id);
        await cargar();
        return;
      }
      if (!response.ok) {
        setMensajeCambio(data?.message || 'No se pudo cambiar el estado.');
        return;
      }

      setCotizacionSeleccionada(data.cotizacion as Cotizacion);
      setMensajeCambio('Estado actualizado correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeCambio('No se pudo cambiar el estado.');
    } finally {
      setCambiando(false);
    }
  }

  if (cotizacionSeleccionada) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setCotizacionSeleccionada(null);
            setMensajeCambio(null);
          }}
          className="mb-6 inline-flex items-center font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL LISTADO
        </button>

        <div className="bg-surface sharp-border p-6 space-y-4">
          <div className="flex justify-between items-start border-b border-outline pb-4">
            <h3 className="font-headline-md text-headline-md text-on-surface uppercase">
              COTIZACIÓN — {cotizacionSeleccionada.valor}
            </h3>
            <span className="font-code-sm text-code-sm text-primary-container uppercase">
              {cotizacionSeleccionada.estado}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
            <div>
              <dt className="text-on-surface-variant uppercase">Solicitud</dt>
              <dd className="text-on-surface break-all">{cotizacionSeleccionada.solicitud_id}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Valor</dt>
              <dd className="text-on-surface">{cotizacionSeleccionada.valor}</dd>
            </div>
          </dl>

          {cotizacionSeleccionada.descripcion && (
            <div>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-1">Descripción</p>
              <p className="font-body-md text-body-md text-on-surface">{cotizacionSeleccionada.descripcion}</p>
            </div>
          )}

          <div className="border-t border-outline pt-4">
            <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Cambiar estado</p>
            <div className="flex flex-wrap gap-3">
              {(TRANSICIONES[cotizacionSeleccionada.estado] ?? []).map((destino) => (
                <button
                  key={destino}
                  type="button"
                  disabled={cambiando}
                  onClick={() => handleCambiarEstado(destino)}
                  className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                >
                  {destino}
                </button>
              ))}
              {(TRANSICIONES[cotizacionSeleccionada.estado] ?? []).length === 0 && (
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">
                  Este estado no admite más transiciones.
                </p>
              )}
            </div>
            {mensajeCambio && (
              <p className="font-code-sm text-xs text-on-surface-variant uppercase mt-3">{mensajeCambio}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-surface sharp-border p-6">
        <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-4">
          NUEVA COTIZACIÓN
        </h3>
        <p className="font-code-sm text-xs text-on-surface-variant uppercase mb-4">
          Solo se puede crear para una solicitud existente en estado EN_REVISION.
        </p>
        <form className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end" onSubmit={handleCrear}>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
              ID de solicitud
            </label>
            <input
              value={solicitudIdNueva}
              onChange={(e) => setSolicitudIdNueva(e.target.value)}
              required
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
              type="text"
              placeholder="UUID de la solicitud"
            />
          </div>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Valor</label>
            <input
              value={valorNuevo}
              onChange={(e) => setValorNuevo(e.target.value)}
              required
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
              type="number"
              min="0"
              step="0.01"
            />
          </div>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
              Descripción (opcional)
            </label>
            <input
              value={descripcionNueva}
              onChange={(e) => setDescripcionNueva(e.target.value)}
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
              type="text"
            />
          </div>
          <div className="md:col-span-3">
            <button
              disabled={creando}
              type="submit"
              className="inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
            >
              {creando ? 'CREANDO...' : 'CREAR COTIZACIÓN'}
            </button>
            {mensajeCrear && (
              <span className="ml-4 font-code-sm text-xs text-on-surface-variant uppercase">{mensajeCrear}</span>
            )}
          </div>
        </form>
      </div>

      <div>
        {loadingLista && (
          <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO COTIZACIONES...</p>
        )}
        {!loadingLista && errorLista && (
          <p className="font-code-sm text-xs text-error uppercase">{errorLista}</p>
        )}
        {!loadingLista && !errorLista && cotizaciones && cotizaciones.length === 0 && (
          <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">
            NO HAY COTIZACIONES REGISTRADAS.
          </p>
        )}
        {!loadingLista && !errorLista && cotizaciones && cotizaciones.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline">
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Solicitud</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Valor</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Estado</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Creada</th>
                  <th className="py-3 font-code-sm text-code-sm text-on-surface-variant uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {cotizaciones.map((c) => (
                  <tr key={c.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                    <td className="py-3 pr-4 font-code-sm text-code-sm text-on-surface break-all">{c.solicitud_id}</td>
                    <td className="py-3 pr-4 font-body-md text-body-md text-on-surface">{c.valor}</td>
                    <td className="py-3 pr-4 font-code-sm text-code-sm text-primary-container uppercase">{c.estado}</td>
                    <td className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant">
                      {new Date(c.creado_en).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => abrirDetalle(c.id)}
                        className="inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-label-caps text-label-caps text-[10px] cursor-pointer"
                      >
                        VER DETALLE
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
