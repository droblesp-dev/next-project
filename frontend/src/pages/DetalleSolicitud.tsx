import { useEffect, useState } from 'react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';
import { formatearCantidad } from '../lib/cantidadSolicitud';
import { textoResultadoAnalisis } from '../lib/mensajeAnalisisIa';
import type { Solicitud } from './BandejaSolicitudes';
import ChatTecnico from './ChatTecnico';

interface DetalleSolicitudProps {
  token: string;
  id: string;
  // Corrección de responsabilidades por rol (autorización explícita —
  // "AUTORIZACIÓN DE IMPLEMENTACIÓN — DETALLE DE SOLICITUDES POR ROL"):
  // el antiguo `puedeGestionar` único (ADMIN+COMERCIAL) se separa en 4
  // permisos independientes para que ADMIN quede como vista de
  // consulta/supervisión y COMERCIAL conserve todas las acciones.
  //
  // puedeGestionarSolicitud: controla únicamente la sección "Cambiar
  //   estado" — exclusivo COMERCIAL (antes ADMIN+COMERCIAL).
  // puedeConsultarAnalisis: controla si se muestra el bloque "Análisis IA"
  //   (solo lectura del historial) — ADMIN+COMERCIAL, igual que antes,
  //   coincide con los permisos reales del backend (analisisIaRouter exige
  //   ADMIN/COMERCIAL; OPERATIVO recibiría 403).
  // puedeGenerarAnalisis: controla el botón "GENERAR ANÁLISIS" dentro del
  //   bloque anterior — exclusivo COMERCIAL.
  // puedeRevisarAnalisis: controla el botón "MARCAR REVISADO" dentro del
  //   bloque anterior — exclusivo COMERCIAL.
  //
  // IMPORTANTE: esto es una corrección de interfaz, no de seguridad — el
  // backend sigue aceptando estas acciones desde un JWT de ADMIN
  // (solicitudes.routes.ts y analisisIa.routes.ts comparten
  // requireRole('ADMIN','COMERCIAL')); queda documentado como [PENDIENTE]
  // una corrección posterior de permisos backend, no realizada aquí.
  //
  // Bloque 2B: la comunicación técnica la resuelve <ChatTecnico> a partir del rol, el estado de
  // la solicitud y la orden asociada; ADMIN ahora la ve (solo lectura). El backend es la autoridad.
  puedeGestionarSolicitud: boolean;
  puedeConsultarAnalisis: boolean;
  puedeGenerarAnalisis: boolean;
  puedeRevisarAnalisis: boolean;
  rolUsuario: string;
  // Al llegar desde el detalle de una orden (misma conversación de la solicitud) se enfoca el chat.
  enfocarChat?: boolean;
  onVolver: () => void;
  onSesionInvalida: () => void;
}

// `solicitudes.fecha_requerida` es una columna DATE (sin hora ni zona
// horaria real, ver V0__esquema_base.sql) — el driver `pg` la entrega como
// un string ISO con hora de medianoche local y sufijo "Z" (ej.
// "2026-10-20T05:00:00.000Z" para la fecha calendario 2026-10-20 en un
// servidor en UTC-5). Convertirla con `new Date(...)` y formatearla en el
// navegador arriesga mostrar el día anterior o siguiente si el huso horario
// del navegador no coincide exactamente con el del servidor — por eso se
// lee directamente el fragmento YYYY-MM-DD de la cadena, sin construir
// ningún objeto Date ni hacer ninguna conversión de huso horario.
function formatearFechaSolo(valor: string | null): string {
  if (!valor) return 'No especificada';
  const coincidencia = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!coincidencia) return 'No especificada';
  const [, anio, mes, dia] = coincidencia;
  return `${dia}/${mes}/${anio}`;
}

