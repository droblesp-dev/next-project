import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  CambioPasswordError,
  cambiarPasswordApi,
  SesionInvalidaError,
  type Sesion,
  type Usuario,
} from '../lib/authClient';
import IndicadorFortalezaPassword from './IndicadorFortalezaPassword';
import {
  evaluarPassword,
  LONGITUD_MINIMA_PASSWORD,
  MENSAJES_PROBLEMA,
  type ProblemaPassword,
} from '../lib/politicaPassword';

interface CambiarPasswordModalProps {
  usuario: Usuario;
  token: string;
  onCerrar: () => void;
  onSesionInvalida: () => void;
  onSesionRenovada: (sesion: Sesion) => void;
}

function CampoPassword({
  id,
  etiqueta,
  valor,
  onCambio,
  autoComplete,
  refInput,
  deshabilitado,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  autoComplete: string;
  refInput?: RefObject<HTMLInputElement | null>;
  deshabilitado: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block font-code-sm text-[11px] text-on-surface-variant uppercase mb-2">
        {etiqueta}
      </label>
      <div className="relative">
        <input
          id={id}
          ref={refInput}
          type={visible ? 'text' : 'password'}
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          autoComplete={autoComplete}
          disabled={deshabilitado}
          className="w-full bg-background border border-outline text-on-surface px-3 py-2 pr-11 focus:ring-0 focus:border-primary-container transition-colors font-['Inter'] text-[14px] outline-none disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Ocultar ${etiqueta.toLowerCase()}` : `Mostrar ${etiqueta.toLowerCase()}`}
          aria-pressed={visible}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 w-10 inline-flex items-center justify-center text-on-surface-variant hover:text-on-surface cursor-pointer"
        >
          <span className="material-symbols-outlined text-[20px]">{visible ? 'visibility_off' : 'visibility'}</span>
        </button>
      </div>
    </div>
  );
}

// Texto de la regla del límite de longitud: sin términos técnicos (el límite real lo valida el servidor).
export const TEXTO_REGLA_LARGO = 'La contraseña no debe ser demasiado larga';

// Estado de la regla de longitud máxima: null mientras el campo está vacío; true si no se supera el límite.
export function estadoReglaLargo(password: string, problemas: ProblemaPassword[]): boolean | null {
  return password.length > 0 ? !problemas.includes('MAX_BYTES') : null;
}

export function Requisito({ cumplido, texto }: { cumplido: boolean | null; texto: string }) {
  const icono = cumplido === null ? 'radio_button_unchecked' : cumplido ? 'check_circle' : 'cancel';
  const color = cumplido === null ? 'text-on-surface-variant' : cumplido ? 'text-[#22c55e]' : 'text-error';
  return (
    <li className={`flex items-center gap-2 ${color}`}>
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
        {icono}
      </span>
      <span className="font-['Inter'] text-[12px]">{texto}</span>
    </li>
  );
}

