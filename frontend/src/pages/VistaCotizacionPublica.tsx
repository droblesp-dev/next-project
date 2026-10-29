import { useEffect, useState, type FormEvent } from 'react';
import { API_BASE } from '../lib/authClient';
import { claveCuentaReceptora } from '../lib/cuentasReceptoras';
import {
  etiquetaEstadoCotizacion,
  etiquetaEstadoPago,
  etiquetaMetodoPago,
  formatearFechaHora,
  formatearMoneda,
  formatearPorcentaje,
  mensajeSiguientePaso,
  textoMotivoRechazo,
  usarSelectorDeCuentas,
  validarArchivoComprobante,
} from '../lib/cotizacionPublica';
import ComprobanteUploader from './ComprobanteUploader';
import { MENSAJE_CLIENTE_COTIZACION_VENCIDA } from '../lib/caducidadCotizacion';
import PieCotizacionPublica from './PieCotizacionPublica';
import RecuperarCodigoCotizacion from './RecuperarCodigoCotizacion';
import BotonImprimirCotizacion from './HojaCotizacionImprimible';

interface VistaCotizacionPublicaProps {
  token: string;
}

interface RechazoPago {
  motivo: string | null;
  detalle: string | null;
  fecha: string;
}

interface CotizacionPublica {
  id: string;
  codigo?: string | null;
  valor: string;
  // Desglose oficial calculado por el backend; `valor` es el subtotal (sin IVA).
  subtotal: string | null;
  iva_porcentaje: string | null;
  iva_valor: string | null;
  total: string | null;
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
  // El saldo admite comprobante solo cuando el anticipo ya está confirmado o no aplica.
  saldo_habilitado: boolean;
  rechazo_anticipo: RechazoPago | null;
  rechazo_saldo: RechazoPago | null;
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
    id?: string;
    banco: string;
    titular: string | null;
    tipo_cuenta: string;
    numero_cuenta: string;
    logo_url: string | null;
  }[];
  solicitud: {
    codigo?: string | null;
    servicio: string;
    descripcion: string;
    cantidad: number;
    especificaciones: string | null;
  };
}