// `creado_en`/`actualizado_en`/`fecha_hora`/`revisado_en` son TIMESTAMPTZ
// (instantes reales, no fechas de calendario) — aquí sí es correcto
// convertir con `new Date(...)` y dejar que el navegador muestre la hora
// local del usuario. Se fija el locale ('es-EC') y el formato explícitos
// para que no dependan del idioma configurado en cada navegador, y se
// maneja un valor inválido sin mostrar "Invalid Date".
function formatearFechaHora(valorIso: string | null): string {
  if (!valorIso) return 'No especificada';
  const fecha = new Date(valorIso);
  if (Number.isNaN(fecha.getTime())) return 'No especificada';
  return fecha.toLocaleString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// La descripción puede incluir, pegado por el cliente desde la sugerencia
// del asistente, un bloque de preguntas de seguimiento con su respuesta
// ("si"/"no") concatenada sin espacio justo después del signo de
// interrogación de cierre (ej. "...la pieza?si ¿Tiene..."). Es contenido ya
// guardado tal cual se recibió — nunca se reescribe su significado ni se
// modifica la base de datos — solo se inserta un espacio visual entre el
// "?" y la palabra siguiente para que sea legible, igual para cualquier
// registro histórico con el mismo patrón.
function legibilizarDescripcion(texto: string): string {
  return texto.replace(/\?(?=[A-Za-zÀ-ÿ¿])/g, '? ');
}

// Forma real de informacion_estructurada, tal como la exige
// backend/src/services/analisisIa.service.ts (ESQUEMA_RESPUESTA): son los
// ÚNICOS 3 campos que la IA puede devolver dentro de este objeto — no existe
// ningún "servicio identificado" en el contrato real (el servicio ya viene
// de la propia solicitud y se muestra en la cabecera, sin duplicarlo aquí).
interface InformacionEstructurada {
  material_estimado?: string;
  proceso_estimado?: string;
  informacion_faltante?: string[];
}

interface AnalisisIa {
  id: string;
  solicitud_id: string;
  fecha_hora: string;
  resultado: string | null;
  prioridad_sugerida: string | null;
  informacion_estructurada: InformacionEstructurada | null;
  modelo_ia: string | null;
  version_ia: string | null;
  estado: string;
  revisado: boolean;
  revisado_por: string | null;
  revisado_en: string | null;
}

interface ClienteResumen {
  nombre: string;
  empresa: string | null;
  telefono: string;
}

// Mismo criterio que BandejaSolicitudes.tsx::InfoCliente: `principal` es la
// empresa si existe, si no el nombre de la persona de contacto. `contacto`
// es el nombre de la persona, pero solo cuando NO es ya el principal (para
// no repetirlo); `telefono` es el teléfono, si está disponible. Cada uno se
// muestra en su propia fila con su propia etiqueta ("Contacto"/"Teléfono")
// — un teléfono sin etiqueta no se reconoce de inmediato como tal.
interface InfoCliente {
  principal: string;
  contacto: string | null;
  telefono: string | null;
}

// Transiciones permitidas — deben coincidir con TRANSICIONES en
// backend/src/services/solicitudes.service.ts. Es solo una guía de UX
// (oculta opciones obviamente inválidas): el backend sigue siendo la
// única autoridad real sobre qué transición se acepta.
//
// COTIZADA ya no es una transición manual (autorización explícita —
// "IMPLEMENTACIÓN AUTORIZADA — SOLICITUDES COMERCIAL"): ahora es un efecto
// automático de formalizar una cotización como ENVIADA en
// GestionCotizaciones.tsx. El backend ya la rechaza también (ver
// solicitudes.service.ts), esto solo evita ofrecer un botón que fallaría.
const TRANSICIONES: Record<string, string[]> = {
  NUEVA: ['EN_REVISION', 'CANCELADA'],
  EN_REVISION: ['CANCELADA'],
  COTIZADA: [],
  CANCELADA: [],
};

// Badges — mismos tokens/paleta ya usados en el resto del proyecto
// (BandejaSolicitudes.tsx / GestionCotizaciones.tsx / GestionDashboard.tsx),
// sin introducir ningún color nuevo.
const BADGE_ESTADO_ANALISIS: Record<string, string> = {
  PENDIENTE: 'border border-outline text-on-surface-variant',
  PROCESANDO: 'border border-primary-container text-primary-container bg-primary-container/10',
  COMPLETADO: 'border border-primary-container bg-primary-container text-on-primary-container',
  ERROR: 'border border-error text-error bg-error-container/20',
};

const BADGE_PRIORIDAD: Record<string, string> = {
  ALTA: 'border border-error text-error bg-error-container/20',
  MEDIA: 'border border-primary-container text-primary-container bg-primary-container/10',
  BAJA: 'border border-outline text-on-surface-variant',
};

function claseBadgeEstadoAnalisis(estado: string): string {
  return BADGE_ESTADO_ANALISIS[estado] ?? 'border border-outline text-on-surface-variant';
}

export default function DetalleSolicitud({
  token,
  id,
  puedeGestionarSolicitud,
  puedeConsultarAnalisis,
  puedeGenerarAnalisis,
  puedeRevisarAnalisis,
  rolUsuario,
  enfocarChat,
  onVolver,
  onSesionInvalida,
}: DetalleSolicitudProps) {
  const [solicitud, setSolicitud] = useState<Solicitud | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [mensajeCambio, setMensajeCambio] = useState<string | null>(null);

  // Resolución de cliente — mismo patrón "bulk-fetch + Map" ya usado en
  // GestionCotizaciones.tsx/GestionLeads.tsx. /api/clientes exige ADMIN/COMERCIAL
  // (clientes.routes.ts, sin cambios) — ningún endpoint nuevo.
  const [clientesPorId, setClientesPorId] = useState<Map<string, ClienteResumen>>(new Map());
  // OPERATIVO-09.1 (corrige H1 de OPERATIVO-09): OPERATIVO nunca puede consultar
  // /api/clientes (403 ya garantizado por el backend, sin cambios) — antes se llamaba
  // igual y se descartaba la respuesta en silencio. Mismo criterio ya usado para
  // `puedeConsultarAnalisis` con `cargarAnalisis()`, aplicado aquí a `cargarCliente()`.
  const puedeConsultarCliente = rolUsuario === 'ADMIN' || rolUsuario === 'COMERCIAL';

  const [analisis, setAnalisis] = useState<AnalisisIa[] | null>(null);
  const [loadingAnalisis, setLoadingAnalisis] = useState(true);
  const [errorAnalisis, setErrorAnalisis] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [mensajeGenerar, setMensajeGenerar] = useState<string | null>(null);
  const [revisandoId, setRevisandoId] = useState<string | null>(null);
  const [mensajeRevisar, setMensajeRevisar] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchAutenticado(`/api/solicitudes/${id}`, token);

      if (response.status === 404) {
        setError('Solicitud no encontrada.');
        return;
      }
      if (response.status === 403) {
        setError('No autorizado para consultar esta solicitud.');
        return;
      }
      if (!response.ok) {
        setError('No se pudo cargar la solicitud.');
        return;
      }

      const data = (await response.json()) as { solicitud: Solicitud };
      setSolicitud(data.solicitud);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setError('No se pudo cargar la solicitud.');
    } finally {
      setLoading(false);
    }
  }

  async function cargarCliente() {
    try {
      const response = await fetchAutenticado('/api/clientes', token);
      if (!response.ok) return;
      const data = (await response.json()) as {
        clientes: { id: string; nombre: string; empresa: string | null; telefono: string }[];
      };
      const mapa = new Map<string, ClienteResumen>();
      data.clientes.forEach((c) => mapa.set(c.id, { nombre: c.nombre, empresa: c.empresa, telefono: c.telefono }));
      setClientesPorId(mapa);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
      // Falla silenciosa: el nombre de cliente es un dato de apoyo, no
      // bloquea la consulta/gestión real de la solicitud.
    }
  }

  async function cargarAnalisis() {
    setLoadingAnalisis(true);
    setErrorAnalisis(null);

    try {
      const response = await fetchAutenticado(`/api/analisis-ia?solicitud_id=${id}`, token);

      if (response.status === 403) {
        setErrorAnalisis('No autorizado para consultar análisis de IA.');
        return;
      }
      if (!response.ok) {
        setErrorAnalisis('No se pudo cargar el historial de análisis.');
        return;
      }

      const data = (await response.json()) as { analisis: AnalisisIa[] };
      setAnalisis(data.analisis);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorAnalisis('No se pudo cargar el historial de análisis.');
    } finally {
      setLoadingAnalisis(false);
    }
  }

  useEffect(() => {
    cargar();
    // Ambas llamadas de apoyo se restringen a quien realmente puede consultar el
    // recurso (ADMIN/COMERCIAL) — evita una llamada que el backend igual
    // rechazaría con 403 para OPERATIVO. Antes `cargarCliente()` se llamaba
    // incondicionalmente (hallazgo H1, OPERATIVO-09); `cargarAnalisis()` ya
    // seguía este mismo criterio.
    if (puedeConsultarCliente) {
      cargarCliente();
    }
    if (puedeConsultarAnalisis) {
      cargarAnalisis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  async function handleGenerarAnalisis() {
    setGenerando(true);
    setMensajeGenerar(null);

    try {
      const response = await fetchAutenticado('/api/analisis-ia', token, {
        method: 'POST',
        body: JSON.stringify({ solicitud_id: id }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeGenerar(data?.message || 'No se pudo generar el análisis.');
        return;
      }

      const nuevoEstado = data?.analisis?.estado;
      setMensajeGenerar(
        nuevoEstado === 'ERROR'
          ? 'El proveedor de IA no pudo completar el análisis. Se registró el intento como ERROR.'
          : 'Análisis generado correctamente.'
      );
      await cargarAnalisis();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeGenerar('No se pudo generar el análisis.');
    } finally {
      setGenerando(false);
    }
  }

  async function handleMarcarRevisado(analisisId: string) {
    setRevisandoId(analisisId);
    setMensajeRevisar(null);

    try {
      const response = await fetchAutenticado(`/api/analisis-ia/${analisisId}/revisado`, token, {
        method: 'PATCH',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeRevisar(data?.message || 'No se pudo marcar el análisis como revisado.');
        return;
      }

      await cargarAnalisis();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeRevisar('No se pudo marcar el análisis como revisado.');
    } finally {
      setRevisandoId(null);
    }
  }

  async function handleCambiarEstado(nuevoEstado: string) {
    setCambiando(true);
    setMensajeCambio(null);

    try {
      const response = await fetchAutenticado(`/api/solicitudes/${id}/estado`, token, {
        method: 'PATCH',
        body: JSON.stringify({ estado: nuevoEstado }),
      });

      if (response.status === 409) {
        setMensajeCambio('Conflicto: la transición ya no es válida para el estado actual. Se actualizó la información.');
        await cargar();
        return;
      }
      if (response.status === 404) {
        setMensajeCambio('La solicitud ya no existe.');
        return;
      }
      if (response.status === 400) {
        setMensajeCambio('Estado inválido.');
        return;
      }
      if (!response.ok) {
        setMensajeCambio('No se pudo cambiar el estado.');
        return;
      }

      const data = (await response.json()) as { solicitud: Solicitud };
      setSolicitud(data.solicitud);
      setMensajeCambio('Estado actualizado correctamente.');
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

  const clienteResuelto = solicitud ? clientesPorId.get(solicitud.cliente_id) : undefined;
  const infoCliente: InfoCliente = (() => {
    if (!clienteResuelto) return { principal: '—', contacto: null, telefono: null };
    const empresa = clienteResuelto.empresa?.trim() || null;
    const nombre = clienteResuelto.nombre?.trim() || null;
    const telefono = clienteResuelto.telefono?.trim() || null;
    const principal = empresa || nombre || '—';
    const contacto = empresa && nombre ? nombre : null;
    return { principal, contacto, telefono };
  })();
  // Una solicitud NUEVA nunca tuvo la oportunidad de generar un análisis
  // (generarAnalisis() exige EN_REVISION, y NUEVA->EN_REVISION es la única
  // vía de entrada, sin retorno) — se puede afirmar con certeza que su
  // historial está vacío sin esperar la respuesta de cargarAnalisis().
  const solicitudNuevaSinAnalisis = solicitud?.estado === 'NUEVA';

  return (
    <div>
      <button
        type="button"
        onClick={onVolver}
        className="min-h-11 -mt-2.5 mb-3.5 inline-flex items-center font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
      >
        <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
        VOLVER A LA BANDEJA
      </button>

      {loading && (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO...</p>
      )}

      {!loading && error && (
        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{error}</p>
      )}

      {!loading && !error && solicitud && (
        <div className="space-y-6">
          {/* Cabecera — servicio, estado, cliente, cantidad, fecha
              requerida, descripción. Sin repetir estos datos dentro de
              Análisis IA. */}
          <div className="bg-surface sharp-border p-6 space-y-4">
            <div className="flex flex-wrap justify-between items-start gap-x-4 gap-y-2 border-b border-outline pb-4">
              <h3 className="font-headline-md text-headline-md text-on-surface uppercase min-w-0 wrap-anywhere">{solicitud.servicio}</h3>
              <span className="shrink-0 whitespace-nowrap font-code-sm text-code-sm text-primary-container uppercase">{solicitud.estado.replace(/_/g, ' ')}</span>
            </div>

            <p className="font-body-md text-body-md text-on-surface-variant">{legibilizarDescripcion(solicitud.descripcion)}</p>

            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 font-code-sm text-code-sm wrap-anywhere">
              <div>
                <dt className="text-on-surface-variant uppercase">Cliente</dt>
                <dd className="text-on-surface">{infoCliente.principal}</dd>
              </div>
              {infoCliente.contacto && (
                <div>
                  <dt className="text-on-surface-variant uppercase">Contacto</dt>
                  <dd className="text-on-surface">{infoCliente.contacto}</dd>
                </div>
              )}
              {infoCliente.telefono && (
                <div>
                  <dt className="text-on-surface-variant uppercase">Teléfono</dt>
                  <dd className="text-on-surface">{infoCliente.telefono}</dd>
                </div>
              )}
              <div>
                <dt className="text-on-surface-variant uppercase">Cantidad</dt>
                <dd className="text-on-surface">{formatearCantidad(solicitud.cantidad, solicitud.especificaciones)}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Fecha requerida</dt>
                <dd className="text-on-surface">{formatearFechaSolo(solicitud.fecha_requerida)}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Creada</dt>
                <dd className="text-on-surface">{formatearFechaHora(solicitud.creado_en)}</dd>
              </div>
            </dl>

            {solicitud.especificaciones && (
              <div>
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-1">Especificaciones</p>
                <p className="font-body-md text-body-md text-on-surface">{solicitud.especificaciones}</p>
              </div>
            )}

            {puedeGestionarSolicitud && (
              <div className="border-t border-outline pt-4">
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Cambiar estado</p>
                <div className="flex flex-wrap gap-3">
                  {(TRANSICIONES[solicitud.estado] ?? []).map((destino) => (
                    <button
                      key={destino}
                      type="button"
                      disabled={cambiando}
                      onClick={() => handleCambiarEstado(destino)}
                      className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      {destino.replace(/_/g, ' ')}
                    </button>
                  ))}
                  {(TRANSICIONES[solicitud.estado] ?? []).length === 0 && (
                    <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                      Este estado no admite más transiciones.
                    </p>
                  )}
                </div>
                {mensajeCambio && (
                  <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-3">{mensajeCambio}</p>
                )}
              </div>
            )}
          </div>

          {/* Dos columnas en desktop (no necesariamente 50/50): Análisis IA
              a la izquierda con más ancho relativo (contiene tarjetas de
              datos estructurados), Comunicación Técnica a la derecha. En
              mobile/tablet se apilan verticalmente, Análisis IA primero. */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-start">
            {puedeConsultarAnalisis && (
              <div className="md:col-span-3 bg-background border border-outline border-l-4 border-l-primary-container p-5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-symbols-outlined text-primary-container text-[22px]">psychology</span>
                  <h4 className="font-headline-md text-headline-md text-on-surface uppercase">Análisis IA</h4>
                </div>
                <p className="font-body-md text-sm text-on-surface-variant mb-4">
                  Analiza la solicitud para identificar información faltante, prioridad y aspectos que Comercial debe
                  revisar antes de cotizar.
                </p>

                {solicitudNuevaSinAnalisis ? (
                  <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                    Sin análisis generado — disponible al pasar a EN_REVISION.
                  </p>
                ) : (
                  <>
                    {puedeGenerarAnalisis && solicitud.estado === 'EN_REVISION' && (
                      <button
                        type="button"
                        disabled={generando}
                        onClick={handleGenerarAnalisis}
                        className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer mb-3"
                      >
                        {generando
                          ? 'GENERANDO...'
                          : analisis && analisis.length > 0
                            ? 'REGENERAR ANÁLISIS'
                            : 'GENERAR ANÁLISIS'}
                      </button>
                    )}
                    {mensajeGenerar && (
                      <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mb-3">{mensajeGenerar}</p>
                    )}

                    {loadingAnalisis && (
                      <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO ANÁLISIS...</p>
                    )}
                    {!loadingAnalisis && errorAnalisis && (
                      <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorAnalisis}</p>
                    )}
                    {!loadingAnalisis && !errorAnalisis && analisis && analisis.length === 0 && (
                      <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                        SIN ANÁLISIS GENERADO
                      </p>
                    )}
                    {!loadingAnalisis && !errorAnalisis && analisis && analisis.length > 0 && (
                      <div className="space-y-3">
                        {analisis.map((a) => {
                          const info = a.informacion_estructurada;
                          const faltante = info?.informacion_faltante?.filter((v) => v && v.trim()) ?? [];
                          return (
                            <div key={a.id} className="bg-surface border border-outline p-4">
                              <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                                <span
                                  className={`inline-flex px-2 py-0.5 font-code-sm text-[10px] uppercase ${claseBadgeEstadoAnalisis(a.estado)}`}
                                >
                                  {a.estado.replace(/_/g, ' ')}
                                </span>
                                <span className="font-code-sm text-[10px] text-on-surface-variant uppercase">
                                  {formatearFechaHora(a.fecha_hora)}
                                </span>
                              </div>

                              {textoResultadoAnalisis(a.estado, a.resultado) && (
                                <p className="font-body-md text-body-md text-on-surface mb-3">
                                  {textoResultadoAnalisis(a.estado, a.resultado)}
                                </p>
                              )}

                              {(a.prioridad_sugerida || info?.material_estimado || info?.proceso_estimado) && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                                  {a.prioridad_sugerida && (
                                    <div className="bg-background border border-outline p-2">
                                      <p className="font-code-sm text-[9px] text-on-surface-variant uppercase mb-1">
                                        Prioridad
                                      </p>
                                      <span
                                        className={`inline-flex px-2 py-0.5 font-code-sm text-[10px] uppercase ${BADGE_PRIORIDAD[a.prioridad_sugerida] ?? 'border border-outline text-on-surface-variant'}`}
                                      >
                                        {a.prioridad_sugerida}
                                      </span>
                                    </div>
                                  )}
                                  {info?.material_estimado && (
                                    <div className="bg-background border border-outline p-2">
                                      <p className="font-code-sm text-[9px] text-on-surface-variant uppercase mb-1">
                                        Material estimado
                                      </p>
                                      <p className="font-body-md text-sm text-on-surface">{info.material_estimado}</p>
                                    </div>
                                  )}
                                  {info?.proceso_estimado && (
                                    <div className="bg-background border border-outline p-2">
                                      <p className="font-code-sm text-[9px] text-on-surface-variant uppercase mb-1">
                                        Proceso estimado
                                      </p>
                                      <p className="font-body-md text-sm text-on-surface">{info.proceso_estimado}</p>
                                    </div>
                                  )}
                                </div>
                              )}

                              {faltante.length > 0 && (
                                <div className="bg-error-container/20 border border-error p-3 mb-3">
                                  <p className="font-code-sm text-[10px] text-error uppercase font-bold mb-2">
                                    Información faltante
                                  </p>
                                  <ul className="list-disc list-inside space-y-1">
                                    {faltante.map((item, i) => (
                                      <li key={i} className="font-body-md text-sm text-on-surface">
                                        {item}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <p className="font-code-sm text-[10px] text-on-surface-variant uppercase">
                                {a.revisado
                                  ? `Revisado el ${formatearFechaHora(a.revisado_en)}`
                                  : 'No revisado'}
                              </p>
                              {puedeRevisarAnalisis && a.estado === 'COMPLETADO' && !a.revisado && (
                                <button
                                  type="button"
                                  disabled={revisandoId === a.id}
                                  onClick={() => handleMarcarRevisado(a.id)}
                                  className="mt-2 inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                                >
                                  MARCAR REVISADO
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {mensajeRevisar && (
                      <p className="font-code-sm text-xs text-on-surface-variant uppercase mt-3">{mensajeRevisar}</p>
                    )}
                  </>
                )}
              </div>
            )}

            {solicitud && (
              <ChatTecnico
                token={token}
                solicitudId={id}
                rolUsuario={rolUsuario}
                solicitudEstado={solicitud.estado}
                enfocar={enfocarChat}
                onSesionInvalida={onSesionInvalida}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
