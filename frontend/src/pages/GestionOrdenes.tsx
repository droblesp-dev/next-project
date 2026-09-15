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
  avance: number;
  entrega_confirmada_en: string | null;
}

interface OrdenEvidencia {
  id: string;
  orden_id: string;
  tipo: string;
  nombre_archivo: string;
  creado_en: string;
}

// Solo los campos de saldo, necesarios para la sección "Cierre" de este
// componente — no se reutiliza la interfaz completa de GestionCotizaciones.
interface CotizacionSaldo {
  estado_saldo: string;
  saldo_pendiente: string | null;
}

interface GestionOrdenesProps {
  token: string;
  esAdmin: boolean;
  // F-08: true para ADMIN/OPERATIVO (pueden cambiar estado), false para
  // COMERCIAL (solo lectura). Independiente de `esAdmin`, que sigue
  // controlando exclusivamente "Asignar responsable".
  puedeGestionar: boolean;
  // Bloque MVP (ficha técnica), decisiones 1-3: ADMIN y COMERCIAL pueden
  // crear la orden; OPERATIVO no.
  puedeCrearOrden: boolean;
  // Bloque saldo/entrega/cierre: exclusivo ADMIN/COMERCIAL — controla la
  // sección "Cierre" (validar saldo se hace desde GestionCotizaciones,
  // confirmar entrega y cerrar se hacen desde aquí). OPERATIVO nunca ve
  // esta sección ni la información de saldo.
  puedeGestionarPago: boolean;
  onSesionInvalida: () => void;
}

interface FichaTecnica {
  id: string;
  orden_id: string;
  contenido: string;
  tiene_inconsistencia: boolean;
  generado_en: string;
  revisado_por: string | null;
  revisado_en: string | null;
}

// Guía de UX únicamente, debe coincidir con TRANSICIONES en
// backend/src/services/ordenes.service.ts. El backend sigue siendo la
// única autoridad real sobre qué transición se acepta.
// H-A (auditoría post-V9): CERRADA se retira de aquí — el backend ya no la
// admite por PATCH /:id/estado (bloque saldo/entrega/cierre). La única vía
// a CERRADA es el botón dedicado de la sección "Cierre" (ADMIN/COMERCIAL).
const TRANSICIONES: Record<string, string[]> = {
  PENDIENTE: ['EN_PROCESO', 'CANCELADA'],
  EN_PROCESO: ['PAUSADA', 'FINALIZADA', 'CANCELADA'],
  PAUSADA: ['EN_PROCESO', 'CANCELADA'],
  FINALIZADA: [],
  CERRADA: [],
  CANCELADA: [],
};

