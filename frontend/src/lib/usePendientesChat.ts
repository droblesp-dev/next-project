import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAutenticado, SesionInvalidaError } from './authClient';
import { INTERVALO_PENDIENTES_MS, pendientesPorSolicitud, type PendientesPorSolicitud, type PendientesRespuesta } from './mensajesPendientes';

// #7: consulta periódica (sin WebSockets) de los mensajes pendientes del usuario. Se actualiza cada
// INTERVALO_PENDIENTES_MS mientras la pestaña está visible, al volver a ella o recuperar el foco, y cuando el
// componente llama a `recargar` (por ejemplo tras leer una conversación). Un fallo de red mantiene el último valor.
export function usePendientesChat(token: string, activo: boolean, onSesionInvalida: () => void) {
  const [porSolicitud, setPorSolicitud] = useState<PendientesPorSolicitud>({});
  const montado = useRef(true);
  const onSesionInvalidaRef = useRef(onSesionInvalida);
  onSesionInvalidaRef.current = onSesionInvalida;

  const recargar = useCallback(async () => {
    if (!activo) return;
    try {
      const response = await fetchAutenticado('/api/solicitudes/mensajes/pendientes', token);
      if (!response.ok) return;
      const data = (await response.json()) as PendientesRespuesta;
      if (montado.current) setPorSolicitud(pendientesPorSolicitud(data));
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalidaRef.current();
      }
      // otro fallo: se conserva el valor anterior y se reintenta en el siguiente ciclo
    }
  }, [token, activo]);

  useEffect(() => {
    montado.current = true;
    if (!activo) {
      setPorSolicitud({});
      return () => {
        montado.current = false;
      };
    }
    void recargar();
    const temporizador = window.setInterval(() => {
      if (document.visibilityState === 'visible') void recargar();
    }, INTERVALO_PENDIENTES_MS);
    const alVolver = () => {
      if (document.visibilityState === 'visible') void recargar();
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    return () => {
      montado.current = false;
      window.clearInterval(temporizador);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
    };
  }, [activo, recargar]);

  return { porSolicitud, recargar };
}
