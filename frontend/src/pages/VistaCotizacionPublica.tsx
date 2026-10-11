import { useEffect, useState, type FormEvent } from 'react';
import { API_BASE } from '../lib/authClient';

interface VistaCotizacionPublicaProps {
  token: string;
}

interface CotizacionPublica {
  id: string;
  valor: string;
  estado: string;
  descripcion: string | null;
  creado_en: string;
  fecha_vigencia: string | null;
  aceptada_en: string | null;
  rechazada_en: string | null;
  anticipo_porcentaje: string | null;
  anticipo_valor: string | null;
  saldo_pendiente: string | null;
  metodo_anticipo: string | null;
  estado_anticipo: string | null;
  comprobante_recibido: boolean;
  metodo_saldo: string | null;
  estado_saldo: string;
  saldo_comprobante_recibido: boolean;
  datos_bancarios: {
    banco: string;
    tipoCuenta: string;
    numeroCuenta: string;
    titular: string;
    ruc: string;
  } | null;
  solicitud: {
    servicio: string;
    descripcion: string;
    cantidad: number;
    especificaciones: string | null;
  };
}

// Fase D.6: mismos tipos/tamaño que valida el backend — el frontend solo
// filtra para dar feedback inmediato, la validación real (mimetype real
// del archivo + límite de tamaño) ocurre en el servidor.
const TIPOS_COMPROBANTE_ACEPTADOS = ['application/pdf', 'image/jpeg', 'image/png'];
const COMPROBANTE_MAX_BYTES = 5 * 1024 * 1024;

// Fase D.5: ACEPTAR/RECHAZAR exigen token + código — se reutiliza el
// mismo código de 6 dígitos ya ingresado en esta sesión (nunca se guarda
// en localStorage/sessionStorage, solo vive en el estado del componente
// mientras la pestaña está abierta).
type Accion = 'aceptar' | 'rechazar';

// Sin login, sin JWT de cliente, sin sesión: la única "identidad" de esta
// vista es el token de la URL. El código nunca se guarda (ni siquiera en
// memoria más allá del input controlado) — no se persiste en
// localStorage/sessionStorage bajo ninguna circunstancia.
type Paso = 'cargando_enlace' | 'codigo' | 'verificando' | 'cotizacion' | 'error_enlace';

