import { useEffect, useState, type FormEvent } from 'react';
import { API_BASE } from '../lib/authClient';
import { claveCuentaReceptora } from '../lib/cuentasReceptoras';

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
  // PC-2026-01 ("Implementación completa de Gestión de Cuentas Bancarias",
  // Fase F): cuentas receptoras reales del catálogo administrado por
  // ADMIN. Convive con `datos_bancarios` (variables BANCO_*, no
  // retiradas) — se prefiere esta lista cuando no está vacía; si está
  // vacía se usa `datos_bancarios` como respaldo, sin romper el
  // comportamiento actual. `titular` es `string | null`: null significa
  // que esa cuenta no debe mostrar el nombre del titular al cliente
  // (decisión 5 de la autorización) — nunca se inventa un valor en su
  // lugar.
  cuentas_bancarias_activas: {
    banco: string;
    titular: string | null;
    tipo_cuenta: string;
    numero_cuenta: string;
    logo_url: string | null;
  }[];
  solicitud: {
    servicio: string;
    descripcion: string;
    cantidad: number;
    especificaciones: string | null;
  };
}

type CuentaBancariaPublicaFront = {
  banco: string;
  titular: string | null;
  tipo_cuenta: string;
  numero_cuenta: string;
  logo_url: string | null;
};

type DatosBancariosLegacy = {
  banco: string;
  tipoCuenta: string;
  numeroCuenta: string;
  titular: string;
  ruc: string;
};