export default function CambiarPasswordModal({
  usuario,
  token,
  onCerrar,
  onSesionInvalida,
  onSesionRenovada,
}: CambiarPasswordModalProps) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<{ mensaje: string; detalles: string[] } | null>(null);
  const [completado, setCompletado] = useState(false);
  const primerCampoRef = useRef<HTMLInputElement | null>(null);

  const evaluacion = useMemo(
    () => evaluarPassword(nueva, { nombre: usuario.nombre, email: usuario.email }),
    [nueva, usuario.nombre, usuario.email]
  );
  const hayNueva = nueva.length > 0;
  const tiene = (p: ProblemaPassword) => evaluacion.problemas.includes(p);

  const coincide = confirmacion.length > 0 && confirmacion === nueva;
  const distintaDeLaActual = hayNueva && actual.length > 0 && nueva !== actual;
  const puedeEnviar =
    !enviando &&
    !completado &&
    actual.length > 0 &&
    evaluacion.nivel === 'FUERTE' &&
    coincide &&
    nueva !== actual;

  useEffect(() => {
    primerCampoRef.current?.focus();
  }, []);

  useEffect(() => {
    function alPulsarTecla(e: KeyboardEvent) {
      if (e.key === 'Escape' && !enviando) onCerrar();
    }
    document.addEventListener('keydown', alPulsarTecla);
    return () => document.removeEventListener('keydown', alPulsarTecla);
  }, [enviando, onCerrar]);

  async function alEnviar(e: FormEvent) {
    e.preventDefault();
    if (!puedeEnviar) return;
    setError(null);
    setEnviando(true);
    try {
      const sesion = await cambiarPasswordApi(token, {
        passwordActual: actual,
        passwordNueva: nueva,
        confirmacion,
      });
      // Solo se confirma cuando el servidor respondió bien. El token nuevo reemplaza al anterior.
      onSesionRenovada(sesion);
      setActual('');
      setNueva('');
      setConfirmacion('');
      setCompletado(true);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      if (err instanceof CambioPasswordError) {
        setError({ mensaje: err.message, detalles: err.detalles });
      } else {
        setError({ mensaje: 'No se pudo cambiar la contraseña. Inténtalo de nuevo.', detalles: [] });
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enviando) onCerrar();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-cambiar-password"
        className="w-full max-w-md bg-surface sharp-border my-auto"
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-outline">
          <div>
            <h2
              id="titulo-cambiar-password"
              className="font-['Montserrat'] text-[20px] font-black text-on-surface uppercase tracking-tight"
            >
              Cambiar contraseña
            </h2>
            <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-1">
              Solo se aceptan contraseñas fuertes
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            disabled={enviando}
            aria-label="Cerrar"
            className="inline-flex items-center justify-center w-9 h-9 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[22px]">close</span>
          </button>
        </div>

        {completado ? (
          <div className="p-5">
            <div className="border-l-4 border-l-[#22c55e] bg-surface-container-high p-4" role="status">
              <p className="font-['Inter'] text-[14px] font-semibold text-on-surface">Contraseña actualizada.</p>
              <p className="font-['Inter'] text-[13px] text-on-surface-variant mt-1">
                Las demás sesiones abiertas de tu cuenta se cerraron y te enviamos un aviso por correo. Tú sigues
                dentro.
              </p>
            </div>
            <div className="flex justify-end mt-5">
              <button
                type="button"
                onClick={onCerrar}
                className="px-5 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold cursor-pointer"
              >
                CERRAR
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={alEnviar} noValidate>
            <div className="p-5 space-y-4">
              <CampoPassword
                id="password-actual"
                etiqueta="Contraseña actual"
                valor={actual}
                onCambio={setActual}
                autoComplete="current-password"
                refInput={primerCampoRef}
                deshabilitado={enviando}
              />
              <CampoPassword
                id="password-nueva"
                etiqueta="Nueva contraseña"
                valor={nueva}
                onCambio={setNueva}
                autoComplete="new-password"
                deshabilitado={enviando}
              />

              <IndicadorFortalezaPassword nivel={hayNueva ? evaluacion.nivel : null} />

              <ul className="space-y-1.5">
                <Requisito
                  cumplido={hayNueva ? !tiene('LONGITUD_MIN') : null}
                  texto={`Al menos ${LONGITUD_MINIMA_PASSWORD} caracteres`}
                />
                <Requisito cumplido={estadoReglaLargo(nueva, evaluacion.problemas)} texto={TEXTO_REGLA_LARGO} />
                <Requisito cumplido={hayNueva ? !tiene('COMUN') : null} texto="No es una contraseña común o predecible" />
                <Requisito
                  cumplido={hayNueva ? !tiene('CONTIENE_DATOS') : null}
                  texto="No contiene tu nombre ni parte de tu correo"
                />
                <Requisito
                  cumplido={hayNueva ? !tiene('REPETIDA') && !tiene('SECUENCIA') : null}
                  texto="Sin repeticiones ni secuencias (123456, abcdef)"
                />
                <Requisito
                  cumplido={hayNueva ? (evaluacion.nivel === 'FUERTE' ? true : tiene('POCA_VARIEDAD') ? false : null) : null}
                  texto="Suficiente variedad"
                />
                <Requisito cumplido={hayNueva && actual.length > 0 ? distintaDeLaActual : null} texto="Distinta de la actual" />
              </ul>

              {hayNueva && tiene('MAX_BYTES') && (
                <p className="font-['Inter'] text-[12px] text-error" role="alert">
                  {MENSAJES_PROBLEMA.MAX_BYTES}
                </p>
              )}

              <CampoPassword
                id="password-confirmacion"
                etiqueta="Confirmar nueva contraseña"
                valor={confirmacion}
                onCambio={setConfirmacion}
                autoComplete="new-password"
                deshabilitado={enviando}
              />
              {confirmacion.length > 0 && !coincide && (
                <p className="font-['Inter'] text-[12px] text-error">La confirmación no coincide con la nueva contraseña.</p>
              )}

              {error && (
                <div className="border-l-4 border-l-error bg-error-container/20 p-3" role="alert">
                  <p className="font-['Inter'] text-[13px] text-error font-semibold">{error.mensaje}</p>
                  {error.detalles.length > 0 && (
                    <ul className="list-disc pl-5 mt-1 font-['Inter'] text-[12px] text-error">
                      {error.detalles.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 p-5 border-t border-outline">
              <button
                type="button"
                onClick={onCerrar}
                disabled={enviando}
                className="px-5 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer disabled:opacity-50"
              >
                CANCELAR
              </button>
              <button
                type="submit"
                disabled={!puedeEnviar}
                className="px-5 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {enviando ? 'ACTUALIZANDO…' : 'ACTUALIZAR CONTRASEÑA'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