export default function VistaCotizacionPublica({ token }: VistaCotizacionPublicaProps) {
  const [paso, setPaso] = useState<Paso>('cargando_enlace');
  const [errorEnlace, setErrorEnlace] = useState<string | null>(null);
  const [codigoInput, setCodigoInput] = useState('');
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [cotizacion, setCotizacion] = useState<CotizacionPublica | null>(null);
  const [accionConfirmando, setAccionConfirmando] = useState<Accion | null>(null);
  const [accionEnCurso, setAccionEnCurso] = useState(false);
  const [accionError, setAccionError] = useState<string | null>(null);
  const [accionMensaje, setAccionMensaje] = useState<string | null>(null);
  const [archivoComprobante, setArchivoComprobante] = useState<File | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [subiendoComprobante, setSubiendoComprobante] = useState(false);

  const [archivoComprobanteSaldo, setArchivoComprobanteSaldo] = useState<File | null>(null);
  const [errorArchivoSaldo, setErrorArchivoSaldo] = useState<string | null>(null);
  const [subiendoComprobanteSaldo, setSubiendoComprobanteSaldo] = useState(false);

  useEffect(() => {
    let cancelado = false;

    async function validarEnlace() {
      try {
        const response = await fetch(`${API_BASE}/api/cotizaciones/publica/${encodeURIComponent(token)}`);

        if (cancelado) return;

        if (response.status === 401) {
          setErrorEnlace('Este enlace no es válido o ya expiró. Solicite uno nuevo a su asesor comercial.');
          setPaso('error_enlace');
          return;
        }
        if (response.status === 404) {
          setErrorEnlace('No se encontró ninguna cotización asociada a este enlace.');
          setPaso('error_enlace');
          return;
        }
        if (!response.ok) {
          setErrorEnlace('No se pudo validar el enlace en este momento. Intente nuevamente más tarde.');
          setPaso('error_enlace');
          return;
        }

        const data = (await response.json()) as { valido: boolean; requiereCodigo: boolean };
        if (data.valido && data.requiereCodigo) {
          setPaso('codigo');
        } else {
          setErrorEnlace('No se pudo validar el enlace en este momento. Intente nuevamente más tarde.');
          setPaso('error_enlace');
        }
      } catch {
        if (!cancelado) {
          setErrorEnlace('No se pudo conectar con el servidor. Verifique su conexión e intente nuevamente.');
          setPaso('error_enlace');
        }
      }
    }

    validarEnlace();
    return () => {
      cancelado = true;
    };
  }, [token]);

  async function handleVerificarCodigo(e: FormEvent) {
    e.preventDefault();
    if (codigoInput.length !== 6) return;

    setPaso('verificando');
    setErrorCodigo(null);

    try {
      const response = await fetch(`${API_BASE}/api/cotizaciones/publica/${encodeURIComponent(token)}/verificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: codigoInput }),
      });

      const data = await response.json().catch(() => null);

      if (response.status === 429) {
        setErrorCodigo(data?.message || 'Demasiados intentos. Espere unos minutos antes de volver a intentar.');
        setPaso('codigo');
        return;
      }
      if (response.status === 401) {
        setErrorCodigo(data?.message === 'Código incorrecto.' ? 'El código ingresado es incorrecto.' : 'Este enlace ya no es válido.');
        setPaso('codigo');
        return;
      }
      if (response.status === 404) {
        setErrorEnlace('No se encontró ninguna cotización asociada a este enlace.');
        setPaso('error_enlace');
        return;
      }
      if (!response.ok) {
        setErrorCodigo('No se pudo verificar el código en este momento. Intente nuevamente.');
        setPaso('codigo');
        return;
      }

      setCotizacion(data.cotizacion as CotizacionPublica);
      setPaso('cotizacion');
    } catch {
      setErrorCodigo('No se pudo conectar con el servidor. Verifique su conexión e intente nuevamente.');
      setPaso('codigo');
    }
  }

  // Fase D.5: exige token (de la URL) + el mismo código de 6 dígitos ya
  // verificado en esta sesión — nunca se acepta/rechaza solo con el token.
  // Tras una respuesta exitosa se reemplaza `cotizacion` completa con el
  // estado real devuelto por el backend: al dejar de ser ENVIADA, los
  // botones ACEPTAR/RECHAZAR desaparecen solos (no hace falta lógica
  // adicional para "impedir acciones repetidas").
  async function handleEjecutarAccion(accion: Accion) {
    setAccionEnCurso(true);
    setAccionError(null);

    try {
      const response = await fetch(`${API_BASE}/api/cotizaciones/publica/${encodeURIComponent(token)}/${accion}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: codigoInput }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        const mensajes: Record<number, string> = {
          401: data?.message === 'Código incorrecto.' ? 'El código ingresado ya no es válido.' : 'Este enlace ya no es válido o expiró.',
          404: 'No se encontró ninguna cotización asociada a este enlace.',
          409: data?.message || 'Esta cotización ya no admite esta acción.',
          429: data?.message || 'Demasiados intentos. Espere unos minutos antes de volver a intentar.',
        };
        setAccionError(mensajes[response.status] || 'No se pudo completar la acción en este momento. Intente nuevamente.');
        setAccionConfirmando(null);
        return;
      }

      setCotizacion(data.cotizacion as CotizacionPublica);
      setAccionMensaje(accion === 'aceptar' ? 'Cotización aceptada correctamente.' : 'Cotización rechazada correctamente.');
      setAccionConfirmando(null);
    } catch {
      setAccionError('No se pudo conectar con el servidor. Verifique su conexión e intente nuevamente.');
      setAccionConfirmando(null);
    } finally {
      setAccionEnCurso(false);
    }
  }

  function handleSeleccionarArchivo(archivo: File | null) {
    setErrorArchivo(null);
    if (!archivo) {
      setArchivoComprobante(null);
      return;
    }
    if (!TIPOS_COMPROBANTE_ACEPTADOS.includes(archivo.type)) {
      setErrorArchivo('Formato no permitido. Solo se aceptan PDF, JPG o PNG.');
      setArchivoComprobante(null);
      return;
    }
    if (archivo.size > COMPROBANTE_MAX_BYTES) {
      setErrorArchivo('El archivo excede el tamaño máximo permitido (5 MB).');
      setArchivoComprobante(null);
      return;
    }
    setArchivoComprobante(archivo);
  }

  function handleSeleccionarArchivoSaldo(archivo: File | null) {
    setErrorArchivoSaldo(null);
    if (!archivo) {
      setArchivoComprobanteSaldo(null);
      return;
    }
    if (!TIPOS_COMPROBANTE_ACEPTADOS.includes(archivo.type)) {
      setErrorArchivoSaldo('Formato no permitido. Solo se aceptan PDF, JPG o PNG.');
      setArchivoComprobanteSaldo(null);
      return;
    }
    if (archivo.size > COMPROBANTE_MAX_BYTES) {
      setErrorArchivoSaldo('El archivo excede el tamaño máximo permitido (5 MB).');
      setArchivoComprobanteSaldo(null);
      return;
    }
    setArchivoComprobanteSaldo(archivo);
  }

  // Fase D.6: multipart/form-data con el código de acceso + el archivo.
  // Nunca se envía el archivo sin el código — mismo requisito de
  // token+código que aceptar/rechazar.
  async function handleSubirComprobante() {
    if (!archivoComprobante) return;

    setSubiendoComprobante(true);
    setErrorArchivo(null);

    try {
      const formData = new FormData();
      formData.append('codigo', codigoInput);
      formData.append('archivo', archivoComprobante);

      const response = await fetch(`${API_BASE}/api/cotizaciones/publica/${encodeURIComponent(token)}/comprobante`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorArchivo(data?.message || 'No se pudo subir el comprobante. Intente nuevamente.');
        return;
      }

      setCotizacion(data.cotizacion as CotizacionPublica);
      setArchivoComprobante(null);
    } catch {
      setErrorArchivo('No se pudo conectar con el servidor. Verifique su conexión e intente nuevamente.');
    } finally {
      setSubiendoComprobante(false);
    }
  }

  // Bloque saldo/entrega/cierre: mismo patrón que handleSubirComprobante,
  // hacia el endpoint público del comprobante del SALDO. A diferencia del
  // anticipo, el cliente puede subir este comprobante sin que Comercial
  // haya elegido de antemano un método — el propio envío fija TRANSFERENCIA
  // en el servidor.
  async function handleSubirComprobanteSaldo() {
    if (!archivoComprobanteSaldo) return;

    setSubiendoComprobanteSaldo(true);
    setErrorArchivoSaldo(null);

    try {
      const formData = new FormData();
      formData.append('codigo', codigoInput);
      formData.append('archivo', archivoComprobanteSaldo);

      const response = await fetch(`${API_BASE}/api/cotizaciones/publica/${encodeURIComponent(token)}/comprobante-saldo`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setErrorArchivoSaldo(data?.message || 'No se pudo subir el comprobante. Intente nuevamente.');
        return;
      }

      setCotizacion(data.cotizacion as CotizacionPublica);
      setArchivoComprobanteSaldo(null);
    } catch {
      setErrorArchivoSaldo('No se pudo conectar con el servidor. Verifique su conexión e intente nuevamente.');
    } finally {
      setSubiendoComprobanteSaldo(false);
    }
  }

  return (
    <div className="bg-background text-on-surface font-body-md antialiased min-h-screen flex items-center justify-center px-margin-mobile py-12">
      <div className="w-full max-w-lg">
        <a className="font-headline-lg text-headline-lg-mobile font-black text-on-surface uppercase tracking-tighter flex items-center justify-center mb-1">
          <span>NEXT</span>
          <span className="text-primary-container">PROJECT</span>
        </a>
        <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-8 text-center">
          COTIZACIÓN
        </h3>

        <div className="bg-surface sharp-border p-6 md:p-8">
          {paso === 'cargando_enlace' && (
            <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase text-center py-8">
              VALIDANDO ENLACE...
            </p>
          )}

          {paso === 'error_enlace' && (
            <div className="text-center py-6 space-y-3">
              <span className="material-symbols-outlined text-4xl text-error">link_off</span>
              <p className="font-body-md text-body-md text-on-surface">{errorEnlace}</p>
            </div>
          )}

          {(paso === 'codigo' || paso === 'verificando') && (
            <>
              <p className="font-body-md text-body-md text-on-surface-variant mb-1">
                Tiene una cotización disponible para consultar.
              </p>
              <p className="font-body-md text-sm text-on-surface-variant mb-6">
                Ingrese el código de 6 dígitos que le compartió su asesor comercial.
              </p>

              <form className="space-y-6" onSubmit={handleVerificarCodigo}>
                <div>
                  <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-2">
                    CÓDIGO DE ACCESO
                  </label>
                  <input
                    value={codigoInput}
                    onChange={(e) => setCodigoInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-headline-md text-headline-md tracking-[0.4em] text-center outline-none"
                    placeholder="000000"
                  />
                </div>

                {errorCodigo && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorCodigo}</p>}

                <button
                  disabled={paso === 'verificando' || codigoInput.length !== 6}
                  type="submit"
                  className="w-full inline-flex items-center justify-center px-6 py-4 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {paso === 'verificando' ? 'VERIFICANDO...' : 'VER COTIZACIÓN'}
                </button>
              </form>
            </>
          )}

          {paso === 'cotizacion' && cotizacion && (
            <div className="space-y-4">
              <div className="flex justify-between items-start border-b border-outline pb-4">
                <h3 className="font-headline-md text-headline-md text-on-surface uppercase">
                  {cotizacion.solicitud.servicio}
                </h3>
                <span className="font-code-sm text-code-sm text-primary-container uppercase shrink-0 ml-4">
                  {cotizacion.estado}
                </span>
              </div>

              <p className="font-body-md text-body-md text-on-surface-variant">{cotizacion.solicitud.descripcion}</p>

              <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
                <div>
                  <dt className="text-on-surface-variant uppercase">Cantidad</dt>
                  <dd className="text-on-surface">{cotizacion.solicitud.cantidad}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Valor</dt>
                  <dd className="text-on-surface">${cotizacion.valor}</dd>
                </div>
                {cotizacion.fecha_vigencia && (
                  <div>
                    <dt className="text-on-surface-variant uppercase">Vigencia</dt>
                    <dd className="text-on-surface">{new Date(cotizacion.fecha_vigencia).toLocaleString()}</dd>
                  </div>
                )}
                {cotizacion.aceptada_en && (
                  <div>
                    <dt className="text-on-surface-variant uppercase">Aceptada</dt>
                    <dd className="text-on-surface">{new Date(cotizacion.aceptada_en).toLocaleString()}</dd>
                  </div>
                )}
                {cotizacion.rechazada_en && (
                  <div>
                    <dt className="text-on-surface-variant uppercase">Rechazada</dt>
                    <dd className="text-on-surface">{new Date(cotizacion.rechazada_en).toLocaleString()}</dd>
                  </div>
                )}
              </dl>

              {cotizacion.solicitud.especificaciones && (
                <div>
                  <p className="font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-1">Especificaciones</p>
                  <p className="font-body-md text-body-md text-on-surface">{cotizacion.solicitud.especificaciones}</p>
                </div>
              )}

              {cotizacion.descripcion && (
                <div>
                  <p className="font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-1">Observaciones</p>
                  <p className="font-body-md text-body-md text-on-surface">{cotizacion.descripcion}</p>
                </div>
              )}

              {accionMensaje && (
                <p className="font-['Inter'] text-[13px] font-normal text-primary-container uppercase border-t border-outline pt-4">
                  {accionMensaje}
                </p>
              )}

              {cotizacion.estado === 'ENVIADA' && (
                <div className="border-t border-outline pt-4 space-y-3">
                  {accionConfirmando === null && (
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setAccionError(null);
                          setAccionConfirmando('aceptar');
                        }}
                        className="flex-1 inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors cursor-pointer"
                      >
                        ACEPTAR COTIZACIÓN
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAccionError(null);
                          setAccionConfirmando('rechazar');
                        }}
                        className="flex-1 inline-flex items-center justify-center px-6 py-3 border border-error text-error hover:bg-error hover:text-on-error transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                      >
                        RECHAZAR COTIZACIÓN
                      </button>
                    </div>
                  )}

                  {accionConfirmando !== null && (
                    <div className="bg-background sharp-border p-4 space-y-3">
                      <p className="font-body-md text-body-md text-on-surface">
                        {accionConfirmando === 'aceptar'
                          ? '¿Confirma que desea ACEPTAR esta cotización? Esta acción no se puede deshacer.'
                          : '¿Confirma que desea RECHAZAR esta cotización? Esta acción no se puede deshacer.'}
                      </p>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <button
                          type="button"
                          disabled={accionEnCurso}
                          onClick={() => handleEjecutarAccion(accionConfirmando)}
                          className="flex-1 inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {accionEnCurso ? 'PROCESANDO...' : 'SÍ, CONFIRMAR'}
                        </button>
                        <button
                          type="button"
                          disabled={accionEnCurso}
                          onClick={() => setAccionConfirmando(null)}
                          className="flex-1 inline-flex items-center justify-center px-6 py-3 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          CANCELAR
                        </button>
                      </div>
                    </div>
                  )}

                  {accionError && (
                    <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{accionError}</p>
                  )}
                </div>
              )}

              {cotizacion.estado === 'ACEPTADA' && cotizacion.estado_anticipo === 'NO_APLICA' && (
                <p className="font-['Inter'] text-[13px] font-normal text-primary-container uppercase border-t border-outline pt-4">
                  No se requiere anticipo. Su cotización fue aceptada.
                </p>
              )}

              {cotizacion.estado === 'ACEPTADA' && cotizacion.estado_anticipo && cotizacion.estado_anticipo !== 'NO_APLICA' && (
                <div className="border-t border-outline pt-4 space-y-4">
                  <h4 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase">
                    ANTICIPO
                  </h4>

                  <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
                    <div>
                      <dt className="text-on-surface-variant uppercase">Valor anticipo</dt>
                      <dd className="text-on-surface">${cotizacion.anticipo_valor}</dd>
                    </div>
                    <div>
                      <dt className="text-on-surface-variant uppercase">Saldo pendiente</dt>
                      <dd className="text-on-surface">${cotizacion.saldo_pendiente}</dd>
                    </div>
                    <div>
                      <dt className="text-on-surface-variant uppercase">Método</dt>
                      <dd className="text-on-surface">{cotizacion.metodo_anticipo}</dd>
                    </div>
                    <div>
                      <dt className="text-on-surface-variant uppercase">Estado</dt>
                      <dd className="text-on-surface">{cotizacion.estado_anticipo}</dd>
                    </div>
                  </dl>

                  {cotizacion.estado_anticipo === 'VALIDADO' && (
                    <p className="font-['Inter'] text-[13px] font-normal text-primary-container uppercase">
                      Anticipo confirmado por Comercial.
                    </p>
                  )}

                  {cotizacion.estado_anticipo === 'RECHAZADO' && (
                    <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">
                      El anticipo fue rechazado. Contacte a su asesor comercial.
                    </p>
                  )}

                  {cotizacion.estado_anticipo === 'PENDIENTE' && cotizacion.metodo_anticipo === 'EFECTIVO' && (
                    <p className="font-body-md text-body-md text-on-surface">
                      Realice el pago del anticipo de forma presencial en el Centro de Mecanizado Industrial.
                    </p>
                  )}

                  {cotizacion.estado_anticipo === 'PENDIENTE' && cotizacion.metodo_anticipo === 'TRANSFERENCIA' && (
                    <div className="space-y-4">
                      {cotizacion.datos_bancarios ? (
                        <dl className="bg-background sharp-border p-4 grid grid-cols-2 gap-3 font-code-sm text-code-sm">
                          <div>
                            <dt className="text-on-surface-variant uppercase">Banco</dt>
                            <dd className="text-on-surface">{cotizacion.datos_bancarios.banco}</dd>
                          </div>
                          <div>
                            <dt className="text-on-surface-variant uppercase">Tipo de cuenta</dt>
                            <dd className="text-on-surface">{cotizacion.datos_bancarios.tipoCuenta}</dd>
                          </div>
                          <div>
                            <dt className="text-on-surface-variant uppercase">Número de cuenta</dt>
                            <dd className="text-on-surface">{cotizacion.datos_bancarios.numeroCuenta}</dd>
                          </div>
                          <div>
                            <dt className="text-on-surface-variant uppercase">Titular</dt>
                            <dd className="text-on-surface">{cotizacion.datos_bancarios.titular}</dd>
                          </div>
                          <div>
                            <dt className="text-on-surface-variant uppercase">RUC</dt>
                            <dd className="text-on-surface">{cotizacion.datos_bancarios.ruc}</dd>
                          </div>
                        </dl>
                      ) : (
                        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">
                          Datos bancarios no configurados. Contacte a su asesor comercial.
                        </p>
                      )}

                      {cotizacion.comprobante_recibido ? (
                        <p className="font-['Inter'] text-[13px] font-normal text-primary-container uppercase">
                          Comprobante recibido. Pendiente de revisión por Comercial.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-1">
                            Comprobante de transferencia (PDF, JPG o PNG, máx. 5 MB)
                          </label>
                          <input
                            type="file"
                            accept="application/pdf,image/jpeg,image/png"
                            onChange={(e) => handleSeleccionarArchivo(e.target.files?.[0] ?? null)}
                            className="block w-full text-on-surface font-body-md text-sm"
                          />
                          {errorArchivo && (
                            <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorArchivo}</p>
                          )}
                          <button
                            type="button"
                            disabled={!archivoComprobante || subiendoComprobante}
                            onClick={handleSubirComprobante}
                            className="w-full inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {subiendoComprobante ? 'SUBIENDO...' : 'SUBIR COMPROBANTE'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {cotizacion.estado === 'ACEPTADA' && (
                <div className="border-t border-outline pt-4 space-y-4">
                  <h4 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase">
                    SALDO
                  </h4>

                  <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
                    <div>
                      <dt className="text-on-surface-variant uppercase">Saldo pendiente</dt>
                      <dd className="text-on-surface">${cotizacion.saldo_pendiente}</dd>
                    </div>
                    <div>
                      <dt className="text-on-surface-variant uppercase">Estado</dt>
                      <dd className="text-on-surface">{cotizacion.estado_saldo}</dd>
                    </div>
                  </dl>

                  {cotizacion.estado_saldo === 'VALIDADO' && (
                    <p className="font-['Inter'] text-[13px] font-normal text-primary-container uppercase">
                      Saldo confirmado por Comercial.
                    </p>
                  )}

                  {cotizacion.estado_saldo === 'RECHAZADO' && (
                    <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">
                      El pago del saldo fue rechazado. Contacte a su asesor comercial.
                    </p>
                  )}

                  {cotizacion.estado_saldo === 'PENDIENTE' && (
                    <div className="space-y-4">
                      {cotizacion.saldo_comprobante_recibido ? (
                        <p className="font-['Inter'] text-[13px] font-normal text-primary-container uppercase">
                          Comprobante recibido. Pendiente de revisión por Comercial.
                        </p>
                      ) : (
                        <>
                          <p className="font-body-md text-body-md text-on-surface">
                            Puede pagar el saldo por transferencia (subiendo el comprobante a continuación) o de
                            forma presencial en efectivo en el Centro de Mecanizado Industrial.
                          </p>

                          {cotizacion.datos_bancarios && (
                            <dl className="bg-background sharp-border p-4 grid grid-cols-2 gap-3 font-code-sm text-code-sm">
                              <div>
                                <dt className="text-on-surface-variant uppercase">Banco</dt>
                                <dd className="text-on-surface">{cotizacion.datos_bancarios.banco}</dd>
                              </div>
                              <div>
                                <dt className="text-on-surface-variant uppercase">Tipo de cuenta</dt>
                                <dd className="text-on-surface">{cotizacion.datos_bancarios.tipoCuenta}</dd>
                              </div>
                              <div>
                                <dt className="text-on-surface-variant uppercase">Número de cuenta</dt>
                                <dd className="text-on-surface">{cotizacion.datos_bancarios.numeroCuenta}</dd>
                              </div>
                              <div>
                                <dt className="text-on-surface-variant uppercase">Titular</dt>
                                <dd className="text-on-surface">{cotizacion.datos_bancarios.titular}</dd>
                              </div>
                              <div>
                                <dt className="text-on-surface-variant uppercase">RUC</dt>
                                <dd className="text-on-surface">{cotizacion.datos_bancarios.ruc}</dd>
                              </div>
                            </dl>
                          )}

                          <div className="space-y-3">
                            <label className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-1">
                              Comprobante de transferencia del saldo (PDF, JPG o PNG, máx. 5 MB)
                            </label>
                            <input
                              type="file"
                              accept="application/pdf,image/jpeg,image/png"
                              onChange={(e) => handleSeleccionarArchivoSaldo(e.target.files?.[0] ?? null)}
                              className="block w-full text-on-surface font-body-md text-sm"
                            />
                            {errorArchivoSaldo && (
                              <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorArchivoSaldo}</p>
                            )}
                            <button
                              type="button"
                              disabled={!archivoComprobanteSaldo || subiendoComprobanteSaldo}
                              onClick={handleSubirComprobanteSaldo}
                              className="w-full inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {subiendoComprobanteSaldo ? 'SUBIENDO...' : 'SUBIR COMPROBANTE'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