export default function GestionOrdenes({
  token,
  esAdmin,
  puedeGestionar,
  puedeCrearOrden,
  puedeGestionarPago,
  onSesionInvalida,
}: GestionOrdenesProps) {
  const [ordenes, setOrdenes] = useState<Orden[] | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [cotizacionIdNueva, setCotizacionIdNueva] = useState('');
  const [descripcionNueva, setDescripcionNueva] = useState('');
  const [fechaEntregaNueva, setFechaEntregaNueva] = useState('');
  const [creando, setCreando] = useState(false);
  const [mensajeCrear, setMensajeCrear] = useState<string | null>(null);

  const [ordenSeleccionada, setOrdenSeleccionada] = useState<Orden | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [mensajeCambio, setMensajeCambio] = useState<string | null>(null);

  const [responsables, setResponsables] = useState<Usuario[] | null>(null);
  const [responsableElegido, setResponsableElegido] = useState('');
  const [asignando, setAsignando] = useState(false);
  const [mensajeResponsable, setMensajeResponsable] = useState<string | null>(null);

  const [ficha, setFicha] = useState<FichaTecnica | null>(null);
  const [loadingFicha, setLoadingFicha] = useState(false);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);
  const [generandoFicha, setGenerandoFicha] = useState(false);
  const [mensajeGenerarFicha, setMensajeGenerarFicha] = useState<string | null>(null);

  const [observacionFinal, setObservacionFinal] = useState('');

  const [avanceInput, setAvanceInput] = useState(0);
  const [actualizandoAvance, setActualizandoAvance] = useState(false);
  const [mensajeAvance, setMensajeAvance] = useState<string | null>(null);

  const [evidencias, setEvidencias] = useState<OrdenEvidencia[] | null>(null);
  const [errorEvidencias, setErrorEvidencias] = useState<string | null>(null);
  const [archivoEvidencia, setArchivoEvidencia] = useState<File | null>(null);
  const [subiendoEvidencia, setSubiendoEvidencia] = useState(false);
  const [mensajeEvidencia, setMensajeEvidencia] = useState<string | null>(null);

  const [cotizacionSaldo, setCotizacionSaldo] = useState<CotizacionSaldo | null>(null);
  const [confirmandoEntrega, setConfirmandoEntrega] = useState(false);
  const [mensajeEntrega, setMensajeEntrega] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [mensajeCerrar, setMensajeCerrar] = useState<string | null>(null);

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
          fecha_entrega: fechaEntregaNueva || undefined,
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
      setFechaEntregaNueva('');
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
    setMensajeAvance(null);
    setMensajeEvidencia(null);
    setMensajeEntrega(null);
    setMensajeCerrar(null);
    setObservacionFinal('');
    setCotizacionSaldo(null);
    try {
      const response = await fetchAutenticado(`/api/ordenes/${id}`, token);
      if (!response.ok) return;
      const data = (await response.json()) as { orden: Orden };
      setOrdenSeleccionada(data.orden);
      setResponsableElegido(data.orden.responsable_id ?? '');
      setAvanceInput(data.orden.avance);
      await cargarFicha(id);
      await cargarEvidencias(id);
      if (puedeGestionarPago) {
        await cargarCotizacionSaldo(data.orden.cotizacion_id);
      }
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  // Bloque saldo/entrega/cierre: solo se consulta si el usuario puede
  // gestionar pago (ADMIN/COMERCIAL) — OPERATIVO no tiene acceso al router
  // de cotizaciones en absoluto (403), así que ni siquiera se intenta.
  async function cargarCotizacionSaldo(cotizacionId: string) {
    try {
      const response = await fetchAutenticado(`/api/cotizaciones/${cotizacionId}`, token);
      if (!response.ok) return;
      const data = (await response.json()) as { cotizacion: CotizacionSaldo };
      setCotizacionSaldo(data.cotizacion);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  async function cargarEvidencias(ordenId: string) {
    setErrorEvidencias(null);
    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenId}/evidencias`, token);
      if (!response.ok) {
        setErrorEvidencias('No se pudo cargar la lista de evidencias.');
        return;
      }
      const data = (await response.json()) as { evidencias: OrdenEvidencia[] };
      setEvidencias(data.evidencias);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorEvidencias('No se pudo cargar la lista de evidencias.');
    }
  }

  // H-B (auditoría post-V9): descarga autenticada como blob y la abre en
  // una pestaña nueva — no se puede usar un <a href> plano porque el
  // endpoint exige el header Authorization.
  async function handleVerEvidencia(evidenciaId: string) {
    if (!ordenSeleccionada) return;
    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/evidencias/${evidenciaId}`, token);
      if (!response.ok) {
        setMensajeEvidencia('No se pudo abrir la evidencia.');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeEvidencia('No se pudo abrir la evidencia.');
    }
  }

  // Bloque MVP (ficha técnica). Un 404 es un caso normal (todavía no se
  // generó, ej. porque la generación automática falló) — no es un error a
  // mostrar, es la señal de que corresponde ofrecer "GENERAR FICHA
  // TÉCNICA".
  async function cargarFicha(ordenId: string) {
    setLoadingFicha(true);
    setErrorFicha(null);
    setMensajeGenerarFicha(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenId}/ficha-tecnica`, token);

      if (response.status === 404) {
        setFicha(null);
        return;
      }
      if (!response.ok) {
        setErrorFicha('No se pudo cargar la ficha técnica.');
        return;
      }

      const data = (await response.json()) as { ficha: FichaTecnica };
      setFicha(data.ficha);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorFicha('No se pudo cargar la ficha técnica.');
    } finally {
      setLoadingFicha(false);
    }
  }

  async function handleGenerarFicha() {
    if (!ordenSeleccionada) return;
    setGenerandoFicha(true);
    setMensajeGenerarFicha(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/ficha-tecnica`, token, {
        method: 'POST',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeGenerarFicha(data?.message || 'No se pudo generar la ficha técnica.');
        return;
      }

      setFicha(data.ficha as FichaTecnica);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeGenerarFicha('No se pudo generar la ficha técnica.');
    } finally {
      setGenerandoFicha(false);
    }
  }

  async function handleCambiarEstado(nuevoEstado: string) {
    if (!ordenSeleccionada) return;
    setCambiando(true);
    setMensajeCambio(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/estado`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          estado: nuevoEstado,
          ...(nuevoEstado === 'FINALIZADA' && observacionFinal.trim()
            ? { observaciones: observacionFinal.trim() }
            : {}),
        }),
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

  // Endpoint separado del cambio de estado (decisión del bloque).
  async function handleActualizarAvance() {
    if (!ordenSeleccionada) return;
    setActualizandoAvance(true);
    setMensajeAvance(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/avance`, token, {
        method: 'PATCH',
        body: JSON.stringify({ avance: avanceInput }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeAvance(data?.message || 'No se pudo actualizar el avance.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
      setMensajeAvance('Avance actualizado correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeAvance('No se pudo actualizar el avance.');
    } finally {
      setActualizandoAvance(false);
    }
  }

  async function handleSubirEvidencia(e: FormEvent) {
    e.preventDefault();
    if (!ordenSeleccionada || !archivoEvidencia) return;
    setSubiendoEvidencia(true);
    setMensajeEvidencia(null);

    try {
      const formData = new FormData();
      formData.append('archivo', archivoEvidencia);

      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/evidencias`, token, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeEvidencia(data?.message || 'No se pudo subir la evidencia.');
        return;
      }

      setMensajeEvidencia('Evidencia subida correctamente.');
      setArchivoEvidencia(null);
      await cargarEvidencias(ordenSeleccionada.id);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeEvidencia('No se pudo subir la evidencia.');
    } finally {
      setSubiendoEvidencia(false);
    }
  }

  async function handleConfirmarEntrega() {
    if (!ordenSeleccionada) return;
    setConfirmandoEntrega(true);
    setMensajeEntrega(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/entrega`, token, {
        method: 'PATCH',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeEntrega(data?.message || 'No se pudo confirmar la entrega.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
      setMensajeEntrega('Entrega confirmada correctamente.');
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeEntrega('No se pudo confirmar la entrega.');
    } finally {
      setConfirmandoEntrega(false);
    }
  }

  // Única vía a CERRADA (el endpoint genérico de estado ya no la admite).
  async function handleCerrarOrden() {
    if (!ordenSeleccionada) return;
    setCerrando(true);
    setMensajeCerrar(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/cerrar`, token, {
        method: 'PATCH',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeCerrar(data?.message || 'No se pudo cerrar la orden.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
      setMensajeCerrar('Orden cerrada correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeCerrar('No se pudo cerrar la orden.');
    } finally {
      setCerrando(false);
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
              <dt className="text-on-surface-variant uppercase">Fecha de entrega</dt>
              <dd className="text-on-surface">{ordenSeleccionada.fecha_entrega ?? 'Sin definir'}</dd>
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
            <div>
              <dt className="text-on-surface-variant uppercase">Avance</dt>
              <dd className="text-on-surface">{ordenSeleccionada.avance}%</dd>
            </div>
          </dl>

          {ordenSeleccionada.descripcion && (
            <div>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-1">Descripción</p>
              <p className="font-body-md text-body-md text-on-surface">{ordenSeleccionada.descripcion}</p>
            </div>
          )}

          {puedeGestionar && (
            <div className="border-t border-outline pt-4">
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Avance</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                    Avance (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={avanceInput}
                    onChange={(e) => setAvanceInput(Number(e.target.value))}
                    className="w-24 bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={actualizandoAvance}
                  onClick={handleActualizarAvance}
                  className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {actualizandoAvance ? 'ACTUALIZANDO...' : 'ACTUALIZAR AVANCE'}
                </button>
              </div>
              {mensajeAvance && (
                <p className="font-code-sm text-xs text-on-surface-variant uppercase mt-3">{mensajeAvance}</p>
              )}
            </div>
          )}

          {puedeGestionar && (
            <div className="border-t border-outline pt-4">
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Evidencias</p>

              {errorEvidencias && <p className="font-code-sm text-xs text-error uppercase mb-2">{errorEvidencias}</p>}

              {evidencias && evidencias.length > 0 && (
                <ul className="mb-3 space-y-1">
                  {evidencias.map((ev) => (
                    <li key={ev.id} className="flex items-center justify-between gap-3 font-code-sm text-xs text-on-surface-variant uppercase">
                      <span>
                        {ev.tipo} — {ev.nombre_archivo} ({new Date(ev.creado_en).toLocaleString()})
                      </span>
                      <button
                        type="button"
                        onClick={() => handleVerEvidencia(ev.id)}
                        className="shrink-0 inline-flex items-center px-2 py-1 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps text-[10px] cursor-pointer"
                      >
                        VER
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {evidencias && evidencias.length === 0 && (
                <p className="font-code-sm text-xs text-on-surface-variant uppercase mb-3">
                  Sin evidencias registradas todavía.
                </p>
              )}

              <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubirEvidencia}>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={(e) => setArchivoEvidencia(e.target.files?.[0] ?? null)}
                  className="font-code-sm text-code-sm text-on-surface-variant"
                />
                <button
                  disabled={subiendoEvidencia || !archivoEvidencia}
                  type="submit"
                  className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {subiendoEvidencia ? 'SUBIENDO...' : 'SUBIR EVIDENCIA'}
                </button>
              </form>
              <p className="font-code-sm text-[10px] text-on-surface-variant uppercase mt-2">
                Máximo 5 fotos y 2 PDF por orden. No se requieren ambos formatos.
              </p>
              {mensajeEvidencia && (
                <p className="font-code-sm text-xs text-on-surface-variant uppercase mt-3">{mensajeEvidencia}</p>
              )}
            </div>
          )}

          {puedeGestionar && (
            <div className="border-t border-outline pt-4">
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Cambiar estado</p>
              {(TRANSICIONES[ordenSeleccionada.estado] ?? []).includes('FINALIZADA') && (
                <div className="mb-3">
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                    Observación final (requerida para finalizar)
                  </label>
                  <textarea
                    value={observacionFinal}
                    onChange={(e) => setObservacionFinal(e.target.value)}
                    className="w-full bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                    rows={2}
                  />
                </div>
              )}
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
          )}

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

          <div className="border-t border-outline pt-4">
            <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Ficha técnica</p>

            {loadingFicha && (
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO FICHA...</p>
            )}
            {!loadingFicha && errorFicha && (
              <p className="font-code-sm text-xs text-error uppercase">{errorFicha}</p>
            )}

            {!loadingFicha && !errorFicha && ficha && (
              <div className="space-y-3">
                {ficha.tiene_inconsistencia && (
                  <p className="font-code-sm text-xs text-error uppercase border border-error px-3 py-2">
                    NexIA detectó una inconsistencia — revise el contenido y la alerta generada.
                  </p>
                )}
                <pre className="font-code-sm text-xs text-on-surface whitespace-pre-wrap bg-background border border-outline p-4">
                  {ficha.contenido}
                </pre>
                <p className="font-code-sm text-[10px] text-on-surface-variant uppercase">
                  Generada el {new Date(ficha.generado_en).toLocaleString()}
                </p>
              </div>
            )}

            {!loadingFicha && !errorFicha && !ficha && (
              <div className="space-y-3">
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">
                  Sin ficha técnica generada todavía.
                </p>
                <button
                  type="button"
                  disabled={generandoFicha}
                  onClick={handleGenerarFicha}
                  className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {generandoFicha ? 'GENERANDO...' : 'GENERAR FICHA TÉCNICA'}
                </button>
                {mensajeGenerarFicha && (
                  <p className="font-code-sm text-xs text-error uppercase">{mensajeGenerarFicha}</p>
                )}
              </div>
            )}
          </div>

          {puedeGestionarPago && (ordenSeleccionada.estado === 'FINALIZADA' || ordenSeleccionada.estado === 'CERRADA') && (
            <div className="border-t border-outline pt-4 space-y-3">
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Cierre</p>

              <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
                <div>
                  <dt className="text-on-surface-variant uppercase">Estado del saldo</dt>
                  <dd className="text-on-surface">{cotizacionSaldo?.estado_saldo ?? 'Cargando...'}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Saldo pendiente</dt>
                  <dd className="text-on-surface">{cotizacionSaldo?.saldo_pendiente ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Entrega confirmada</dt>
                  <dd className="text-on-surface">
                    {ordenSeleccionada.entrega_confirmada_en
                      ? new Date(ordenSeleccionada.entrega_confirmada_en).toLocaleString()
                      : 'No confirmada'}
                  </dd>
                </div>
              </dl>

              {ordenSeleccionada.estado === 'FINALIZADA' && (
                <div className="flex flex-wrap gap-3">
                  {!ordenSeleccionada.entrega_confirmada_en && (
                    <button
                      type="button"
                      disabled={confirmandoEntrega}
                      onClick={handleConfirmarEntrega}
                      className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                    >
                      {confirmandoEntrega ? 'CONFIRMANDO...' : 'CONFIRMAR ENTREGA'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={cerrando}
                    onClick={handleCerrarOrden}
                    className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {cerrando ? 'CERRANDO...' : 'CERRAR ORDEN'}
                  </button>
                </div>
              )}

              {mensajeEntrega && <p className="font-code-sm text-xs text-on-surface-variant uppercase">{mensajeEntrega}</p>}
              {mensajeCerrar && <p className="font-code-sm text-xs text-on-surface-variant uppercase">{mensajeCerrar}</p>}
              <p className="font-code-sm text-[10px] text-on-surface-variant uppercase">
                El saldo se valida/rechaza desde el módulo de Cotizaciones.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {puedeCrearOrden && (
        <div className="bg-surface sharp-border p-6">
          <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-4">
            NUEVA ORDEN
          </h3>
          <p className="font-code-sm text-xs text-on-surface-variant uppercase mb-4">
            Solo se puede crear desde una cotización existente en estado ACEPTADA.
          </p>
          <form className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end" onSubmit={handleCrear}>
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
              <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                Fecha de entrega (opcional)
              </label>
              <input
                value={fechaEntregaNueva}
                onChange={(e) => setFechaEntregaNueva(e.target.value)}
                className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                type="date"
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
              <p className="md:col-span-4 font-code-sm text-xs text-on-surface-variant uppercase">{mensajeCrear}</p>
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
