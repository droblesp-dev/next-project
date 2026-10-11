import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';

// Bloque 2B / 2B.1: comunicación técnica de la SOLICITUD (única conversación; no existe
// chat de orden). Este componente solo representa en pantalla lo que decide el backend:
//   - GET 200 con `modo` = EDITABLE | SOLO_LECTURA (ayuda de UX calculada en backend a partir de
//     rol, estado de la solicitud y de la orden asociada) -> composer o aviso de solo lectura.
//   - GET 403  -> "sin acceso" (no se muestran mensajes, composer ni NexIA).
//   - POST 409 -> la conversación pasó a solo lectura mientras la pantalla estaba abierta.
//   - POST 429 -> aviso amigable del límite de consultas a NexIA.
// `modo` NO es seguridad: POST vuelve a verificar rol, acceso y estado en el backend.

export const MENSAJE_MAX_CARACTERES = 2000;

interface Mensaje {
  id: string;
  solicitud_id: string;
  autor_id: string | null;
  autor_tipo: string;
  contenido: string;
  creado_en: string;
}

type ModoBackend = 'EDITABLE' | 'SOLO_LECTURA';

interface ChatTecnicoProps {
  token: string;
  solicitudId: string;
  // Solo se usa como respaldo si una respuesta antigua no trajera `modo`.
  rolUsuario: string;
  solicitudEstado: string;
  // Desplaza la vista hasta el chat al abrirse (acceso desde el detalle de orden).
  enfocar?: boolean;
  onSesionInvalida: () => void;
}

// Diferenciación visual por emisor — mismo lenguaje ya usado (borde izquierdo
// de color). NEXIA conserva su tinte existente.
function claseBurbujaMensaje(autorTipo: string): string {
  if (autorTipo === 'NEXIA') return 'bg-primary-container/10 border-l-4 border-l-primary-container';
  if (autorTipo === 'OPERATIVO') return 'bg-background border-l-4 border-l-secondary-container';
  return 'bg-background border-l-4 border-l-outline';
}

