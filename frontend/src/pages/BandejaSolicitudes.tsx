import { useEffect, useState } from 'react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';

export interface Solicitud {
  id: string;
  cliente_id: string;
  servicio: string;
  descripcion: string;
  cantidad: number;
  fecha_requerida: string | null;
  estado: string;
  especificaciones: string | null;
  requiere_comprobante: boolean;
  creado_en: string;
  actualizado_en: string;
}

interface BandejaSolicitudesProps {
  token: string;
  // Mejora UX (Análisis IA / Comunicación técnica): controla únicamente si
  // se muestra el indicador de "canal de comunicación disponible" por fila
  // — mismo permiso ya usado en DetalleSolicitud.tsx para el chat
  // (COMERCIAL/OPERATIVO). No se agrega ninguna llamada nueva al backend:
  // el indicador señala que la funcionalidad existe, no si esta solicitud
  // en particular ya tiene mensajes (ese dato no lo expone el listado).
  puedeChatear: boolean;
  onSeleccionar: (id: string) => void;
  onSesionInvalida: () => void;
}

export default function BandejaSolicitudes({ token, puedeChatear, onSeleccionar, onSesionInvalida }: BandejaSolicitudesProps) {
  const [solicitudes, setSolicitudes] = useState<Solicitud[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetchAutenticado('/api/solicitudes', token);

        if (response.status === 403) {
          if (!cancelado) setError('No autorizado para consultar solicitudes.');
          return;
        }

        if (!response.ok) {
          if (!cancelado) setError('No se pudo cargar la bandeja de solicitudes.');
          return;
        }

        const data = (await response.json()) as { solicitudes: Solicitud[] };
        if (!cancelado) setSolicitudes(data.solicitudes);
      } catch (err) {
        if (err instanceof SesionInvalidaError) {
          onSesionInvalida();
          return;
        }
        if (!cancelado) setError('No se pudo cargar la bandeja de solicitudes.');
      } finally {
        if (!cancelado) setLoading(false);
      }
    }

    cargar();
    return () => {
      cancelado = true;
    };
  }, [token, onSesionInvalida]);

  if (loading) {
    return <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO SOLICITUDES...</p>;
  }

  if (error) {
    return <p className="font-code-sm text-xs text-error uppercase">{error}</p>;
  }

  if (!solicitudes || solicitudes.length === 0) {
    return <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">NO HAY SOLICITUDES REGISTRADAS.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-outline">
            <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Servicio</th>
            <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Cantidad</th>
            <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Estado</th>
            <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Creada</th>
            <th className="py-3 font-code-sm text-code-sm text-on-surface-variant uppercase"></th>
          </tr>
        </thead>
        <tbody>
          {solicitudes.map((s) => (
            <tr key={s.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
              <td className="py-3 pr-4 font-body-md text-body-md text-on-surface">{s.servicio}</td>
              <td className="py-3 pr-4 font-body-md text-body-md text-on-surface">{s.cantidad}</td>
              <td className="py-3 pr-4 font-code-sm text-code-sm text-primary-container uppercase">{s.estado}</td>
              <td className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant">
                {new Date(s.creado_en).toLocaleDateString()}
              </td>
              <td className="py-3">
                <div className="flex items-center justify-end gap-2">
                  {puedeChatear && (
                    <span
                      title="Canal de comunicación técnica disponible para esta solicitud"
                      aria-label="Comunicación técnica disponible"
                      className="inline-flex items-center justify-center w-7 h-7 border border-primary-container text-primary-container"
                    >
                      <span className="material-symbols-outlined text-[16px]">forum</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onSeleccionar(s.id)}
                    className="inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-label-caps text-label-caps text-[10px] cursor-pointer"
                  >
                    VER DETALLE
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
