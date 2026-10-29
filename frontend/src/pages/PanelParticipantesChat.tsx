import { useEffect, useState } from 'react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';

// #7: quién participa en la comunicación técnica de una solicitud SIN orden. Solo representa lo que decide el backend
// (la autorización real no depende de esta pantalla): quien participa ve la lista; un COMERCIAL participante puede
// incorporar o retirar; un COMERCIAL puede reclamar un hilo que no tiene COMERCIAL participante.
export interface VistaParticipantes {
  regimen: 'ORDEN' | 'PARTICIPANTES' | 'LIBRE';
  modo: 'OFF' | 'SOMBRA' | 'ESTRICTO';
  participa: boolean;
  reclamable: boolean;
  puede_gestionar: boolean;
  participantes: Array<{ usuario_id: string; nombre: string; rol: string }>;
  responsable: { id: string; nombre: string } | null;
}

interface PanelProps {
  token: string;
  solicitudId: string;
  vista: VistaParticipantes;
  usuarioId: string;
  onCambio: () => void;
  onSesionInvalida: () => void;
}

interface Operativo {
  id: string;
  nombre: string;
}

export default function PanelParticipantesChat({ token, solicitudId, vista, usuarioId, onCambio, onSesionInvalida }: PanelProps) {
  const [operativos, setOperativos] = useState<Operativo[]>([]);
  const [seleccionado, setSeleccionado] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (!vista.puede_gestionar) return;
    let activo = true;
    (async () => {
      try {
        const response = await fetchAutenticado('/api/usuarios/operativos-activos', token);
        if (!response.ok) return;
        const data = (await response.json()) as { operativos: Operativo[] };
        if (activo) setOperativos(data.operativos);
      } catch (err) {
        if (err instanceof SesionInvalidaError) onSesionInvalida();
      }
    })();
    return () => {
      activo = false;
    };
  }, [vista.puede_gestionar, token, onSesionInvalida]);

  async function ejecutar(ruta: string, opciones: RequestInit, exito: string) {
    setTrabajando(true);
    setMensaje(null);
    try {
      const response = await fetchAutenticado(`/api/solicitudes/${solicitudId}/participantes${ruta}`, token, opciones);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMensaje(data?.message || 'No se pudo completar la acción.');
        return;
      }
      setMensaje(exito);
      setSeleccionado('');
      onCambio();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensaje('No se pudo completar la acción.');
    } finally {
      setTrabajando(false);
    }
  }

  if (vista.regimen === 'LIBRE') return null;

  const clase = "font-['Inter'] text-[13px] font-normal text-on-surface-variant";
  const yaParticipan = new Set(vista.participantes.map((p) => p.usuario_id));
  const incorporables = operativos.filter((o) => !yaParticipan.has(o.id));

  return (
    <div data-panel-participantes className="border border-outline px-3 py-3 mb-4 space-y-2">
      <p className="font-label-caps text-[10px] text-primary-container uppercase">Participantes</p>

      {vista.regimen === 'ORDEN' && (
        <p className={clase}>
          La conversación se rige por la orden asociada
          {vista.responsable ? `: responsable ${vista.responsable.nombre}.` : '; la orden aún no tiene responsable.'}
        </p>
      )}

      {vista.regimen === 'PARTICIPANTES' && !vista.participa && (
        <>
          <p className={clase}>
            {vista.modo === 'ESTRICTO'
              ? 'No participas en esta conversación.'
              : 'Aún no figuras como participante de esta conversación.'}
          </p>
          {vista.reclamable && (
            <>
              <p className={clase}>Esta conversación no tiene un COMERCIAL participante. Puedes reclamarla.</p>
              <button
                type="button"
                disabled={trabajando}
                onClick={() => ejecutar('/reclamar', { method: 'POST' }, 'Conversación reclamada.')}
                className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer disabled:opacity-50"
              >
                RECLAMAR CONVERSACIÓN
              </button>
            </>
          )}
        </>
      )}

      {vista.regimen === 'PARTICIPANTES' && vista.participa && (
        <>
          <ul className="space-y-1">
            {vista.participantes.map((p) => (
              <li key={p.usuario_id} className="flex items-center justify-between gap-2">
                <span className={clase}>
                  {p.nombre} <span className="uppercase">({p.rol})</span>
                  {p.usuario_id === usuarioId ? ' — tú' : ''}
                </span>
                {vista.puede_gestionar && vista.participantes.length > 1 && (
                  <button
                    type="button"
                    disabled={trabajando}
                    onClick={() => ejecutar(`/${p.usuario_id}`, { method: 'DELETE' }, 'Participante retirado.')}
                    className="font-['Inter'] text-[13px] text-error underline cursor-pointer disabled:opacity-50"
                    aria-label={`Retirar a ${p.nombre}`}
                  >
                    Retirar
                  </button>
                )}
              </li>
            ))}
          </ul>
          {vista.puede_gestionar && (
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={seleccionado}
                onChange={(e) => setSeleccionado(e.target.value)}
                aria-label="OPERATIVO a incorporar"
                className="flex-1 min-w-0 bg-background border border-outline px-3 py-2 text-on-surface text-sm font-code-sm"
              >
                <option value="">Incorporar OPERATIVO…</option>
                {incorporables.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={trabajando || !seleccionado}
                onClick={() =>
                  ejecutar('', { method: 'POST', body: JSON.stringify({ usuario_id: seleccionado }) }, 'Participante incorporado.')
                }
                className="inline-flex items-center justify-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer disabled:opacity-50"
              >
                INCORPORAR
              </button>
            </div>
          )}
        </>
      )}

      {mensaje && <p className={`${clase} uppercase`}>{mensaje}</p>}
    </div>
  );
}
