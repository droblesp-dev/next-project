import { useState, type FormEvent } from 'react';
import { API_BASE } from '../lib/authClient';
import {
  mensajeSolicitudOtp,
  mensajeVerificacionOtp,
  type EstadoSolicitudOtp,
  type EstadoVerificacionOtp,
} from '../lib/recuperacionCodigo';

// QA-13: «No tengo mi código». Usa los endpoints públicos ya existentes (código temporal por correo → nuevo
// código de acceso por correo). El token identifica la cotización; el cliente nunca escribe ni ve su correo.
type Fase = 'cerrado' | 'inicio' | 'otp';

export default function RecuperarCodigoCotizacion({ token }: { token: string }) {
  const [fase, setFase] = useState<Fase>('cerrado');
  const [otp, setOtp] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; exito: boolean } | null>(null);
  const base = `${API_BASE}/api/cotizaciones/publica/${encodeURIComponent(token)}/recuperar-codigo`;

  async function llamar(ruta: string, cuerpo?: unknown): Promise<{ estado: string } | null> {
    try {
      const r = await fetch(`${base}/${ruta}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo ?? {}),
      });
      const data = await r.json().catch(() => null);
      return r.ok && typeof data?.estado === 'string' ? { estado: data.estado } : null;
    } catch {
      return null;
    }
  }

  async function solicitar() {
    setOcupado(true);
    setMensaje(null);
    const r = await llamar('solicitar');
    const m = mensajeSolicitudOtp((r?.estado ?? 'no_disponible') as EstadoSolicitudOtp);
    setMensaje({ texto: m.texto, exito: m.avanza });
    if (m.avanza) setFase('otp');
    setOcupado(false);
  }

  async function verificar(e: FormEvent) {
    e.preventDefault();
    if (otp.length !== 6) return;
    setOcupado(true);
    setMensaje(null);
    const r = await llamar('verificar', { otp });
    const m = mensajeVerificacionOtp((r?.estado ?? 'no_disponible') as EstadoVerificacionOtp);
    setMensaje({ texto: m.texto, exito: m.exito });
    if (m.exito || m.reiniciar) {
      setOtp('');
      setFase(m.exito ? 'cerrado' : 'inicio');
    }
    setOcupado(false);
  }

  const boton =
    "w-full inline-flex items-center justify-center px-6 py-3 border border-outline text-on-surface font-['Inter'] text-[13px] font-semibold hover:border-primary-container transition-colors disabled:opacity-50 cursor-pointer";

  return (
    <div className="mt-6 border-t border-outline pt-4">
      {fase === 'cerrado' && (
        <button
          type="button"
          onClick={() => {
            setFase('inicio');
            setMensaje(null);
          }}
          className="font-['Inter'] text-[13px] text-primary-container underline underline-offset-2 cursor-pointer"
        >
          ¿No tiene o olvidó su código de acceso?
        </button>
      )}

      {fase === 'inicio' && (
        <div className="space-y-3">
          <p className="font-['Inter'] text-[13px] text-on-surface-variant">
            Podemos enviarle un código temporal al correo registrado en su solicitud para generar un nuevo código de acceso.
          </p>
          <button type="button" onClick={solicitar} disabled={ocupado} className={boton}>
            {ocupado ? 'ENVIANDO...' : 'ENVIAR CÓDIGO TEMPORAL'}
          </button>
        </div>
      )}

      {fase === 'otp' && (
        <form onSubmit={verificar} className="space-y-3">
          <label htmlFor="otp-recuperacion" className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase">
            CÓDIGO TEMPORAL
          </label>
          <input
            id="otp-recuperacion"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-headline-md text-headline-md tracking-[0.4em] text-center outline-none"
            placeholder="000000"
          />
          <button type="submit" disabled={ocupado || otp.length !== 6} className={boton}>
            {ocupado ? 'VERIFICANDO...' : 'OBTENER NUEVO CÓDIGO DE ACCESO'}
          </button>
        </form>
      )}

      {mensaje && (
        <p role="alert" className={`mt-3 font-['Inter'] text-[13px] ${mensaje.exito ? 'text-primary-container' : 'text-error'}`}>
          {mensaje.texto}
        </p>
      )}
    </div>
  );
}
