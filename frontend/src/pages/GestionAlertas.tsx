import { useEffect, useState } from 'react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';

export interface Alerta {
  id: string;
  orden_id: string;
  tipo: string;
  condicion: string;
  mensaje: string;
  estado: string;
  creado_en: string;
  leida: boolean;
  leida_en: string | null;
}

interface GestionAlertasProps {
  token: string;
  onSesionInvalida: () => void;
}

export default function GestionAlertas({ token, onSesionInvalida }: GestionAlertasProps) {
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchAutenticado('/api/alertas', token);

      if (response.status === 403) {
        setError('No autorizado para consultar alertas.');
        return;
      }
      if (!response.ok) {
        setError('No se pudo cargar el listado de alertas.');
        return;
      }

      const data = (await response.json()) as { alertas: Alerta[] };
      setAlertas(data.alertas);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setError('No se pudo cargar el listado de alertas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleAtender(id: string) {
    setProcesando(id);
    try {
      const response = await fetchAutenticado(`/api/alertas/${id}/atender`, token, {
        method: 'PATCH',
      });
      if (!response.ok) return;
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    } finally {
      setProcesando(null);
    }
  }

  return (
    <div>
      {loading && <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO ALERTAS...</p>}
      {!loading && error && <p className="font-code-sm text-xs text-error uppercase">{error}</p>}
      {!loading && !error && alertas && alertas.length === 0 && (
        <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">NO HAY ALERTAS REGISTRADAS.</p>
      )}
      {!loading && !error && alertas && alertas.length > 0 && (
        <div className="space-y-3">
          {alertas.map((a) => (
            <div key={a.id} className="bg-surface sharp-border p-4 flex justify-between items-start gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-code-sm text-code-sm text-primary-container uppercase">
                    {a.tipo} · {a.condicion}
                  </span>
                  <span className="font-code-sm text-[10px] text-on-surface-variant uppercase">{a.estado}</span>
                </div>
                <p className="font-body-md text-body-md text-on-surface">{a.mensaje}</p>
                <p className="font-code-sm text-[10px] text-on-surface-variant uppercase mt-1">
                  {new Date(a.creado_en).toLocaleString()}
                </p>
              </div>
              {a.estado !== 'ATENDIDA' && (
                <button
                  type="button"
                  disabled={procesando === a.id}
                  onClick={() => handleAtender(a.id)}
                  className="shrink-0 px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps text-[10px] disabled:opacity-50 cursor-pointer"
                >
                  ATENDER
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