// PC-2026-01 (Fase F): bloque compartido por ANTICIPO y SALDO — muestra la
// cuenta receptora real de NextProject. Reglas explícitas de la
// autorización: solo cuentas activas (ya filtradas por el backend, nunca
// aquí); si hay una sola, se usa directamente (decisión 8); si hay varias,
// el cliente elige; el titular solo se muestra si el backend lo entrega
// (no null); nunca se confunde con el banco de origen de la transferencia
// del cliente; una cuenta elegida NUNCA implica que el pago ya se acreditó
// — ese estado solo lo decide Comercial/ADMIN (estado_anticipo/
// estado_saldo), nunca esta pantalla.
function BloqueCuentaReceptora({
  cuentas,
  datosLegacy,
  indiceElegido,
  onElegir,
}: {
  cuentas: CuentaBancariaPublicaFront[];
  datosLegacy: DatosBancariosLegacy | null;
  indiceElegido: number;
  onElegir: (indice: number) => void;
}) {
  if (cuentas.length === 0) {
    if (!datosLegacy) {
      return (
        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">
          Datos bancarios no configurados. Contacte a su asesor comercial.
        </p>
      );
    }
    return (
      <dl className="bg-background sharp-border p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 font-code-sm text-code-sm">
        <div className="min-w-0">
          <dt className="text-on-surface-variant uppercase">Banco</dt>
          <dd className="text-on-surface break-words">{datosLegacy.banco}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-on-surface-variant uppercase">Tipo de cuenta</dt>
          <dd className="text-on-surface break-words">{datosLegacy.tipoCuenta}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-on-surface-variant uppercase">Número de cuenta</dt>
          <dd className="text-on-surface break-words">{datosLegacy.numeroCuenta}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-on-surface-variant uppercase">Titular</dt>
          <dd className="text-on-surface break-words">{datosLegacy.titular}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-on-surface-variant uppercase">RUC</dt>
          <dd className="text-on-surface break-words">{datosLegacy.ruc}</dd>
        </div>
      </dl>
    );
  }

  const indiceSeguro = indiceElegido < cuentas.length ? indiceElegido : 0;
  const elegida = cuentas[indiceSeguro];

  return (
    <div className="space-y-3">
      {cuentas.length > 1 && (
        <div className="space-y-2">
          <p className="font-code-sm text-[11px] text-on-surface-variant uppercase">Elija la cuenta a la que transferirá</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {cuentas.map((c, i) => (
              <button
                key={claveCuentaReceptora(c, i)}
                type="button"
                onClick={() => onElegir(i)}
                className={`flex items-center gap-2 p-3 text-left border transition-colors cursor-pointer ${
                  i === indiceSeguro
                    ? 'border-primary-container bg-primary-container/10'
                    : 'border-outline hover:bg-surface-container-high'
                }`}
              >
                {c.logo_url ? (
                  <img src={`${API_BASE}${c.logo_url}`} alt={`Logo de ${c.banco}`} className="w-8 h-8 object-contain bg-background border border-outline shrink-0" />
                ) : (
                  <span className="inline-flex items-center justify-center w-8 h-8 bg-surface-container-high border border-outline text-on-surface-variant shrink-0">
                    <span className="material-symbols-outlined text-[18px]">account_balance</span>
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block font-['Inter'] text-[13px] font-semibold text-on-surface truncate">{c.banco}</span>
                  <span className="block font-code-sm text-[11px] text-on-surface-variant truncate">{c.numero_cuenta}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <dl className="bg-background sharp-border p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 font-code-sm text-code-sm">
        <div className="sm:col-span-2 flex items-center gap-3">
          {elegida.logo_url ? (
            <img src={`${API_BASE}${elegida.logo_url}`} alt={`Logo de ${elegida.banco}`} className="w-10 h-10 object-contain bg-surface border border-outline shrink-0" />
          ) : (
            <span className="inline-flex items-center justify-center w-10 h-10 bg-surface-container-high border border-outline text-on-surface-variant shrink-0">
              <span className="material-symbols-outlined text-[20px]">account_balance</span>
            </span>
          )}
          <span className="font-['Inter'] text-[15px] font-semibold text-on-surface">{elegida.banco}</span>
        </div>
        <div className="min-w-0">
          <dt className="text-on-surface-variant uppercase">Tipo de cuenta</dt>
          <dd className="text-on-surface break-words">{elegida.tipo_cuenta}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-on-surface-variant uppercase">Número de cuenta</dt>
          <dd className="text-on-surface break-words">{elegida.numero_cuenta}</dd>
        </div>
        {elegida.titular && (
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-on-surface-variant uppercase">Titular</dt>
            <dd className="text-on-surface break-words">{elegida.titular}</dd>
          </div>
        )}
      </dl>

      <p className="font-['Inter'] text-[12px] font-normal text-on-surface-variant">
        Puedes realizar la transferencia desde un banco diferente. En ese caso, el pago quedará pendiente hasta que el
        dinero se haga efectivo y se acredite en nuestra cuenta bancaria.
      </p>
    </div>
  );
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

  // PC-2026-01 (Fase F): cuál cuenta receptora activa eligió el cliente,
  // cuando hay más de una — independiente para anticipo y saldo (en la
  // práctica suele ser la misma, pero son dos bloques distintos de la
  // pantalla con su propia gestión de pago).
  const [cuentaElegidaAnticipo, setCuentaElegidaAnticipo] = useState(0);
  const [cuentaElegidaSaldo, setCuentaElegidaSaldo] = useState(0);

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

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-code-sm text-code-sm">
                <div className="min-w-0">
                  <dt className="text-on-surface-variant uppercase">Cantidad</dt>
                  <dd className="text-on-surface">{cotizacion.solicitud.cantidad}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-on-surface-variant uppercase">Valor</dt>
                  <dd className="text-on-surface">${cotizacion.valor}</dd>
                </div>
                {cotizacion.fecha_vigencia && (
                  <div className="min-w-0">
                    <dt className="text-on-surface-variant uppercase">Vigencia</dt>
                    <dd className="text-on-surface">{new Date(cotizacion.fecha_vigencia).toLocaleString()}</dd>
                  </div>
                )}
                {cotizacion.aceptada_en && (
                  <div className="min-w-0">
                    <dt className="text-on-surface-variant uppercase">Aceptada</dt>
                    <dd className="text-on-surface">{new Date(cotizacion.aceptada_en).toLocaleString()}</dd>
                  </div>
                )}
                {cotizacion.rechazada_en && (
                  <div className="min-w-0">
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

                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-code-sm text-code-sm">
                    <div className="min-w-0">
                      <dt className="text-on-surface-variant uppercase">Valor anticipo</dt>
                      <dd className="text-on-surface">${cotizacion.anticipo_valor}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-on-surface-variant uppercase">Saldo pendiente</dt>
                      <dd className="text-on-surface">${cotizacion.saldo_pendiente}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-on-surface-variant uppercase">Método</dt>
                      <dd className="text-on-surface">{cotizacion.metodo_anticipo}</dd>
                    </div>
                    <div className="min-w-0">
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
                      <BloqueCuentaReceptora
                        cuentas={cotizacion.cuentas_bancarias_activas}
                        datosLegacy={cotizacion.datos_bancarios}
                        indiceElegido={cuentaElegidaAnticipo}
                        onElegir={setCuentaElegidaAnticipo}
                      />

                      {cotizacion.comprobante_recibido ? (
                        <p className="font-['Inter'] text-[13px] font-normal text-primary-container uppercase">
                          Comprobante recibido. Pendiente de revisión por Comercial.
                        </p>
                      ) : (
                        <div className="bg-background sharp-border p-4 space-y-3">
                          <div>
                            <p className="font-['Inter'] text-[14px] font-semibold text-on-surface">Comprobante de transferencia</p>
                            <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant mt-1">
                              Adjunta una imagen o PDF de tu comprobante para que podamos verificar el pago.
                            </p>
                          </div>

                          <label
                            htmlFor="comprobante-anticipo"
                            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-primary-container p-6 text-center cursor-pointer hover:bg-surface-container-high focus-within:ring-2 focus-within:ring-primary-container transition-colors"
                          >
                            <span className="material-symbols-outlined text-primary-container text-[32px]" aria-hidden="true">
                              cloud_upload
                            </span>
                            <span className="font-['Inter'] text-[14px] font-semibold text-on-surface break-words">
                              {archivoComprobante ? archivoComprobante.name : 'Selecciona tu comprobante'}
                            </span>
                            <span className="font-['Inter'] text-[12px] font-normal text-on-surface-variant">
                              PDF, JPG o PNG · Máximo 5 MB
                            </span>
                            <span className="inline-flex items-center gap-1.5 px-4 py-2 mt-1 bg-primary-container text-on-primary-container font-['Inter'] text-[13px] font-semibold">
                              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                                folder_open
                              </span>
                              ELEGIR ARCHIVO
                            </span>
                            <input
                              id="comprobante-anticipo"
                              type="file"
                              accept="application/pdf,image/jpeg,image/png"
                              onChange={(e) => handleSeleccionarArchivo(e.target.files?.[0] ?? null)}
                              className="sr-only"
                            />
                          </label>

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
                          <p className="font-['Inter'] text-[12px] font-normal text-on-surface-variant text-center">
                            Primero selecciona el archivo y después pulsa «Subir comprobante».
                          </p>
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

                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-code-sm text-code-sm">
                    <div className="min-w-0">
                      <dt className="text-on-surface-variant uppercase">Saldo pendiente</dt>
                      <dd className="text-on-surface">${cotizacion.saldo_pendiente}</dd>
                    </div>
                    <div className="min-w-0">
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

                          {(cotizacion.cuentas_bancarias_activas.length > 0 || cotizacion.datos_bancarios) && (
                            <BloqueCuentaReceptora
                              cuentas={cotizacion.cuentas_bancarias_activas}
                              datosLegacy={cotizacion.datos_bancarios}
                              indiceElegido={cuentaElegidaSaldo}
                              onElegir={setCuentaElegidaSaldo}
                            />
                          )}

                          <div className="bg-background sharp-border p-4 space-y-3">
                            <div>
                              <p className="font-['Inter'] text-[14px] font-semibold text-on-surface">Comprobante de transferencia del saldo</p>
                              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant mt-1">
                                Adjunta una imagen o PDF de tu comprobante para que podamos verificar el pago.
                              </p>
                            </div>

                            <label
                              htmlFor="comprobante-saldo"
                              className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-primary-container p-6 text-center cursor-pointer hover:bg-surface-container-high focus-within:ring-2 focus-within:ring-primary-container transition-colors"
                            >
                              <span className="material-symbols-outlined text-primary-container text-[32px]" aria-hidden="true">
                                cloud_upload
                              </span>
                              <span className="font-['Inter'] text-[14px] font-semibold text-on-surface break-words">
                                {archivoComprobanteSaldo ? archivoComprobanteSaldo.name : 'Selecciona tu comprobante'}
                              </span>
                              <span className="font-['Inter'] text-[12px] font-normal text-on-surface-variant">
                                PDF, JPG o PNG · Máximo 5 MB
                              </span>
                              <span className="inline-flex items-center gap-1.5 px-4 py-2 mt-1 bg-primary-container text-on-primary-container font-['Inter'] text-[13px] font-semibold">
                                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                                  folder_open
                                </span>
                                ELEGIR ARCHIVO
                              </span>
                              <input
                                id="comprobante-saldo"
                                type="file"
                                accept="application/pdf,image/jpeg,image/png"
                                onChange={(e) => handleSeleccionarArchivoSaldo(e.target.files?.[0] ?? null)}
                                className="sr-only"
                              />
                            </label>

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
                            <p className="font-['Inter'] text-[12px] font-normal text-on-surface-variant text-center">
                              Primero selecciona el archivo y después pulsa «Subir comprobante».
                            </p>
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