type CuentaBancariaPublicaFront = {
  id?: string;
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

// Importes oficiales de la cotización, tal como los calculó el backend: subtotal, IVA, total y la
// forma de pago (anticipo y saldo). Se muestra ANTES de aceptar y se conserva después, para que el
// cliente conozca las condiciones de pago y nunca vea cifras que parezcan contradecirse.
function CondicionesDePago({ c }: { c: CotizacionPublica }) {
  const hayAnticipo = c.estado_anticipo !== 'NO_APLICA' && Number(c.anticipo_valor ?? 0) > 0;
  return (
    <section className="space-y-3" aria-labelledby="titulo-condiciones">
      <h4 id="titulo-condiciones" className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase">
        VALOR Y CONDICIONES DE PAGO
      </h4>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 font-code-sm text-code-sm">
        <div className="min-w-0">
          <dt className="text-on-surface-variant uppercase">Subtotal (sin IVA)</dt>
          <dd className="text-on-surface">{formatearMoneda(c.subtotal ?? c.valor)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-on-surface-variant uppercase">IVA ({formatearPorcentaje(c.iva_porcentaje)})</dt>
          <dd className="text-on-surface">{formatearMoneda(c.iva_valor)}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2 border-t border-outline pt-3">
          <dt className="text-on-surface-variant uppercase">Total a pagar (con IVA)</dt>
          <dd className="text-on-surface text-[18px] font-semibold">{formatearMoneda(c.total)}</dd>
        </div>
        {hayAnticipo ? (
          <>
            <div className="min-w-0">
              <dt className="text-on-surface-variant uppercase">Anticipo ({formatearPorcentaje(c.anticipo_porcentaje)})</dt>
              <dd className="text-on-surface">{formatearMoneda(c.anticipo_valor)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-on-surface-variant uppercase">Método del anticipo</dt>
              <dd className="text-on-surface">{etiquetaMetodoPago(c.metodo_anticipo)}</dd>
            </div>
          </>
        ) : (
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-on-surface-variant uppercase">Anticipo</dt>
            <dd className="text-on-surface">No se requiere anticipo</dd>
          </div>
        )}
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-on-surface-variant uppercase">Saldo</dt>
          <dd className="text-on-surface">
            {formatearMoneda(c.saldo_pendiente)}
            <span className="block text-[12px] text-on-surface-variant mt-1">
              {hayAnticipo ? 'Se paga una vez confirmado el anticipo, ' : 'Se paga '}por transferencia o en efectivo (presencial).
            </span>
          </dd>
        </div>
      </dl>
      {c.fecha_vigencia && c.estado === 'ENVIADA' && (
        <p className="font-['Inter'] text-[12px] text-on-surface-variant">Cotización vigente hasta el {formatearFechaHora(c.fecha_vigencia)}.</p>
      )}
    </section>
  );
}

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
  idSelector,
  cuentas,
  datosLegacy,
  indiceElegido,
  onElegir,
}: {
  idSelector: string;
  cuentas: CuentaBancariaPublicaFront[];
  datosLegacy: DatosBancariosLegacy | null;
  indiceElegido: number;
  onElegir: (indice: number) => void;
}) {
  if (cuentas.length === 0) {
    if (!datosLegacy) {
      return (
        <p className="font-['Inter'] text-[13px] font-normal text-error">
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
      {cuentas.length > 1 && usarSelectorDeCuentas(cuentas.length) && (
        // Con muchas cuentas, un desplegable evita una pantalla interminable.
        <div className="space-y-2">
          <label htmlFor={idSelector} className="block font-code-sm text-[11px] text-on-surface-variant uppercase">
            Elija la cuenta a la que transferirá
          </label>
          <select
            id={idSelector}
            value={indiceSeguro}
            onChange={(e) => onElegir(Number(e.target.value))}
            className="w-full bg-background border border-outline text-on-surface px-3 py-2 font-['Inter'] text-[13px] focus:outline-none focus:ring-2 focus:ring-primary-container"
          >
            {cuentas.map((c, i) => (
              <option key={claveCuentaReceptora(c, i)} value={i}>
                {c.banco} · {c.tipo_cuenta} · {c.numero_cuenta}
              </option>
            ))}
          </select>
        </div>
      )}

      {cuentas.length > 1 && !usarSelectorDeCuentas(cuentas.length) && (
        <div className="space-y-2">
          <p className="font-code-sm text-[11px] text-on-surface-variant uppercase">Elija la cuenta a la que transferirá</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {cuentas.map((c, i) => (
              <button
                key={claveCuentaReceptora(c, i)}
                type="button"
                aria-pressed={i === indiceSeguro}
                onClick={() => onElegir(i)}
                className={`flex items-center gap-2 p-3 text-left border transition-colors cursor-pointer min-w-0 ${
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

// Aviso de un comprobante rechazado: el motivo registrado por Comercial y qué hacer.
function AvisoRechazo({ concepto, rechazo }: { concepto: 'anticipo' | 'saldo'; rechazo: RechazoPago | null }) {
  return (
    <div role="alert" className="border border-error p-3 space-y-1">
      <p className="font-['Inter'] text-[13px] font-semibold text-error">El comprobante de tu {concepto} fue rechazado.</p>
      <p className="font-['Inter'] text-[13px] text-on-surface break-words">
        <span className="font-semibold">Motivo: </span>
        {textoMotivoRechazo(rechazo?.motivo, rechazo?.detalle)}
      </p>
      <p className="font-['Inter'] text-[12px] text-on-surface-variant">
        Corrige el comprobante y vuelve a subirlo aquí abajo. Tu comprobante anterior queda registrado.
      </p>
    </div>
  );
}

type Accion = 'aceptar' | 'rechazar';

// Sin login, sin JWT de cliente, sin sesión: la única "identidad" de esta
// vista es el token de la URL. El código nunca se guarda (ni siquiera en
// memoria más allá del input controlado) — no se persiste en
// localStorage/sessionStorage bajo ninguna circunstancia.
type Paso = 'cargando_enlace' | 'codigo' | 'verificando' | 'cotizacion' | 'error_enlace';

export default function VistaCotizacionPublica({ token }: VistaCotizacionPublicaProps) {
  const [paso, setPaso] = useState<Paso>('cargando_enlace');
  const [errorEnlace, setErrorEnlace] = useState<string | null>(null);
  const [reintentoEnlace, setReintentoEnlace] = useState(0);
  const [codigoInput, setCodigoInput] = useState('');
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [cotizacion, setCotizacion] = useState<CotizacionPublica | null>(null);
  const [accionConfirmando, setAccionConfirmando] = useState<Accion | null>(null);
  const [accionEnCurso, setAccionEnCurso] = useState(false);
  const [accionError, setAccionError] = useState<string | null>(null);
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

        if (response.status === 410) {
          setErrorEnlace(MENSAJE_CLIENTE_COTIZACION_VENCIDA);
          setPaso('error_enlace');
          return;
        }
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
  }, [token, reintentoEnlace]);

  // Reintentar solo tiene sentido ante un fallo de conexión o del servidor, no ante un enlace inválido.
  const errorEnlaceReintentable = errorEnlace !== null && /conectar|más tarde/.test(errorEnlace);

  function handleReintentarEnlace() {
    setErrorEnlace(null);
    setPaso('cargando_enlace');
    setReintentoEnlace((n) => n + 1);
  }

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
      if (response.status === 410) {
        setErrorEnlace(MENSAJE_CLIENTE_COTIZACION_VENCIDA);
        setPaso('error_enlace');
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
          410: MENSAJE_CLIENTE_COTIZACION_VENCIDA,
          409: data?.message || 'Esta cotización ya no admite esta acción.',
          429: data?.message || 'Demasiados intentos. Espere unos minutos antes de volver a intentar.',
        };
        setAccionError(mensajes[response.status] || 'No se pudo completar la acción en este momento. Intente nuevamente.');
        setAccionConfirmando(null);
        return;
      }

      setCotizacion(data.cotizacion as CotizacionPublica);
      setAccionConfirmando(null);
    } catch {
      setAccionError('No se pudo conectar con el servidor. Verifique su conexión e intente nuevamente.');
      setAccionConfirmando(null);
    } finally {
      setAccionEnCurso(false);
    }
  }

  // Selección de archivo: el frontend solo da feedback inmediato; la validación real (contenido real
  // del archivo y límite de tamaño) ocurre en el servidor.
  function seleccionarArchivo(
    archivo: File | null,
    setArchivo: (f: File | null) => void,
    setError: (e: string | null) => void
  ) {
    setError(null);
    if (!archivo) {
      setArchivo(null);
      return;
    }
    const error = validarArchivoComprobante(archivo);
    if (error) {
      setError(error);
      setArchivo(null);
      return;
    }
    setArchivo(archivo);
  }

  // Fase D.6: multipart/form-data con el código de acceso + el archivo. Nunca se envía el archivo sin
  // el código. Si falla la conexión el archivo sigue seleccionado para reintentar; el servidor no
  // duplica la carga (rechaza con 409 un comprobante ya recibido).
  async function subirComprobante(
    ruta: 'comprobante' | 'comprobante-saldo',
    archivo: File | null,
    setSubiendo: (s: boolean) => void,
    setError: (e: string | null) => void,
    limpiarArchivo: () => void
  ) {
    if (!archivo) return;

    setSubiendo(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('codigo', codigoInput);
      formData.append('archivo', archivo);
      // QA-08: la cuenta que el cliente eligió en pantalla viaja como dato informativo (la real la confirma COMERCIAL).
      const indiceCuenta = ruta === 'comprobante' ? cuentaElegidaAnticipo : cuentaElegidaSaldo;
      const cuentaElegida = cotizacion?.cuentas_bancarias_activas?.[indiceCuenta];
      if (cuentaElegida?.id) formData.append('cuentaBancariaId', cuentaElegida.id);

      const response = await fetch(`${API_BASE}/api/cotizaciones/publica/${encodeURIComponent(token)}/${ruta}`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.message || 'No se pudo subir el comprobante. Intente nuevamente.');
        return;
      }

      setCotizacion(data.cotizacion as CotizacionPublica);
      limpiarArchivo();
    } catch {
      setError('No se pudo conectar con el servidor. Verifique su conexión e intente nuevamente.');
    } finally {
      setSubiendo(false);
    }
  }

  const bloqueCuentas = (idSelector: string, indice: number, onElegir: (i: number) => void) =>
    cotizacion && (
      <BloqueCuentaReceptora
        idSelector={idSelector}
        cuentas={cotizacion.cuentas_bancarias_activas}
        datosLegacy={cotizacion.datos_bancarios}
        indiceElegido={indice}
        onElegir={onElegir}
      />
    );

  return (
    <div className="bg-background text-on-surface font-body-md antialiased min-h-screen flex items-center justify-center px-margin-mobile py-12">
      <div className="w-full max-w-lg min-w-0">
        <a href="/" className="font-headline-lg text-headline-lg-mobile font-black text-on-surface uppercase tracking-tighter flex items-center justify-center mb-1">
          <span>NEXT</span>
          <span className="text-primary-container">PROJECT</span>
        </a>
        <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-8 text-center">
          COTIZACIÓN
        </h3>

        <div className="bg-surface sharp-border p-6 md:p-8">
          {paso === 'cargando_enlace' && (
            <p role="status" className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase text-center py-8">
              VALIDANDO ENLACE...
            </p>
          )}

          {paso === 'error_enlace' && (
            <div className="text-center py-6 space-y-3" role="alert">
              <span className="material-symbols-outlined text-4xl text-error" aria-hidden="true">link_off</span>
              <p className="font-body-md text-body-md text-on-surface">{errorEnlace}</p>
              {errorEnlaceReintentable && (
                <button
                  type="button"
                  onClick={handleReintentarEnlace}
                  className="inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors cursor-pointer"
                >
                  REINTENTAR
                </button>
              )}
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
                  <label
                    htmlFor="codigo-acceso"
                    className="block font-['Inter'] text-[13px] font-semibold text-on-surface-variant uppercase mb-2"
                  >
                    CÓDIGO DE ACCESO
                  </label>
                  <input
                    id="codigo-acceso"
                    value={codigoInput}
                    onChange={(e) => setCodigoInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    aria-invalid={errorCodigo ? true : undefined}
                    aria-describedby={errorCodigo ? 'error-codigo' : undefined}
                    className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-headline-md text-headline-md tracking-[0.4em] text-center outline-none"
                    placeholder="000000"
                  />
                </div>

                {errorCodigo && (
                  <p id="error-codigo" role="alert" className="font-['Inter'] text-[13px] font-normal text-error">
                    {errorCodigo}
                  </p>
                )}

                <button
                  disabled={paso === 'verificando' || codigoInput.length !== 6}
                  type="submit"
                  className="w-full inline-flex items-center justify-center px-6 py-4 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {paso === 'verificando' ? 'VERIFICANDO...' : 'VER COTIZACIÓN'}
                </button>
              </form>

              <RecuperarCodigoCotizacion token={token} />
            </>
          )}

          {paso === 'cotizacion' && cotizacion && (
            <div className="space-y-5">
              <div className="flex justify-between items-start gap-4 border-b border-outline pb-4">
                <div className="min-w-0">
                  <h3 className="font-headline-md text-headline-md text-on-surface uppercase break-words">
                    {cotizacion.solicitud.servicio}
                  </h3>
                  {(cotizacion.codigo || cotizacion.solicitud.codigo) && (
                    <p className="font-code-sm text-code-sm text-on-surface-variant mt-1">
                      {[cotizacion.codigo, cotizacion.solicitud.codigo].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
                <span className="font-code-sm text-code-sm text-primary-container shrink-0 text-right">
                  {etiquetaEstadoCotizacion(cotizacion.estado)}
                </span>
              </div>

              {/* Estado actual y siguiente paso: se recalcula con cada respuesta del servidor. */}
              <p role="status" aria-live="polite" className="font-['Inter'] text-[13px] font-semibold text-primary-container border-l-2 border-primary-container pl-3">
                {mensajeSiguientePaso(cotizacion)}
              </p>

              <p className="font-body-md text-body-md text-on-surface-variant">{cotizacion.solicitud.descripcion}</p>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-code-sm text-code-sm">
                <div className="min-w-0">
                  <dt className="text-on-surface-variant uppercase">Cantidad</dt>
                  <dd className="text-on-surface">{cotizacion.solicitud.cantidad}</dd>
                </div>
                {cotizacion.aceptada_en && (
                  <div className="min-w-0">
                    <dt className="text-on-surface-variant uppercase">Aceptada</dt>
                    <dd className="text-on-surface">{formatearFechaHora(cotizacion.aceptada_en)}</dd>
                  </div>
                )}
                {cotizacion.rechazada_en && (
                  <div className="min-w-0">
                    <dt className="text-on-surface-variant uppercase">Rechazada</dt>
                    <dd className="text-on-surface">{formatearFechaHora(cotizacion.rechazada_en)}</dd>
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

              <div className="border-t border-outline pt-4">
                <CondicionesDePago c={cotizacion} />
              </div>

              {/* #4: el cliente puede imprimir su cotización o guardarla como PDF (sin datos de acceso ni bancarios). */}
              <div className="border-t border-outline pt-4">
                <BotonImprimirCotizacion
                  datos={{
                    codigoCotizacion: cotizacion.codigo ?? null,
                    codigoSolicitud: cotizacion.solicitud.codigo ?? null,
                    estado: cotizacion.estado,
                    estadoEtiqueta: etiquetaEstadoCotizacion(cotizacion.estado),
                    emitidaEn: cotizacion.creado_en,
                    vigenciaHasta: cotizacion.fecha_vigencia,
                    servicio: cotizacion.solicitud.servicio,
                    cantidad: cotizacion.solicitud.cantidad,
                    descripcionSolicitud: cotizacion.solicitud.descripcion,
                    especificaciones: cotizacion.solicitud.especificaciones,
                    observaciones: cotizacion.descripcion,
                    subtotal: cotizacion.subtotal ?? cotizacion.valor,
                    ivaPorcentaje: cotizacion.iva_porcentaje,
                    ivaValor: cotizacion.iva_valor,
                    total: cotizacion.total,
                    anticipoPorcentaje: cotizacion.anticipo_porcentaje,
                    anticipoValor: cotizacion.anticipo_valor,
                    estadoAnticipo: cotizacion.estado_anticipo,
                    metodoAnticipo: cotizacion.metodo_anticipo,
                    saldo: cotizacion.saldo_pendiente,
                  }}
                />
              </div>

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
                    <p role="alert" className="font-['Inter'] text-[13px] font-normal text-error">{accionError}</p>
                  )}
                </div>
              )}

              {cotizacion.estado === 'ACEPTADA' && cotizacion.estado_anticipo && cotizacion.estado_anticipo !== 'NO_APLICA' && (
                <div className="border-t border-outline pt-4 space-y-4">
                  <h4 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase">
                    ANTICIPO
                  </h4>

                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-code-sm text-code-sm">
                    <div className="min-w-0">
                      <dt className="text-on-surface-variant uppercase">Valor anticipo</dt>
                      <dd className="text-on-surface">{formatearMoneda(cotizacion.anticipo_valor)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-on-surface-variant uppercase">Método</dt>
                      <dd className="text-on-surface">{etiquetaMetodoPago(cotizacion.metodo_anticipo)}</dd>
                    </div>
                    <div className="min-w-0 sm:col-span-2">
                      <dt className="text-on-surface-variant uppercase">Estado</dt>
                      <dd className="text-on-surface">{etiquetaEstadoPago(cotizacion.estado_anticipo)}</dd>
                    </div>
                  </dl>

                  {cotizacion.estado_anticipo === 'VALIDADO' && (
                    <p className="font-['Inter'] text-[13px] font-normal text-primary-container">
                      Confirmamos el pago de tu anticipo.
                    </p>
                  )}

                  {cotizacion.estado_anticipo === 'RECHAZADO' && (
                    <div className="space-y-4">
                      <AvisoRechazo concepto="anticipo" rechazo={cotizacion.rechazo_anticipo} />
                      {bloqueCuentas('cuenta-anticipo', cuentaElegidaAnticipo, setCuentaElegidaAnticipo)}
                      <ComprobanteUploader
                        id="comprobante-anticipo"
                        titulo="Nuevo comprobante del anticipo"
                        descripcion="Adjunta una imagen o PDF correcto de tu transferencia."
                        archivo={archivoComprobante}
                        error={errorArchivo}
                        subiendo={subiendoComprobante}
                        onSeleccionar={(f) => seleccionarArchivo(f, setArchivoComprobante, setErrorArchivo)}
                        onSubir={() =>
                          subirComprobante('comprobante', archivoComprobante, setSubiendoComprobante, setErrorArchivo, () =>
                            setArchivoComprobante(null)
                          )
                        }
                      />
                    </div>
                  )}

                  {cotizacion.estado_anticipo === 'PENDIENTE' && cotizacion.metodo_anticipo === 'EFECTIVO' && (
                    <p className="font-body-md text-body-md text-on-surface">
                      Realice el pago del anticipo de forma presencial en el Centro de Mecanizado Industrial.
                    </p>
                  )}

                  {cotizacion.estado_anticipo === 'PENDIENTE' && cotizacion.metodo_anticipo === 'TRANSFERENCIA' && (
                    <div className="space-y-4">
                      {bloqueCuentas('cuenta-anticipo', cuentaElegidaAnticipo, setCuentaElegidaAnticipo)}

                      {cotizacion.comprobante_recibido ? (
                        <p className="font-['Inter'] text-[13px] font-normal text-primary-container">
                          Comprobante recibido. Está en revisión; el pago aún no se ha acreditado.
                        </p>
                      ) : (
                        <ComprobanteUploader
                          id="comprobante-anticipo"
                          titulo="Comprobante de transferencia"
                          descripcion="Adjunta una imagen o PDF de tu comprobante para que podamos verificar el pago."
                          archivo={archivoComprobante}
                          error={errorArchivo}
                          subiendo={subiendoComprobante}
                          onSeleccionar={(f) => seleccionarArchivo(f, setArchivoComprobante, setErrorArchivo)}
                          onSubir={() =>
                            subirComprobante('comprobante', archivoComprobante, setSubiendoComprobante, setErrorArchivo, () =>
                              setArchivoComprobante(null)
                            )
                          }
                        />
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
                      <dd className="text-on-surface">{formatearMoneda(cotizacion.saldo_pendiente)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-on-surface-variant uppercase">Estado</dt>
                      <dd className="text-on-surface">{etiquetaEstadoPago(cotizacion.estado_saldo)}</dd>
                    </div>
                  </dl>

                  {cotizacion.estado_saldo === 'VALIDADO' && (
                    <p className="font-['Inter'] text-[13px] font-normal text-primary-container">
                      Confirmamos el pago de tu saldo.
                    </p>
                  )}

                  {cotizacion.estado_saldo !== 'VALIDADO' && !cotizacion.saldo_habilitado && (
                    // Regla QA-04: el saldo se paga una vez que el anticipo fue confirmado. El backend la
                    // aplica por su cuenta; aquí solo se explica al cliente.
                    <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant border border-outline p-3">
                      Podrás subir el comprobante del saldo cuando tu anticipo esté confirmado.
                    </p>
                  )}

                  {cotizacion.estado_saldo === 'RECHAZADO' && cotizacion.saldo_habilitado && (
                    <div className="space-y-4">
                      <AvisoRechazo concepto="saldo" rechazo={cotizacion.rechazo_saldo} />
                      {bloqueCuentas('cuenta-saldo', cuentaElegidaSaldo, setCuentaElegidaSaldo)}
                      <ComprobanteUploader
                        id="comprobante-saldo"
                        titulo="Nuevo comprobante del saldo"
                        descripcion="Adjunta una imagen o PDF correcto de tu transferencia."
                        archivo={archivoComprobanteSaldo}
                        error={errorArchivoSaldo}
                        subiendo={subiendoComprobanteSaldo}
                        onSeleccionar={(f) => seleccionarArchivo(f, setArchivoComprobanteSaldo, setErrorArchivoSaldo)}
                        onSubir={() =>
                          subirComprobante(
                            'comprobante-saldo',
                            archivoComprobanteSaldo,
                            setSubiendoComprobanteSaldo,
                            setErrorArchivoSaldo,
                            () => setArchivoComprobanteSaldo(null)
                          )
                        }
                      />
                    </div>
                  )}

                  {cotizacion.estado_saldo === 'PENDIENTE' && cotizacion.saldo_habilitado && (
                    <div className="space-y-4">
                      {cotizacion.saldo_comprobante_recibido ? (
                        <p className="font-['Inter'] text-[13px] font-normal text-primary-container">
                          Comprobante recibido. Está en revisión; el pago aún no se ha acreditado.
                        </p>
                      ) : (
                        <>
                          <p className="font-body-md text-body-md text-on-surface">
                            Puede pagar el saldo por transferencia (subiendo el comprobante a continuación) o de
                            forma presencial en efectivo en el Centro de Mecanizado Industrial.
                          </p>

                          {(cotizacion.cuentas_bancarias_activas.length > 0 || cotizacion.datos_bancarios) &&
                            bloqueCuentas('cuenta-saldo', cuentaElegidaSaldo, setCuentaElegidaSaldo)}

                          <ComprobanteUploader
                            id="comprobante-saldo"
                            titulo="Comprobante de transferencia del saldo"
                            descripcion="Adjunta una imagen o PDF de tu comprobante para que podamos verificar el pago."
                            archivo={archivoComprobanteSaldo}
                            error={errorArchivoSaldo}
                            subiendo={subiendoComprobanteSaldo}
                            onSeleccionar={(f) => seleccionarArchivo(f, setArchivoComprobanteSaldo, setErrorArchivoSaldo)}
                            onSubir={() =>
                              subirComprobante(
                                'comprobante-saldo',
                                archivoComprobanteSaldo,
                                setSubiendoComprobanteSaldo,
                                setErrorArchivoSaldo,
                                () => setArchivoComprobanteSaldo(null)
                              )
                            }
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {paso === 'cotizacion' && cotizacion && <PieCotizacionPublica codigoCotizacion={cotizacion.codigo ?? null} />}
        </div>
      </div>
    </div>
  );
}
