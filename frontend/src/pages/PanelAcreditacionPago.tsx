import { useState } from 'react';
import {
  etiquetaConfirmarAcreditacion,
  llamadaAIso,
  OBSERVACIONES_MAX,
  textoAclaracionAcreditacion,
  validarObservaciones,
  type EvaluacionAcreditacion,
} from '../lib/dineroAcreditado';

// Panel «Dinero acreditado» (anticipo y saldo): COMERCIAL registra que ADMIN le confirmó por teléfono que el dinero
// ingresó, identificando al ADMIN que verificó. Si ADMIN no responde o el dinero todavía no aparece, registra un
// seguimiento con una observación y el pago sigue PENDIENTE. ADMIN no necesita entrar al sistema. Esta pieza solo
// presenta y valida el formulario; la llamada a la API la hace GestionCotizaciones.

export interface DatosConfirmacion {
  verificadorId: string;
  observaciones: string;
  llamadaEn: string | null;
}

export interface DatosSeguimiento {
  observaciones: string;
  llamadaEn: string | null;
}

interface PanelAcreditacionPagoProps {
  metodo: string | null | undefined;
  admins: { id: string; nombre: string }[] | null;
  cargandoAdmins: boolean;
  errorAdmins: string | null;
  ocupado: boolean;
  // Requisitos para acreditar (comprobante y revisión previa) y si se puede anotar un seguimiento.
  evaluacion: EvaluacionAcreditacion;
  puedeSeguimiento: boolean;
  onConfirmar: (datos: DatosConfirmacion) => void;
  onSeguimiento: (datos: DatosSeguimiento) => void;
  onCancelar: () => void;
}

const CLASE_CAMPO =
  'w-full bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none';
const CLASE_ETIQUETA = 'block font-code-sm text-code-sm text-on-surface-variant uppercase mb-1';
const CLASE_AVISO = "font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase";

export default function PanelAcreditacionPago({
  metodo,
  admins,
  cargandoAdmins,
  errorAdmins,
  ocupado,
  evaluacion,
  puedeSeguimiento,
  onConfirmar,
  onSeguimiento,
  onCancelar,
}: PanelAcreditacionPagoProps) {
  const [verificadorId, setVerificadorId] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [llamada, setLlamada] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Valida los datos comunes y devuelve la hora de la llamada (null si no se conoce).
  function validar(observacionObligatoria: boolean): { llamadaEn: string | null } | null {
    const errorObservaciones = validarObservaciones(observaciones, observacionObligatoria);
    if (errorObservaciones) {
      setError(errorObservaciones);
      return null;
    }
    const conversion = llamadaAIso(llamada);
    if (conversion.error) {
      setError(conversion.error);
      return null;
    }
    setError(null);
    return { llamadaEn: conversion.iso };
  }

  function confirmar() {
    if (!verificadorId) {
      setError('Seleccione el ADMIN que verificó el dinero.');
      return;
    }
    const datos = validar(false);
    if (datos) onConfirmar({ verificadorId, observaciones: observaciones.trim(), llamadaEn: datos.llamadaEn });
  }

  function seguimiento() {
    const datos = validar(true);
    if (datos) onSeguimiento({ observaciones: observaciones.trim(), llamadaEn: datos.llamadaEn });
  }

  return (
    <div className="border border-primary-container p-3 space-y-3">
      <p className={CLASE_AVISO}>{textoAclaracionAcreditacion(metodo)}</p>

      {!evaluacion.permitido && evaluacion.motivo && (
        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase" role="alert">
          {evaluacion.motivo}
        </p>
      )}

      <div>
        <label className={CLASE_ETIQUETA} htmlFor="panel-acreditacion-admin">
          ADMIN que verificó el dinero
        </label>
        {cargandoAdmins && <p className={CLASE_AVISO}>Cargando administradores…</p>}
        {errorAdmins && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorAdmins}</p>}
        {!cargandoAdmins && !errorAdmins && (
          <select
            id="panel-acreditacion-admin"
            value={verificadorId}
            onChange={(e) => setVerificadorId(e.target.value)}
            className={`${CLASE_CAMPO} cursor-pointer`}
          >
            <option value="">Seleccione un ADMIN…</option>
            {(admins ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className={CLASE_ETIQUETA} htmlFor="panel-acreditacion-llamada">
          Fecha y hora de la llamada (si la conoce)
        </label>
        <input
          id="panel-acreditacion-llamada"
          type="datetime-local"
          value={llamada}
          onChange={(e) => setLlamada(e.target.value)}
          className={CLASE_CAMPO}
        />
        <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-1">
          El sistema registra aparte la fecha y hora en que usted guarda este registro.
        </p>
      </div>

      <div>
        <label className={CLASE_ETIQUETA} htmlFor="panel-acreditacion-observaciones">
          Observaciones
        </label>
        <textarea
          id="panel-acreditacion-observaciones"
          rows={2}
          maxLength={OBSERVACIONES_MAX}
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
          placeholder="Obligatoria para un seguimiento (p. ej. «ADMIN no respondió» o «el dinero todavía no aparece»)"
          className={CLASE_CAMPO}
        />
      </div>

      {error && (
        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={ocupado || !evaluacion.permitido}
          onClick={confirmar}
          className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
        >
          {ocupado ? 'ENVIANDO...' : etiquetaConfirmarAcreditacion(metodo)}
        </button>
        <button
          type="button"
          disabled={ocupado || !puedeSeguimiento}
          onClick={seguimiento}
          title={puedeSeguimiento ? undefined : 'Registre primero la gestión (revisión) del comprobante.'}
          className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
        >
          REGISTRAR SEGUIMIENTO (SIN CONFIRMAR)
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="inline-flex items-center px-4 py-2 border border-outline text-on-surface-variant hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
        >
          CANCELAR
        </button>
      </div>
      <p className="font-code-sm text-[11px] text-on-surface-variant uppercase">
        «Registrar seguimiento» no confirma el pago: sigue PENDIENTE con su observación.
      </p>
    </div>
  );
}
