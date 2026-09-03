import { useEffect, useState, type FormEvent } from 'react';
import { fetchAutenticado, SesionInvalidaError, type Usuario } from '../lib/authClient';

export interface Orden {
  id: string;
  cotizacion_id: string;
  responsable_id: string | null;
  estado: string;
  codigo: string;
  descripcion: string | null;
  fecha_inicio: string | null;
  fecha_entrega: string | null;
  fecha_programada: string | null;
  fecha_finalizacion: string | null;
  fecha_cierre: string | null;
  observaciones: string | null;
  creado_en: string;
  actualizado_en: string;
}

interface GestionOrdenesProps {
  token: string;
  esAdmin: boolean;
  onSesionInvalida: () => void;
}

// Guía de UX únicamente, debe coincidir con TRANSICIONES en
// backend/src/services/ordenes.service.ts. El backend sigue siendo la
// única autoridad real sobre qué transición se acepta.
const TRANSICIONES: Record<string, string[]> = {
  PENDIENTE: ['EN_PROCESO', 'CANCELADA'],
  EN_PROCESO: ['FINALIZADA', 'CANCELADA'],
  FINALIZADA: ['CERRADA'],
  CERRADA: [],
  CANCELADA: [],
};

export default function GestionOrdenes({ token, esAdmin, onSesionInvalida }: GestionOrdenesProps) {
  const [ordenes, setOrdenes] = useState<Orden[] | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [cotizacionIdNueva, setCotizacionIdNueva] = useState('');
  const [descripcionNueva, setDescripcionNueva] = useState('');
  const [creando, setCreando] = useState(false);
  const [mensajeCrear, setMensajeCrear] = useState<string | null>(null);

  const [ordenSeleccionada, setOrdenSeleccionada] = useState<Orden | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [mensajeCambio, setMensajeCambio] = useState<string | null>(null);

  const [responsables, setResponsables] = useState<Usuario[] | null>(null);
  const [responsableElegido, setResponsableElegido] = useState('');
  const [asignando, setAsignando] = useState(false);
  const [mensajeResponsable, setMensajeResponsable] = useState<string | null>(null);

  async function cargar() {
    setLoadingLista(true);
    setErrorLista(null);

    try {
      const response = await fetchAutenticado('/api/ordenes', token);

      if (response.status === 403) {
        setErrorLista('No autorizado para consultar órdenes.');
        return;
      }
      if (!response.ok) {
        setErrorLista('No se pudo cargar el listado de órdenes.');
        return;
      }

      const data = (await response.json()) as { ordenes: Orden[] };
      setOrdenes(data.ordenes);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorLista('No se pudo cargar el listado de órdenes.');
    } finally {
      setLoadingLista(false);
    }
  }

  // Lista de candidatos a responsable (solo ADMIN la necesita): reutiliza
  // GET /api/usuarios, ya existente desde Fase 3.2/6, filtrando en el
  // cliente a OPERATIVO activos únicamente para la UX del selector. La
  // validación real (rol OPERATIVO + activo) la hace igualmente el backend
  // al asignar.
  async function cargarResponsables() {
    try {
      const response = await fetchAutenticado('/api/usuarios', token);
      if (!response.ok) return;
      const data = (await response.json()) as { usuarios: Usuario[] };
      setResponsables(data.usuarios.filter((u) => u.rol === 'OPERATIVO' && u.activo));
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  useEffect(() => {
    cargar();
    if (esAdmin) {
      cargarResponsables();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, esAdmin]);

  async function handleCrear(e: FormEvent) {
    e.preventDefault();
    setMensajeCrear(null);
    setCreando(true);

    try {
      const response = await fetchAutenticado('/api/ordenes', token, {
        method: 'POST',
        body: JSON.stringify({
          cotizacion_id: cotizacionIdNueva.trim(),
          descripcion: descripcionNueva.trim() || undefined,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeCrear(data?.message || 'No se pudo crear la orden.');
        return;
      }

      setMensajeCrear(`Orden creada correctamente (${data.orden.codigo}).`);
      setCotizacionIdNueva('');
      setDescripcionNueva('');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeCrear('No se pudo crear la orden.');
    } finally {
      setCreando(false);
    }
  }

  async function abrirDetalle(id: string) {
    setMensajeCambio(null);
    setMensajeResponsable(null);
    try {
      const response = await fetchAutenticado(`/api/ordenes/${id}`, token);
      if (!response.ok) return;
      const data = (await response.json()) as { orden: Orden };
      setOrdenSeleccionada(data.orden);
      setResponsableElegido(data.orden.responsable_id ?? '');
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  async function handleCambiarEstado(nuevoEstado: string) {
    if (!ordenSeleccionada) return;
    setCambiando(true);
    setMensajeCambio(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/estado`, token, {
        method: 'PATCH',
        body: JSON.stringify({ estado: nuevoEstado }),
      });

      const data = await response.json().catch(() => null);

      if (response.status === 409) {
        setMensajeCambio(data?.message || 'Conflicto al cambiar el estado.');
        await abrirDetalle(ordenSeleccionada.id);
        await cargar();
        return;
      }
      if (!response.ok) {
        setMensajeCambio(data?.message || 'No se pudo cambiar el estado.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
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

  async function handleAsignarResponsable(e: FormEvent) {
    e.preventDefault();
    if (!ordenSeleccionada || !responsableElegido) return;
    setAsignando(true);
    setMensajeResponsable(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/responsable`, token, {
        method: 'PATCH',
        body: JSON.stringify({ responsable_id: responsableElegido }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeResponsable(data?.message || 'No se pudo asignar el responsable.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
      setMensajeResponsable('Responsable asignado correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeResponsable('No se pudo asignar el responsable.');
    } finally {
      setAsignando(false);
    }
  }

  if (ordenSeleccionada) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setOrdenSeleccionada(null);
            setMensajeCambio(null);
            setMensajeResponsable(null);
          }}
          className="mb-6 inline-flex items-center font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL LISTADO
        </button>

        <div className="bg-surface sharp-border p-6 space-y-4">
          <div className="flex justify-between items-start border-b border-outline pb-4">
            <h3 className="font-headline-md text-headline-md text-on-surface uppercase">
              {ordenSeleccionada.codigo}
            </h3>
            <span className="font-code-sm text-code-sm text-primary-container uppercase">
              {ordenSeleccionada.estado}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
            <div>
              <dt className="text-on-surface-variant uppercase">Cotización</dt>
              <dd className="text-on-surface break-all">{ordenSeleccionada.cotizacion_id}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Responsable</dt>
              <dd className="text-on-surface break-all">{ordenSeleccionada.responsable_id ?? 'Sin asignar'}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Finalizada</dt>
              <dd className="text-on-surface">
                {ordenSeleccionada.fecha_finalizacion
                  ? new Date(ordenSeleccionada.fecha_finalizacion).toLocaleString()
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Cerrada</dt>
              <dd className="text-on-surface">
                {ordenSeleccionada.fecha_cierre ? new Date(ordenSeleccionada.fecha_cierre).toLocaleString() : '—'}
              </dd>
            </div>
          </dl>

          {ordenSeleccionada.descripcion && (
            <div>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-1">Descripción</p>
              <p className="font-body-md text-body-md text-on-surface">{ordenSeleccionada.descripcion}</p>
            </div>
          )}

          <div className="border-t border-outline pt-4">
            <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Cambiar estado</p>
            <div className="flex flex-wrap gap-3">
              {(TRANSICIONES[ordenSeleccionada.estado] ?? []).map((destino) => (
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
              {(TRANSICIONES[ordenSeleccionada.estado] ?? []).length === 0 && (
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">
                  Este estado no admite más transiciones.
                </p>
              )}
            </div>
            {mensajeCambio && (
              <p className="font-code-sm text-xs text-on-surface-variant uppercase mt-3">{mensajeCambio}</p>
            )}
          </div>

          {esAdmin && (
            <div className="border-t border-outline pt-4">
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Asignar responsable</p>
              <form className="flex flex-wrap items-end gap-3" onSubmit={handleAsignarResponsable}>
                <select
                  value={responsableElegido}
                  onChange={(e) => setResponsableElegido(e.target.value)}
                  className="bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none cursor-pointer"
                >
                  <option value="">Seleccione un OPERATIVO activo</option>
                  {(responsables ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                    </option>
                  ))}
                </select>
                <button
                  disabled={asignando || !responsableElegido}
                  type="submit"
                  className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {asignando ? 'ASIGNANDO...' : 'ASIGNAR'}
                </button>
              </form>
              {responsables !== null && responsables.length === 0 && (
                <p className="font-code-sm text-xs text-on-surface-variant uppercase mt-2">
                  No hay usuarios OPERATIVO activos disponibles.
                </p>
              )}
              {mensajeResponsable && (
                <p className="font-code-sm text-xs text-on-surface-variant uppercase mt-3">{mensajeResponsable}</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {esAdmin && (
        <div className="bg-surface sharp-border p-6">
          <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-4">
            NUEVA ORDEN
          </h3>
          <p className="font-code-sm text-xs text-on-surface-variant uppercase mb-4">
            Solo se puede crear desde una cotización existente en estado ACEPTADA.
          </p>
          <form className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end" onSubmit={handleCrear}>
            <div>
              <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                ID de cotización
              </label>
              <input
                value={cotizacionIdNueva}
                onChange={(e) => setCotizacionIdNueva(e.target.value)}
                required
                className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                type="text"
                placeholder="UUID de la cotización"
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
            <div>
              <button
                disabled={creando}
                type="submit"
                className="inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
              >
                {creando ? 'CREANDO...' : 'CREAR ORDEN'}
              </button>
            </div>
            {mensajeCrear && (
              <p className="md:col-span-3 font-code-sm text-xs text-on-surface-variant uppercase">{mensajeCrear}</p>
            )}
          </form>
        </div>
      )}

      <div>
        {loadingLista && (
          <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO ÓRDENES...</p>
        )}
        {!loadingLista && errorLista && (
          <p className="font-code-sm text-xs text-error uppercase">{errorLista}</p>
        )}
        {!loadingLista && !errorLista && ordenes && ordenes.length === 0 && (
          <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">NO HAY ÓRDENES REGISTRADAS.</p>
        )}
        {!loadingLista && !errorLista && ordenes && ordenes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline">
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Código</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Estado</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Responsable</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Creada</th>
                  <th className="py-3 font-code-sm text-code-sm text-on-surface-variant uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {ordenes.map((o) => (
                  <tr key={o.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                    <td className="py-3 pr-4 font-body-md text-body-md text-on-surface">{o.codigo}</td>
                    <td className="py-3 pr-4 font-code-sm text-code-sm text-primary-container uppercase">{o.estado}</td>
                    <td className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant break-all">
                      {o.responsable_id ?? 'Sin asignar'}
                    </td>
                    <td className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant">
                      {new Date(o.creado_en).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => abrirDetalle(o.id)}
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
