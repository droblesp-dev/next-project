import { useEffect, useState, type FormEvent } from 'react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';

export interface Cotizacion {
  id: string;
  solicitud_id: string;
  valor: string;
  estado: string;
  descripcion: string | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
  fecha_vigencia: string | null;
  subtotal: string | null;
  iva_porcentaje: string | null;
  iva_valor: string | null;
  total: string | null;
  anticipo_porcentaje: string | null;
  anticipo_valor: string | null;
  saldo_pendiente: string | null;
  metodo_anticipo: string | null;
  estado_anticipo: string | null;
  anticipo_confirmado_en: string | null;
  comprobante_recibido: boolean;
  metodo_saldo: string | null;
  estado_saldo: string;
  saldo_confirmado_en: string | null;
  saldo_comprobante_recibido: boolean;
}

interface GestionCotizacionesProps {
  token: string;
  onSesionInvalida: () => void;
}

// Guía de UX únicamente (igual que en DetalleSolicitud.tsx): debe coincidir
// con TRANSICIONES en backend/src/services/cotizaciones.service.ts. El
// backend sigue siendo la única autoridad real sobre qué transición se
// acepta.
// Fase D.4: ACEPTADA/RECHAZADA ya no son transiciones internas — el
// cliente decide desde el enlace público (D.5). Comercial ya no ve esos
// botones para una cotización ENVIADA.
const TRANSICIONES: Record<string, string[]> = {
  BORRADOR: ['ENVIADA', 'CANCELADA'],
  ENVIADA: ['VENCIDA', 'CANCELADA'],
  ACEPTADA: [],
  RECHAZADA: [],
  VENCIDA: [],
  CANCELADA: [],
};