export default function ChatTecnico({
  token,
  solicitudId,
  rolUsuario,
  solicitudEstado,
  enfocar,
  onSesionInvalida,
}: ChatTecnicoProps) {
  const [mensajes, setMensajes] = useState<Mensaje[] | null>(null);
  const [modoBackend, setModoBackend] = useState<ModoBackend | null>(null);
  const [loadingMensajes, setLoadingMensajes] = useState(true);
  const [errorMensajes, setErrorMensajes] = useState<string | null>(null);
  const [sinAcceso, setSinAcceso] = useState(false);
  const [contenidoNuevo, setContenidoNuevo] = useState('');
  const [enviandoMensaje, setEnviandoMensaje] = useState(false);
  const [errorEnvioMensaje, setErrorEnvioMensaje] = useState<string | null>(null);
  // Respaldo por concurrencia: si el backend responde 409 al enviar (p. ej. la orden se finalizó
  // con la pantalla abierta), la interfaz pasa a solo lectura sin reintentos.
  const [forzarSoloLectura, setForzarSoloLectura] = useState(false);
  const raiz = useRef<HTMLDivElement | null>(null);
  const yaEnfocado = useRef(false);

  async function cargarMensajes() {
    setLoadingMensajes(true);
    setErrorMensajes(null);

    try {
      const response = await fetchAutenticado(`/api/solicitudes/${solicitudId}/mensajes`, token);

      if (response.status === 403) {
        // Sin acceso: no se conserva ningún mensaje parcial.
        setSinAcceso(true);
        setMensajes(null);
        setModoBackend(null);
        return;
      }
      if (!response.ok) {
        setErrorMensajes('No se pudo cargar la conversación.');
        return;
      }

      const data = (await response.json()) as { mensajes: Mensaje[]; modo?: ModoBackend };
      setSinAcceso(false);
      setMensajes(data.mensajes);
      setModoBackend(data.modo === 'EDITABLE' || data.modo === 'SOLO_LECTURA' ? data.modo : null);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorMensajes('No se pudo cargar la conversación.');
    } finally {
      setLoadingMensajes(false);
    }
  }

  useEffect(() => {
    cargarMensajes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitudId, token]);

  useEffect(() => {
    if (enfocar && !yaEnfocado.current && !loadingMensajes && raiz.current) {
      yaEnfocado.current = true;
      raiz.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [enfocar, loadingMensajes]);

  // Sin `modo` (respuesta antigua) se usa un respaldo conservador basado en datos ya conocidos.
  const modoEfectivo: ModoBackend =
    modoBackend ??
    ((rolUsuario === 'COMERCIAL' || rolUsuario === 'OPERATIVO') && solicitudEstado !== 'CANCELADA'
      ? 'EDITABLE'
      : 'SOLO_LECTURA');
  const modo: 'sin-acceso' | 'solo-lectura' | 'editable' = sinAcceso
    ? 'sin-acceso'
    : modoEfectivo === 'SOLO_LECTURA' || forzarSoloLectura
      ? 'solo-lectura'
      : 'editable';
  // El composer solo aparece cuando el backend ya permitió leer y declaró el chat EDITABLE.
  const mostrarComposer = modo === 'editable' && !loadingMensajes && !errorMensajes;

  const titulo =
    modo === 'sin-acceso'
      ? 'Sin autorización para acceder a esta comunicación'
      : modo === 'solo-lectura'
        ? 'Comunicación técnica — solo lectura'
        : 'Comunicación técnica';
  const icono = modo === 'sin-acceso' ? 'lock' : 'forum';

  function textoEsperaDe429(response: Response, mensajeServidor: unknown): string {
    // Retry-After no es legible entre orígenes sin Access-Control-Expose-Headers;
    // si no está disponible, se intenta leer el número del mensaje del backend.
    const cabecera = response.headers.get('Retry-After');
    const desdeMensaje = typeof mensajeServidor === 'string' ? mensajeServidor.match(/en (\d+) segundos/)?.[1] : undefined;
    const segundos = Number(cabecera ?? desdeMensaje);
    return Number.isFinite(segundos) && segundos > 0
      ? `Se alcanzó temporalmente el límite de consultas a NexIA. Intente nuevamente en ${segundos} segundos.`
      : 'Se alcanzó temporalmente el límite de consultas a NexIA. Intente nuevamente en unos instantes.';
  }

  async function handleEnviarMensaje(e: FormEvent) {
    e.preventDefault();
    if (!contenidoNuevo.trim() || contenidoNuevo.length > MENSAJE_MAX_CARACTERES) return;

    setEnviandoMensaje(true);
    setErrorEnvioMensaje(null);

    try {
      const response = await fetchAutenticado(`/api/solicitudes/${solicitudId}/mensajes`, token, {
        method: 'POST',
        body: JSON.stringify({ contenido: contenidoNuevo }),
      });

      const data = await response.json().catch(() => null);

      if (response.status === 409) {
        // Sin reintentos automáticos: el mensaje no se envió y el chat pasa a solo lectura.
        setForzarSoloLectura(true);
        setErrorEnvioMensaje('La conversación pasó a modo solo lectura; el mensaje no fue enviado.');
        await cargarMensajes();
        return;
      }
      if (response.status === 403) {
        // Puede haber perdido el acceso (p. ej. reasignación): se vuelve a consultar
        // para que la interfaz refleje el estado real del backend.
        await cargarMensajes();
        setErrorEnvioMensaje('No tiene autorización para enviar mensajes en esta conversación.');
        return;
      }
      if (response.status === 429) {
        setErrorEnvioMensaje(textoEsperaDe429(response, data?.message));
        return;
      }
      if (!response.ok) {
        setErrorEnvioMensaje(data?.message || 'No se pudo enviar el mensaje.');
        return;
      }

      setContenidoNuevo('');
      await cargarMensajes();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorEnvioMensaje('No se pudo enviar el mensaje.');
    } finally {
      setEnviandoMensaje(false);
    }
  }

  return (
    <div
      ref={raiz}
      data-chat-modo={modo}
      className="md:col-span-2 bg-background border border-outline border-l-4 border-l-primary-container p-5"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="material-symbols-outlined text-primary-container text-[22px]">{icono}</span>
        <h4 className="font-headline-md text-headline-md text-on-surface uppercase">{titulo}</h4>
      </div>
      <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mb-2">
        Canal directo entre Comercial ↔ Operativo sobre esta solicitud.
      </p>

      {modo === 'editable' && (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant mb-4">
          🤖 NexIA disponible. Inicia tu mensaje con "NexIA".
        </p>
      )}
      {modo === 'solo-lectura' && (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase border border-outline px-3 py-2 mb-4">
          Conversación en modo solo lectura.
        </p>
      )}

      {loadingMensajes && (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO CONVERSACIÓN...</p>
      )}

      {!loadingMensajes && modo === 'sin-acceso' && (
        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">
          No tienes autorización para acceder a esta comunicación técnica.
        </p>
      )}

      {!loadingMensajes && modo !== 'sin-acceso' && errorMensajes && (
        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorMensajes}</p>
      )}
      {!loadingMensajes && modo !== 'sin-acceso' && !errorMensajes && mensajes && mensajes.length === 0 && (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mb-3">Sin mensajes todavía.</p>
      )}
      {!loadingMensajes && modo !== 'sin-acceso' && !errorMensajes && mensajes && mensajes.length > 0 && (
        <div className="space-y-2 mb-4 max-h-80 overflow-y-auto">
          {mensajes.map((m) => (
            <div key={m.id} className={`p-3 border border-outline ${claseBurbujaMensaje(m.autor_tipo)}`}>
              <div className="flex justify-between items-baseline mb-1">
                <span className="font-code-sm text-primary-container uppercase font-bold">{m.autor_tipo}</span>
                <span className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                  {new Date(m.creado_en).toLocaleString()}
                </span>
              </div>
              <p className="font-body-md text-body-md text-on-surface whitespace-pre-wrap">{m.contenido}</p>
            </div>
          ))}
        </div>
      )}

      {mostrarComposer && (
        <form className="space-y-2" onSubmit={handleEnviarMensaje}>
          <textarea
            value={contenidoNuevo}
            onChange={(e) => setContenidoNuevo(e.target.value)}
            required
            rows={2}
            maxLength={MENSAJE_MAX_CARACTERES}
            placeholder='Escriba un mensaje, o "NexIA, ..." para invocarla'
            className="w-full bg-background border border-outline p-3 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md resize-none"
          />
          <p
            data-chat-contador
            className={`font-['Inter'] text-[13px] font-normal text-right ${
              contenidoNuevo.length >= MENSAJE_MAX_CARACTERES ? 'text-error' : 'text-on-surface-variant'
            }`}
          >
            {contenidoNuevo.length} / {MENSAJE_MAX_CARACTERES}
          </p>
          {errorEnvioMensaje && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorEnvioMensaje}</p>}
          <button
            disabled={enviandoMensaje || !contenidoNuevo.trim()}
            type="submit"
            className="inline-flex items-center justify-center px-6 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
          >
            {enviandoMensaje ? 'ENVIANDO...' : 'ENVIAR'}
          </button>
        </form>
      )}

      {/* Aviso de un intento de envío que el backend rechazó (403/409) cuando el
          composer ya no está visible. */}
      {!mostrarComposer && errorEnvioMensaje && (
        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase mt-2">{errorEnvioMensaje}</p>
      )}
    </div>
  );
}
