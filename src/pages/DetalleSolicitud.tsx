import { useEffect, useState } from 'react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';
import type { Solicitud } from './BandejaSolicitudes';

interface DetalleSolicitudProps {
  token: string;
  id: string;
  onVolver: () => void;
  onSesionInvalida: () => void;
}

interface AnalisisIa {
  id: string;
  solicitud_id: string;
  fecha_hora: string;
  resultado: string | null;
  prioridad_sugerida: string | null;
  informacion_estructurada: Record<string, unknown> | null;
  modelo_ia: string | null;
  version_ia: string | null;
  estado: string;
  revisado: boolean;
  revisado_por: string | null;
  revisado_en: string | null;
}

// Transiciones permitidas — deben coincidir con TRANSICIONES en
// backend/src/services/solicitudes.service.ts. Es solo una guía de UX
// (oculta opciones obviamente inválidas): el backend sigue siendo la
// única autoridad real sobre qué transición se acepta.
const TRANSICIONES: Record<string, string[]> = {
  NUEVA: ['EN_REVISION', 'CANCELADA'],
  EN_REVISION: ['COTIZADA', 'CANCELADA'],
  COTIZADA: [],
  CANCELADA: [],
};

export default function DetalleSolicitud({ token, id, onVolver, onSesionInvalida }: DetalleSolicitudProps) {
  const [solicitud, setSolicitud] = useState<Solicitud | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [mensajeCambio, setMensajeCambio] = useState<string | null>(null);

  const [analisis, setAnalisis] = useState<AnalisisIa[] | null>(null);
  const [loadingAnalisis, setLoadingAnalisis] = useState(true);
  const [errorAnalisis, setErrorAnalisis] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [mensajeGenerar, setMensajeGenerar] = useState<string | null>(null);
  const [revisandoId, setRevisandoId] = useState<string | null>(null);
  const [mensajeRevisar, setMensajeRevisar] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchAutenticado(`/api/solicitudes/${id}`, token);

      if (response.status === 404) {
        setError('Solicitud no encontrada.');
        return;
      }
      if (response.status === 403) {
        setError('No autorizado para consultar esta solicitud.');
        return;
      }
      if (!response.ok) {
        setError('No se pudo cargar la solicitud.');
        return;
      }

      const data = (await response.json()) as { solicitud: Solicitud };
      setSolicitud(data.solicitud);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setError('No se pudo cargar la solicitud.');
    } finally {
      setLoading(false);
    }
  }

  async function cargarAnalisis() {
    setLoadingAnalisis(true);
    setErrorAnalisis(null);

    try {
      const response = await fetchAutenticado(`/api/analisis-ia?solicitud_id=${id}`, token);

      if (response.status === 403) {
        setErrorAnalisis('No autorizado para consultar análisis de IA.');
        return;
      }
      if (!response.ok) {
        setErrorAnalisis('No se pudo cargar el historial de análisis.');
        return;
      }

      const data = (await response.json()) as { analisis: AnalisisIa[] };
      setAnalisis(data.analisis);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorAnalisis('No se pudo cargar el historial de análisis.');
    } finally {
      setLoadingAnalisis(false);
    }
  }

  useEffect(() => {
    cargar();
    cargarAnalisis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  async function handleGenerarAnalisis() {
    setGenerando(true);
    setMensajeGenerar(null);

    try {
      const response = await fetchAutenticado('/api/analisis-ia', token, {
        method: 'POST',
        body: JSON.stringify({ solicitud_id: id }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeGenerar(data?.message || 'No se pudo generar el análisis.');
        return;
      }

      const nuevoEstado = data?.analisis?.estado;
      setMensajeGenerar(
        nuevoEstado === 'ERROR'
          ? 'El proveedor de IA no pudo completar el análisis. Se registró el intento como ERROR.'
          : 'Análisis generado correctamente.'
      );
      await cargarAnalisis();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeGenerar('No se pudo generar el análisis.');
    } finally {
      setGenerando(false);
    }
  }

  async function handleMarcarRevisado(analisisId: string) {
    setRevisandoId(analisisId);
    setMensajeRevisar(null);

    try {
      const response = await fetchAutenticado(`/api/analisis-ia/${analisisId}/revisado`, token, {
        method: 'PATCH',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeRevisar(data?.message || 'No se pudo marcar el análisis como revisado.');
        return;
      }

      await cargarAnalisis();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeRevisar('No se pudo marcar el análisis como revisado.');
    } finally {
      setRevisandoId(null);
    }
  }

  async function handleCambiarEstado(nuevoEstado: string) {
    setCambiando(true);
    setMensajeCambio(null);

    try {
      const response = await fetchAutenticado(`/api/solicitudes/${id}/estado`, token, {
        method: 'PATCH',
        body: JSON.stringify({ estado: nuevoEstado }),
      });

      if (response.status === 409) {
        setMensajeCambio('Conflicto: la transición ya no es válida para el estado actual. Se actualizó la información.');
        await cargar();
        return;
      }
      if (response.status === 404) {
        setMensajeCambio('La solicitud ya no existe.');
        return;
      }
      if (response.status === 400) {
        setMensajeCambio('Estado inválido.');
        return;
      }
      if (!response.ok) {
        setMensajeCambio('No se pudo cambiar el estado.');
        return;
      }

      const data = (await response.json()) as { solicitud: Solicitud };
      setSolicitud(data.solicitud);
      setMensajeCambio('Estado actualizado correctamente.');
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

  return (
    <div>
      <button
        type="button"
        onClick={onVolver}
        className="mb-6 inline-flex items-center font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
      >
        <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
        VOLVER A LA BANDEJA
      </button>

      {loading && (
        <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO...</p>
      )}

      {!loading && error && (
        <p className="font-code-sm text-xs text-error uppercase">{error}</p>
      )}

      {!loading && !error && solicitud && (
        <div className="bg-surface sharp-border p-6 space-y-4">
          <div className="flex justify-between items-start border-b border-outline pb-4">
            <h3 className="font-headline-md text-headline-md text-on-surface uppercase">{solicitud.servicio}</h3>
            <span className="font-code-sm text-code-sm text-primary-container uppercase">{solicitud.estado}</span>
          </div>

          <p className="font-body-md text-body-md text-on-surface-variant">{solicitud.descripcion}</p>

          <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
            <div>
              <dt className="text-on-surface-variant uppercase">Cantidad</dt>
              <dd className="text-on-surface">{solicitud.cantidad}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Fecha requerida</dt>
              <dd className="text-on-surface">{solicitud.fecha_requerida ?? 'No especificada'}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Creada</dt>
              <dd className="text-on-surface">{new Date(solicitud.creado_en).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Actualizada</dt>
              <dd className="text-on-surface">{new Date(solicitud.actualizado_en).toLocaleString()}</dd>
            </div>
          </dl>

          {solicitud.especificaciones && (
            <div>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-1">Especificaciones</p>
              <p className="font-body-md text-body-md text-on-surface">{solicitud.especificaciones}</p>
            </div>
          )}

          <div className="border-t border-outline pt-4">
            <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Cambiar estado</p>
            <div className="flex flex-wrap gap-3">
              {(TRANSICIONES[solicitud.estado] ?? []).map((destino) => (
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
              {(TRANSICIONES[solicitud.estado] ?? []).length === 0 && (
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">
                  Este estado no admite más transiciones.
                </p>
              )}
            </div>
            {mensajeCambio && (
              <p className="font-code-sm text-xs text-on-surface-variant uppercase mt-3">{mensajeCambio}</p>
            )}
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Análisis IA</p>

            {solicitud.estado === 'EN_REVISION' && (
              <button
                type="button"
                disabled={generando}
                onClick={handleGenerarAnalisis}
                className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer mb-3"
              >
                {generando ? 'GENERANDO...' : 'GENERAR ANÁLISIS'}
              </button>
            )}
            {mensajeGenerar && (
              <p className="font-code-sm text-xs text-on-surface-variant uppercase mb-3">{mensajeGenerar}</p>
            )}

            {loadingAnalisis && (
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO ANÁLISIS...</p>
            )}
            {!loadingAnalisis && errorAnalisis && (
              <p className="font-code-sm text-xs text-error uppercase">{errorAnalisis}</p>
            )}
            {!loadingAnalisis && !errorAnalisis && analisis && analisis.length === 0 && (
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">
                Sin análisis generados todavía.
              </p>
            )}
            {!loadingAnalisis && !errorAnalisis && analisis && analisis.length > 0 && (
              <div className="space-y-3">
                {analisis.map((a) => (
                  <div key={a.id} className="bg-background border border-outline p-4">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-code-sm text-code-sm text-primary-container uppercase">{a.estado}</span>
                      <span className="font-code-sm text-[10px] text-on-surface-variant uppercase">
                        {new Date(a.fecha_hora).toLocaleString()}
                      </span>
                    </div>
                    {a.resultado && (
                      <p className="font-body-md text-body-md text-on-surface mb-2">{a.resultado}</p>
                    )}
                    {a.prioridad_sugerida && (
                      <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                        Prioridad sugerida: {a.prioridad_sugerida}
                      </p>
                    )}
                    {a.informacion_estructurada && (
                      <pre className="font-code-sm text-[10px] text-on-surface-variant whitespace-pre-wrap break-all mb-2">
                        {JSON.stringify(a.informacion_estructurada, null, 2)}
                      </pre>
                    )}
                    <p className="font-code-sm text-[10px] text-on-surface-variant uppercase">
                      {a.revisado ? `Revisado el ${a.revisado_en ? new Date(a.revisado_en).toLocaleString() : ''}` : 'No revisado'}
                    </p>
                    {a.estado === 'COMPLETADO' && !a.revisado && (
                      <button
                        type="button"
                        disabled={revisandoId === a.id}
                        onClick={() => handleMarcarRevisado(a.id)}
                        className="mt-2 inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-label-caps text-label-caps text-[10px] disabled:opacity-50 cursor-pointer"
                      >
                        MARCAR REVISADO
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {mensajeRevisar && (
              <p className="font-code-sm text-xs text-on-surface-variant uppercase mt-3">{mensajeRevisar}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