export default function GestionCotizaciones({ token, onSesionInvalida }: GestionCotizacionesProps) {
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[] | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [solicitudIdNueva, setSolicitudIdNueva] = useState('');
  const [valorNuevo, setValorNuevo] = useState('');
  const [descripcionNueva, setDescripcionNueva] = useState('');
  // Fase D.8: valores por defecto iguales a los que ya usa el backend
  // (crearCotizacion() en cotizaciones.service.ts) cuando estos campos no
  // se envían — se muestran explícitos aquí solo para que Comercial los
  // vea y pueda cambiarlos, el cálculo real sigue siendo exclusivo del
  // backend (subtotal/iva_valor/total/anticipo_valor/saldo_pendiente).
  const [ivaPorcentajeNuevo, setIvaPorcentajeNuevo] = useState('15');
  const [anticipoPorcentajeNuevo, setAnticipoPorcentajeNuevo] = useState('50');
  const [metodoAnticipoNuevo, setMetodoAnticipoNuevo] = useState('TRANSFERENCIA');
  const [diasVigenciaNuevo, setDiasVigenciaNuevo] = useState('15');
  const [creando, setCreando] = useState(false);
  const [mensajeCrear, setMensajeCrear] = useState<string | null>(null);

  const [cotizacionSeleccionada, setCotizacionSeleccionada] = useState<Cotizacion | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [mensajeCambio, setMensajeCambio] = useState<string | null>(null);

  const [gestionandoAnticipo, setGestionandoAnticipo] = useState(false);
  const [mensajeAnticipo, setMensajeAnticipo] = useState<string | null>(null);
  const [descargandoComprobante, setDescargandoComprobante] = useState(false);

  const [gestionandoSaldo, setGestionandoSaldo] = useState(false);
  const [mensajeSaldo, setMensajeSaldo] = useState<string | null>(null);
  const [descargandoComprobanteSaldo, setDescargandoComprobanteSaldo] = useState(false);
  const [metodoSaldoElegido, setMetodoSaldoElegido] = useState('EFECTIVO');

  async function cargar() {
    setLoadingLista(true);
    setErrorLista(null);

    try {
      const response = await fetchAutenticado('/api/cotizaciones', token);

      if (response.status === 403) {
        setErrorLista('No autorizado para consultar cotizaciones.');
        return;
      }
      if (!response.ok) {
        setErrorLista('No se pudo cargar el listado de cotizaciones.');
        return;
      }

      const data = (await response.json()) as { cotizaciones: Cotizacion[] };
      setCotizaciones(data.cotizaciones);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorLista('No se pudo cargar el listado de cotizaciones.');
    } finally {
      setLoadingLista(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleCrear(e: FormEvent) {
    e.preventDefault();
    setMensajeCrear(null);
    setCreando(true);

    try {
      const anticipoPorcentajeNum = Number(anticipoPorcentajeNuevo);
      const body: Record<string, unknown> = {
        solicitud_id: solicitudIdNueva.trim(),
        valor: Number(valorNuevo),
        descripcion: descripcionNueva.trim() || undefined,
        iva_porcentaje: Number(ivaPorcentajeNuevo),
        anticipo_porcentaje: anticipoPorcentajeNum,
        dias_vigencia: Number(diasVigenciaNuevo),
      };
      // Regla existente del backend (D.2): metodo_anticipo es obligatorio
      // si anticipo>0 y NO debe enviarse si anticipo=0. No se incluye la
      // clave en absoluto en ese segundo caso (en vez de enviar null),
      // para que coincida exactamente con lo que ya validaba el backend.
      if (anticipoPorcentajeNum > 0) {
        body.metodo_anticipo = metodoAnticipoNuevo;
      }

      const response = await fetchAutenticado('/api/cotizaciones', token, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeCrear(data?.message || 'No se pudo crear la cotización.');
        return;
      }

      // Los valores mostrados (subtotal/IVA/total/anticipo/saldo) son
      // exactamente los que devuelve el backend — el frontend no repite
      // ningún cálculo.
      const creada = data.cotizacion as Cotizacion;
      setMensajeCrear(
        `Cotización creada correctamente. Subtotal: ${creada.subtotal} · IVA (${creada.iva_porcentaje}%): ${creada.iva_valor} · Total: ${creada.total}` +
          (creada.estado_anticipo !== 'NO_APLICA' ? ` · Anticipo: ${creada.anticipo_valor} · Saldo: ${creada.saldo_pendiente}` : '')
      );
      setSolicitudIdNueva('');
      setValorNuevo('');
      setDescripcionNueva('');
      setIvaPorcentajeNuevo('15');
      setAnticipoPorcentajeNuevo('50');
      setMetodoAnticipoNuevo('TRANSFERENCIA');
      setDiasVigenciaNuevo('15');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeCrear('No se pudo crear la cotización.');
    } finally {
      setCreando(false);
    }
  }

  async function abrirDetalle(id: string) {
    setMensajeCambio(null);
    try {
      const response = await fetchAutenticado(`/api/cotizaciones/${id}`, token);
      if (!response.ok) return;
      const data = (await response.json()) as { cotizacion: Cotizacion };
      setCotizacionSeleccionada(data.cotizacion);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  async function handleCambiarEstado(nuevoEstado: string) {
    if (!cotizacionSeleccionada) return;
    setCambiando(true);
    setMensajeCambio(null);

    try {
      const response = await fetchAutenticado(`/api/cotizaciones/${cotizacionSeleccionada.id}/estado`, token, {
        method: 'PATCH',
        body: JSON.stringify({ estado: nuevoEstado }),
      });

      const data = await response.json().catch(() => null);

      if (response.status === 409) {
        setMensajeCambio(data?.message || 'Conflicto al cambiar el estado.');
        await abrirDetalle(cotizacionSeleccionada.id);
        await cargar();
        return;
      }
      if (!response.ok) {
        setMensajeCambio(data?.message || 'No se pudo cambiar el estado.');
        return;
      }

      setCotizacionSeleccionada(data.cotizacion as Cotizacion);
      setMensajeCambio('Estado actualizado correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeCambio('No se pudo cambiar el estado.');
    } finally {
      setCambiando(false);
    }
  }

  // Fase D.6: exclusivo de ADMIN/COMERCIAL — el backend rechaza esta
  // acción para cualquier solicitante sin JWT interno válido, sin
  // importar si conoce el enlace/código público de la cotización.
  async function handleGestionarAnticipo(accion: 'VALIDAR' | 'RECHAZAR') {
    if (!cotizacionSeleccionada) return;
    setGestionandoAnticipo(true);
    setMensajeAnticipo(null);

    try {
      const response = await fetchAutenticado(`/api/cotizaciones/${cotizacionSeleccionada.id}/anticipo`, token, {
        method: 'PATCH',
        body: JSON.stringify({ accion }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeAnticipo(data?.message || 'No se pudo gestionar el anticipo.');
        return;
      }

      setCotizacionSeleccionada(data.cotizacion as Cotizacion);
      setMensajeAnticipo(accion === 'VALIDAR' ? 'Anticipo confirmado correctamente.' : 'Anticipo rechazado correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeAnticipo('No se pudo gestionar el anticipo.');
    } finally {
      setGestionandoAnticipo(false);
    }
  }

  // La ruta de descarga está protegida (requireAuth+requireRole): se pide
  // como blob autenticado, nunca como enlace directo, y el nombre real
  // del archivo nunca llega al frontend — solo el navegador local lo ve
  // al guardarlo.
  async function handleDescargarComprobante() {
    if (!cotizacionSeleccionada) return;
    setDescargandoComprobante(true);

    try {
      const response = await fetchAutenticado(`/api/cotizaciones/${cotizacionSeleccionada.id}/comprobante`, token);
      if (!response.ok) {
        setMensajeAnticipo('No se pudo descargar el comprobante.');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = `comprobante-${cotizacionSeleccionada.id}`;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeAnticipo('No se pudo descargar el comprobante.');
    } finally {
      setDescargandoComprobante(false);
    }
  }

  // Bloque saldo/entrega/cierre. `metodo` solo se envía cuando la
  // cotización todavía no tiene un método de saldo fijado (caso EFECTIVO,
  // que nunca pasa por la subida pública de comprobante) — si ya viene
  // fijado (TRANSFERENCIA, por un comprobante ya subido), se omite.
  async function handleGestionarSaldo(accion: 'VALIDAR' | 'RECHAZAR') {
    if (!cotizacionSeleccionada) return;
    setGestionandoSaldo(true);
    setMensajeSaldo(null);

    try {
      const body: Record<string, unknown> = { accion };
      if (accion === 'VALIDAR' && !cotizacionSeleccionada.metodo_saldo) {
        body.metodo = metodoSaldoElegido;
      }

      const response = await fetchAutenticado(`/api/cotizaciones/${cotizacionSeleccionada.id}/saldo`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeSaldo(data?.message || 'No se pudo gestionar el saldo.');
        return;
      }

      setCotizacionSeleccionada(data.cotizacion as Cotizacion);
      setMensajeSaldo(accion === 'VALIDAR' ? 'Saldo confirmado correctamente.' : 'Saldo rechazado correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeSaldo('No se pudo gestionar el saldo.');
    } finally {
      setGestionandoSaldo(false);
    }
  }

  // H-E (auditoría post-V9): acción explícita y separada — no reutiliza
  // handleGestionarSaldo con una tercera acción.
  async function handleReabrirSaldo() {
    if (!cotizacionSeleccionada) return;
    setGestionandoSaldo(true);
    setMensajeSaldo(null);

    try {
      const response = await fetchAutenticado(`/api/cotizaciones/${cotizacionSeleccionada.id}/saldo/reabrir`, token, {
        method: 'PATCH',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeSaldo(data?.message || 'No se pudo reabrir el saldo.');
        return;
      }

      setCotizacionSeleccionada(data.cotizacion as Cotizacion);
      setMensajeSaldo('Saldo reabierto correctamente. Puede gestionarse nuevamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeSaldo('No se pudo reabrir el saldo.');
    } finally {
      setGestionandoSaldo(false);
    }
  }

  async function handleDescargarComprobanteSaldo() {
    if (!cotizacionSeleccionada) return;
    setDescargandoComprobanteSaldo(true);

    try {
      const response = await fetchAutenticado(`/api/cotizaciones/${cotizacionSeleccionada.id}/comprobante-saldo`, token);
      if (!response.ok) {
        setMensajeSaldo('No se pudo descargar el comprobante.');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = `comprobante-saldo-${cotizacionSeleccionada.id}`;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeSaldo('No se pudo descargar el comprobante.');
    } finally {
      setDescargandoComprobanteSaldo(false);
    }
  }

  if (cotizacionSeleccionada) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setCotizacionSeleccionada(null);
            setMensajeCambio(null);
          }}
          className="mb-6 inline-flex items-center font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL LISTADO
        </button>

        <div className="bg-surface sharp-border p-6 space-y-4">
          <div className="flex justify-between items-start border-b border-outline pb-4">
            <h3 className="font-headline-md text-headline-md text-on-surface uppercase">
              COTIZACIÓN — {cotizacionSeleccionada.valor}
            </h3>
            <span className="font-code-sm text-code-sm text-primary-container uppercase">
              {cotizacionSeleccionada.estado}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
            <div>
              <dt className="text-on-surface-variant uppercase">Solicitud</dt>
              <dd className="text-on-surface break-all">{cotizacionSeleccionada.solicitud_id}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Valor</dt>
              <dd className="text-on-surface">{cotizacionSeleccionada.valor}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">IVA ({cotizacionSeleccionada.iva_porcentaje}%)</dt>
              <dd className="text-on-surface">{cotizacionSeleccionada.iva_valor}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant uppercase">Total</dt>
              <dd className="text-on-surface">{cotizacionSeleccionada.total}</dd>
            </div>
            {cotizacionSeleccionada.fecha_vigencia && (
              <div>
                <dt className="text-on-surface-variant uppercase">Vigencia</dt>
                <dd className="text-on-surface">{new Date(cotizacionSeleccionada.fecha_vigencia).toLocaleString()}</dd>
              </div>
            )}
          </dl>

          {cotizacionSeleccionada.descripcion && (
            <div>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-1">Descripción</p>
              <p className="font-body-md text-body-md text-on-surface">{cotizacionSeleccionada.descripcion}</p>
            </div>
          )}

          <div className="border-t border-outline pt-4">
            <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Cambiar estado</p>
            <div className="flex flex-wrap gap-3">
              {(TRANSICIONES[cotizacionSeleccionada.estado] ?? []).map((destino) => (
                <button
                  key={destino}
                  type="button"
                  disabled={cambiando}
                  onClick={() => handleCambiarEstado(destino)}
                  className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                >
                  {destino}
                </button>
              ))}
              {(TRANSICIONES[cotizacionSeleccionada.estado] ?? []).length === 0 && (
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">
                  Este estado no admite más transiciones.
                </p>
              )}
            </div>
            {mensajeCambio && (
              <p className="font-code-sm text-xs text-on-surface-variant uppercase mt-3">{mensajeCambio}</p>
            )}
          </div>

          {cotizacionSeleccionada.estado === 'ACEPTADA' &&
            cotizacionSeleccionada.estado_anticipo &&
            cotizacionSeleccionada.estado_anticipo !== 'NO_APLICA' && (
              <div className="border-t border-outline pt-4 space-y-3">
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-1">Anticipo</p>
                <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
                  <div>
                    <dt className="text-on-surface-variant uppercase">Método</dt>
                    <dd className="text-on-surface">{cotizacionSeleccionada.metodo_anticipo}</dd>
                  </div>
                  <div>
                    <dt className="text-on-surface-variant uppercase">Valor</dt>
                    <dd className="text-on-surface">{cotizacionSeleccionada.anticipo_valor}</dd>
                  </div>
                  <div>
                    <dt className="text-on-surface-variant uppercase">Saldo pendiente</dt>
                    <dd className="text-on-surface">{cotizacionSeleccionada.saldo_pendiente}</dd>
                  </div>
                  <div>
                    <dt className="text-on-surface-variant uppercase">Estado del anticipo</dt>
                    <dd className="text-on-surface">{cotizacionSeleccionada.estado_anticipo}</dd>
                  </div>
                </dl>

                {cotizacionSeleccionada.comprobante_recibido && (
                  <button
                    type="button"
                    disabled={descargandoComprobante}
                    onClick={handleDescargarComprobante}
                    className="inline-flex items-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                  >
                    {descargandoComprobante ? 'DESCARGANDO...' : 'DESCARGAR COMPROBANTE'}
                  </button>
                )}

                {cotizacionSeleccionada.estado_anticipo === 'PENDIENTE' && (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={gestionandoAnticipo}
                      onClick={() => handleGestionarAnticipo('VALIDAR')}
                      className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                    >
                      VALIDAR ANTICIPO
                    </button>
                    <button
                      type="button"
                      disabled={gestionandoAnticipo}
                      onClick={() => handleGestionarAnticipo('RECHAZAR')}
                      className="inline-flex items-center px-4 py-2 border border-error text-error hover:bg-error hover:text-on-error transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                    >
                      RECHAZAR ANTICIPO
                    </button>
                  </div>
                )}

                {mensajeAnticipo && (
                  <p className="font-code-sm text-xs text-on-surface-variant uppercase">{mensajeAnticipo}</p>
                )}
              </div>
            )}

          {cotizacionSeleccionada.estado === 'ACEPTADA' && (
            <div className="border-t border-outline pt-4 space-y-3">
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-1">Saldo</p>
              <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
                <div>
                  <dt className="text-on-surface-variant uppercase">Método</dt>
                  <dd className="text-on-surface">{cotizacionSeleccionada.metodo_saldo ?? 'Sin definir'}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Saldo pendiente</dt>
                  <dd className="text-on-surface">{cotizacionSeleccionada.saldo_pendiente}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Estado del saldo</dt>
                  <dd className="text-on-surface">{cotizacionSeleccionada.estado_saldo}</dd>
                </div>
              </dl>

              {cotizacionSeleccionada.saldo_comprobante_recibido && (
                <button
                  type="button"
                  disabled={descargandoComprobanteSaldo}
                  onClick={handleDescargarComprobanteSaldo}
                  className="inline-flex items-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                >
                  {descargandoComprobanteSaldo ? 'DESCARGANDO...' : 'DESCARGAR COMPROBANTE DE SALDO'}
                </button>
              )}

              {cotizacionSeleccionada.estado_saldo === 'PENDIENTE' && (
                <div className="space-y-3">
                  {!cotizacionSeleccionada.metodo_saldo && (
                    <div>
                      <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                        Método de pago del saldo (si aún no hay comprobante subido por el cliente)
                      </label>
                      <select
                        value={metodoSaldoElegido}
                        onChange={(e) => setMetodoSaldoElegido(e.target.value)}
                        className="bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none cursor-pointer"
                      >
                        <option value="EFECTIVO">EFECTIVO</option>
                        <option value="TRANSFERENCIA">TRANSFERENCIA</option>
                      </select>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={gestionandoSaldo}
                      onClick={() => handleGestionarSaldo('VALIDAR')}
                      className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                    >
                      VALIDAR SALDO
                    </button>
                    <button
                      type="button"
                      disabled={gestionandoSaldo}
                      onClick={() => handleGestionarSaldo('RECHAZAR')}
                      className="inline-flex items-center px-4 py-2 border border-error text-error hover:bg-error hover:text-on-error transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                    >
                      RECHAZAR SALDO
                    </button>
                  </div>
                </div>
              )}

              {cotizacionSeleccionada.estado_saldo === 'RECHAZADO' && (
                <div className="space-y-3">
                  <p className="font-code-sm text-xs text-error uppercase">
                    Saldo rechazado. Puede reabrirlo para permitir un nuevo intento de pago.
                  </p>
                  <button
                    type="button"
                    disabled={gestionandoSaldo}
                    onClick={handleReabrirSaldo}
                    className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-label-caps text-label-caps disabled:opacity-50 cursor-pointer"
                  >
                    {gestionandoSaldo ? 'REABRIENDO...' : 'REABRIR SALDO'}
                  </button>
                </div>
              )}

              {mensajeSaldo && <p className="font-code-sm text-xs text-on-surface-variant uppercase">{mensajeSaldo}</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-surface sharp-border p-6">
        <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-4">
          NUEVA COTIZACIÓN
        </h3>
        <p className="font-code-sm text-xs text-on-surface-variant uppercase mb-4">
          Solo se puede crear para una solicitud existente en estado EN_REVISION.
        </p>
        <form className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end" onSubmit={handleCrear}>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
              ID de solicitud
            </label>
            <input
              value={solicitudIdNueva}
              onChange={(e) => setSolicitudIdNueva(e.target.value)}
              required
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
              type="text"
              placeholder="UUID de la solicitud"
            />
          </div>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Valor</label>
            <input
              value={valorNuevo}
              onChange={(e) => setValorNuevo(e.target.value)}
              required
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
              type="number"
              min="0"
              step="0.01"
            />
          </div>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
              Descripción (opcional)
            </label>
            <input
              value={descripcionNueva}
              onChange={(e) => setDescripcionNueva(e.target.value)}
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
              type="text"
            />
          </div>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">IVA</label>
            <select
              value={ivaPorcentajeNuevo}
              onChange={(e) => setIvaPorcentajeNuevo(e.target.value)}
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
            >
              <option value="15">15%</option>
              <option value="0">0%</option>
            </select>
          </div>
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Anticipo</label>
            <select
              value={anticipoPorcentajeNuevo}
              onChange={(e) => setAnticipoPorcentajeNuevo(e.target.value)}
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
            >
              <option value="50">50%</option>
              <option value="0">0%</option>
              <option value="75">75%</option>
            </select>
          </div>
          {anticipoPorcentajeNuevo !== '0' && (
            <div>
              <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                Método de anticipo
              </label>
              <select
                value={metodoAnticipoNuevo}
                onChange={(e) => setMetodoAnticipoNuevo(e.target.value)}
                required
                className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
              >
                <option value="TRANSFERENCIA">TRANSFERENCIA</option>
                <option value="EFECTIVO">EFECTIVO</option>
              </select>
            </div>
          )}
          <div>
            <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
              Vigencia (días)
            </label>
            <input
              value={diasVigenciaNuevo}
              onChange={(e) => setDiasVigenciaNuevo(e.target.value)}
              required
              className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
              type="number"
              min="1"
              step="1"
            />
          </div>
          <div className="md:col-span-3">
            <button
              disabled={creando}
              type="submit"
              className="inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-label-caps text-label-caps hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
            >
              {creando ? 'CREANDO...' : 'CREAR COTIZACIÓN'}
            </button>
            {mensajeCrear && (
              <span className="ml-4 font-code-sm text-xs text-on-surface-variant uppercase">{mensajeCrear}</span>
            )}
          </div>
        </form>
      </div>

      <div>
        {loadingLista && (
          <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO COTIZACIONES...</p>
        )}
        {!loadingLista && errorLista && (
          <p className="font-code-sm text-xs text-error uppercase">{errorLista}</p>
        )}
        {!loadingLista && !errorLista && cotizaciones && cotizaciones.length === 0 && (
          <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">
            NO HAY COTIZACIONES REGISTRADAS.
          </p>
        )}
        {!loadingLista && !errorLista && cotizaciones && cotizaciones.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline">
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Solicitud</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Valor</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Estado</th>
                  <th className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant uppercase">Creada</th>
                  <th className="py-3 font-code-sm text-code-sm text-on-surface-variant uppercase"></th>
                </tr>
              </thead>
              <tbody>
                {cotizaciones.map((c) => (
                  <tr key={c.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                    <td className="py-3 pr-4 font-code-sm text-code-sm text-on-surface break-all">{c.solicitud_id}</td>
                    <td className="py-3 pr-4 font-body-md text-body-md text-on-surface">{c.valor}</td>
                    <td className="py-3 pr-4 font-code-sm text-code-sm text-primary-container uppercase">{c.estado}</td>
                    <td className="py-3 pr-4 font-code-sm text-code-sm text-on-surface-variant">
                      {new Date(c.creado_en).toLocaleDateString()}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => abrirDetalle(c.id)}
                        className="inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-label-caps text-label-caps text-[10px] cursor-pointer"
                      >
                        VER DETALLE
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
