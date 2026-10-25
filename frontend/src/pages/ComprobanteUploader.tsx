import { useEffect, useRef, useState } from 'react';
import { esImagen, formatearTamano } from '../lib/cotizacionPublica';

interface ComprobanteUploaderProps {
  // Identificador del <input type="file"> (distinto para anticipo y saldo).
  id: string;
  titulo: string;
  descripcion: string;
  archivo: File | null;
  error: string | null;
  subiendo: boolean;
  onSeleccionar: (archivo: File | null) => void;
  onSubir: () => void;
}

// Carga de un comprobante de pago: seleccionar, ver una vista previa, quitar o cambiar la selección y
// recién entonces enviarlo. Quitar una selección NO toca ningún comprobante ya enviado (esos se
// conservan en el historial del servidor); solo descarta el archivo que aún no se subió.
export default function ComprobanteUploader({
  id,
  titulo,
  descripcion,
  archivo,
  error,
  subiendo,
  onSeleccionar,
  onSubir,
}: ComprobanteUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);

  // La URL temporal de la vista previa se libera al cambiar de archivo o al desmontar el componente.
  useEffect(() => {
    if (!archivo || !esImagen(archivo.type)) {
      setVistaPrevia(null);
      return;
    }
    const url = URL.createObjectURL(archivo);
    setVistaPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [archivo]);

  function limpiarInput() {
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleQuitar() {
    limpiarInput();
    onSeleccionar(null);
  }

  const idError = `${id}-error`;

  return (
    <div className="bg-background sharp-border p-4 space-y-3 min-w-0">
      <div>
        <p className="font-['Inter'] text-[14px] font-semibold text-on-surface">{titulo}</p>
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant mt-1">{descripcion}</p>
      </div>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        aria-describedby={error ? idError : undefined}
        onChange={(e) => {
          onSeleccionar(e.target.files?.[0] ?? null);
          // Permite volver a elegir el mismo archivo después de quitarlo.
          limpiarInput();
        }}
        className="sr-only"
      />

      {!archivo ? (
        <label
          htmlFor={id}
          className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-primary-container p-6 text-center cursor-pointer hover:bg-surface-container-high focus-within:ring-2 focus-within:ring-primary-container transition-colors"
        >
          <span className="material-symbols-outlined text-primary-container text-[32px]" aria-hidden="true">
            cloud_upload
          </span>
          <span className="font-['Inter'] text-[14px] font-semibold text-on-surface">Selecciona tu comprobante</span>
          <span className="font-['Inter'] text-[12px] font-normal text-on-surface-variant">PDF, JPG o PNG · Máximo 5 MB</span>
          <span className="inline-flex items-center gap-1.5 px-4 py-2 mt-1 bg-primary-container text-on-primary-container font-['Inter'] text-[13px] font-semibold">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
              folder_open
            </span>
            ELEGIR ARCHIVO
          </span>
        </label>
      ) : (
        <div className="border border-outline p-3 space-y-3 min-w-0">
          {vistaPrevia ? (
            <img
              src={vistaPrevia}
              alt="Vista previa del comprobante seleccionado"
              className="mx-auto max-h-56 max-w-full object-contain bg-surface"
            />
          ) : (
            <div className="flex items-center justify-center gap-2 py-6 bg-surface text-on-surface-variant">
              <span className="material-symbols-outlined text-[32px]" aria-hidden="true">
                picture_as_pdf
              </span>
              <span className="font-['Inter'] text-[13px]">Documento PDF</span>
            </div>
          )}

          <div className="min-w-0">
            {/* El nombre completo siempre queda accesible (title + texto que se parte en cualquier punto). */}
            <p className="font-['Inter'] text-[13px] font-semibold text-on-surface break-all" title={archivo.name}>
              {archivo.name}
            </p>
            <p className="font-['Inter'] text-[12px] font-normal text-on-surface-variant">{formatearTamano(archivo.size)}</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <label
              htmlFor={id}
              className="flex-1 inline-flex items-center justify-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[13px] font-semibold cursor-pointer focus-within:ring-2 focus-within:ring-primary-container"
            >
              CAMBIAR ARCHIVO
            </label>
            <button
              type="button"
              onClick={handleQuitar}
              disabled={subiendo}
              className="flex-1 inline-flex items-center justify-center px-4 py-2 border border-error text-error hover:bg-error hover:text-on-error transition-colors font-['Inter'] text-[13px] font-semibold disabled:opacity-50 cursor-pointer"
            >
              QUITAR
            </button>
          </div>
        </div>
      )}

      {error && (
        <p id={idError} role="alert" className="font-['Inter'] text-[13px] font-normal text-error break-words">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!archivo || subiendo}
        onClick={onSubir}
        className="w-full inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
      >
        {subiendo ? 'SUBIENDO...' : 'SUBIR COMPROBANTE'}
      </button>
      <p className="font-['Inter'] text-[12px] font-normal text-on-surface-variant text-center">
        Primero selecciona el archivo y después pulsa «Subir comprobante».
      </p>
    </div>
  );
}
