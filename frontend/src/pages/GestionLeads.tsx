import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { fetchAutenticado, obtenerMe, SesionInvalidaError, type Usuario } from '../lib/authClient';
import type { Solicitud } from './BandejaSolicitudes';

export interface Lead {
  id: string;
  nombre: string;
  telefono: string;
  email: string | null;
  fuente: string;
  estado: string;
  clasificacion: string;
  comercial_id: string | null;
  cliente_id: string | null;
  solicitud_id: string | null;
  ultimo_contacto: string | null;
  proximo_seguimiento: string | null;
  observaciones: string | null;
  creado_en: string;
  actualizado_en: string;
}

export interface LeadSeguimiento {
  id: string;
  lead_id: string;
  comercial_id: string | null;
  tipo: string;
  observacion: string | null;
  fecha: string;
}

const TIPOS_SEGUIMIENTO = ['LLAMADA', 'WHATSAPP', 'EMAIL', 'VISITA', 'OTRO'];

interface GestionLeadsProps {
  token: string;
  esAdmin: boolean;
  onSesionInvalida: () => void;
  // Abre la cotización indicada en la sección Cotizaciones (COMERCIAL).
  onVerCotizacion?: (cotizacionId: string) => void;
}

// Solo los campos que el detalle de un lead CALIENTE necesita de
// /api/cotizaciones (endpoint ya existente, ADMIN/COMERCIAL).
interface CotizacionLead {
  id: string;
  solicitud_id: string;
  estado: string;
  valor: string;
  total: string | null;
  creado_en: string;
}

const CLASE_ESTADO_COTIZACION: Record<string, string> = {
  ACEPTADA: 'border border-primary-container bg-primary-container text-on-primary-container',
  ENVIADA: 'border border-primary-container text-primary-container',
  BORRADOR: 'border border-outline text-on-surface-variant',
  RECHAZADA: 'border border-error text-error',
  VENCIDA: 'border border-error text-error',
  CANCELADA: 'border border-error text-error',
};

// Solo los campos que la vista ADMIN necesita de /api/clientes (nombre
// para mostrar) — mismo patrón de solo lectura ya usado en el resto de
// las bandejas ADMIN.
interface ClienteResumen {
  nombre: string;
  empresa: string | null;
  email: string | null;
}

type EstadoApoyo = 'cargando' | 'disponible' | 'error';

// Valores reales de los CHECK de PostgreSQL (chk_leads_fuente,
// chk_leads_estado, chk_leads_clasificacion) — no se derivan
// dinámicamente porque, a diferencia de Alertas, los 5 valores de
// clasificación y los 2 de estado son todos reales y alcanzables, mismo
// criterio ya usado en Solicitudes/Cotizaciones/Órdenes.
const FUENTES_FILTRO = ['TODAS', 'WEB', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'REFERIDO', 'OTRO'] as const;
const CLASIFICACIONES_FILTRO = ['TODAS', 'FRIO', 'TIBIO', 'CALIENTE', 'CONVERTIDO', 'RECURRENTE'] as const;
const ESTADOS_FILTRO_LEAD = ['TODOS', 'ACTIVO', 'DESCARTADO'] as const;

type OrdenPorLead = 'recientes' | 'antiguos' | 'nombre_asc' | 'nombre_desc' | 'clasificacion' | 'estado';

// Progresión real de la clasificación (fría -> recurrente), solo para ordenar.
const ORDEN_CLASIFICACION: Record<string, number> = { FRIO: 0, TIBIO: 1, CALIENTE: 2, CONVERTIDO: 3, RECURRENTE: 4 };

const REGISTROS_POR_PAGINA_OPCIONES_LEAD = [10, 25, 50] as const;

// Badges por clasificación real — colores tomados exclusivamente de los
// tokens ya definidos en index.css, progresión fría->cálida->convertida.
const BADGE_CLASIFICACION: Record<string, string> = {
  FRIO: 'border border-outline-variant text-on-surface-variant bg-outline-variant/10',
  TIBIO: 'border border-primary-container text-primary-container bg-primary-container/10',
  CALIENTE: 'border border-primary-container bg-primary-container text-on-primary-container',
  CONVERTIDO: 'border border-secondary-container text-secondary bg-secondary-container/30',
  RECURRENTE: 'border border-tertiary-container bg-tertiary-container text-on-primary-container',
};

function claseBadgeClasificacion(clasificacion: string): string {
  return BADGE_CLASIFICACION[clasificacion] ?? 'border border-outline text-on-surface-variant';
}

const BADGE_ESTADO_LEAD: Record<string, string> = {
  ACTIVO: 'border border-outline text-on-surface',
  DESCARTADO: 'border border-error text-error bg-error-container/20',
};

function claseBadgeEstadoLead(estado: string): string {
  return BADGE_ESTADO_LEAD[estado] ?? 'border border-outline text-on-surface-variant';
}

const ICONO_CLASIFICACION: Record<string, string> = {
  FRIO: 'ac_unit',
  TIBIO: 'thermostat',
  CALIENTE: 'local_fire_department',
  CONVERTIDO: 'check_circle',
  RECURRENTE: 'autorenew',
};

// Clasificación y estado siempre con icono + texto (no dependen solo del color).
function BadgeClasificacion({ valor, compacto = false }: { valor: string; compacto?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 ${compacto ? 'px-2 py-0.5' : 'px-2.5 py-1'} font-code-sm text-[10px] uppercase ${claseBadgeClasificacion(valor)}`}
    >
      <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
        {ICONO_CLASIFICACION[valor] ?? 'label'}
      </span>
      {valor}
    </span>
  );
}

function BadgeEstadoLead({ valor, compacto = false }: { valor: string; compacto?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 ${compacto ? 'px-2 py-0.5' : 'px-2.5 py-1'} font-code-sm text-[10px] uppercase ${claseBadgeEstadoLead(valor)}`}
    >
      <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
        {valor === 'DESCARTADO' ? 'block' : 'radio_button_checked'}
      </span>
      {valor}
    </span>
  );
}

function TituloSeccion({ icono, children }: { icono: string; children: string }) {
  return (
    <h4 className="flex items-center gap-2 font-label-caps text-label-caps text-on-surface uppercase">
      <span className="material-symbols-outlined text-[18px] text-primary-container" aria-hidden="true">
        {icono}
      </span>
      {children}
    </h4>
  );
}

function fechaEnRangoLead(fechaIso: string, desde: string, hasta: string): boolean {
  const fecha = new Date(fechaIso);
  const soloDia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());

  if (desde) {
    const [y, m, d] = desde.split('-').map(Number);
    if (soloDia < new Date(y, m - 1, d)) return false;
  }
  if (hasta) {
    const [y, m, d] = hasta.split('-').map(Number);
    if (soloDia > new Date(y, m - 1, d)) return false;
  }
  return true;
}

const BORDE_CLASIFICACION: Record<string, string> = {
  FRIO: 'border-l-outline-variant',
  TIBIO: 'border-l-primary-container',
  CALIENTE: 'border-l-primary-container',
  CONVERTIDO: 'border-l-secondary',
  RECURRENTE: 'border-l-tertiary-container',
};

// Estado del lead: ACTIVO es un dato discreto; solo DESCARTADO se destaca.
// Así no compite con la clasificación, que es la etapa comercial.
function EstadoLeadCelda({ estado }: { estado: string }) {
  if (estado === 'DESCARTADO') return <BadgeEstadoLead valor={estado} />;
  return (
    <span className="inline-flex items-center gap-1.5 font-code-sm text-[11px] uppercase text-on-surface-variant">
      <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant" aria-hidden="true" />
      Activo
    </span>
  );
}

const ETAPAS_EMBUDO = [
  { clave: 'FRIO', etiqueta: 'Fríos', icono: 'ac_unit', borde: 'border-t-outline-variant', numero: 'text-on-surface-variant' },
  { clave: 'TIBIO', etiqueta: 'Tibios', icono: 'thermostat', borde: 'border-t-primary-container', numero: 'text-primary-container' },
  { clave: 'CALIENTE', etiqueta: 'Calientes', icono: 'local_fire_department', borde: 'border-t-primary-container', numero: 'text-primary-container' },
  { clave: 'CONVERTIDO', etiqueta: 'Convertidos', icono: 'check_circle', borde: 'border-t-secondary', numero: 'text-on-surface' },
  { clave: 'RECURRENTE', etiqueta: 'Recurrentes', icono: 'autorenew', borde: 'border-t-tertiary-container', numero: 'text-on-surface' },
] as const;

// KPIs en dos niveles: el embudo por CLASIFICACIÓN (protagonista) y, aparte
// y discreto, el resumen por ESTADO (total / activos / descartados).
function EmbudoKpis({
  kpis,
}: {
  kpis: {
    total: number;
    FRIO: number;
    TIBIO: number;
    CALIENTE: number;
    CONVERTIDO: number;
    RECURRENTE: number;
    activos: number;
    descartados: number;
  };
}) {
  return (
    <section className="space-y-3" aria-label="Resumen de leads">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h3 className="font-label-caps text-[11px] text-on-surface-variant uppercase">
          Embudo por clasificación · solo leads activos
        </h3>
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 font-code-sm text-[11px] uppercase text-on-surface-variant">
          <div className="flex items-baseline gap-1.5">
            <dt>Total</dt>
            <dd className="text-sm font-bold text-on-surface">{kpis.total}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>Activos</dt>
            <dd className="text-sm font-bold text-on-surface">{kpis.activos}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt>Descartados</dt>
            <dd className="text-sm font-bold text-error">{kpis.descartados}</dd>
          </div>
        </dl>
      </div>

      <ol className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {ETAPAS_EMBUDO.map((e, i) => (
          <li
            key={e.clave}
            className={`bg-surface sharp-border border-t-4 ${e.borde} p-3 min-w-0 ${i === ETAPAS_EMBUDO.length - 1 ? 'col-span-2 sm:col-span-1' : ''}`}
          >
            <p className="flex items-center gap-1.5 font-label-caps text-[10px] text-on-surface-variant uppercase">
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
                {e.icono}
              </span>
              {e.etiqueta}
            </p>
            <p className={`mt-1 font-headline-md text-3xl font-black leading-none ${e.numero}`}>{kpis[e.clave]}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function KpiLead({
  icono,
  valor,
  etiqueta,
  claseIcono,
  claseBorde,
}: {
  icono: string;
  valor: number;
  etiqueta: string;
  claseIcono: string;
  claseBorde: string;
}) {
  return (
    <div className={`bg-surface sharp-border p-3 sm:p-4 border-l-4 ${claseBorde} flex items-center gap-2 sm:gap-3 min-w-0`}>
      <span className={`inline-flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 shrink-0 rounded-full ${claseIcono}`}>
        <span className="material-symbols-outlined text-[20px]">{icono}</span>
      </span>
      <div className="min-w-0">
        <p className="font-headline-md text-headline-md font-black text-on-surface leading-none">{valor}</p>
        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase mt-1 break-words">{etiqueta}</p>
      </div>
    </div>
  );
}

export default function GestionLeads({ token, esAdmin, onSesionInvalida, onVerCotizacion }: GestionLeadsProps) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [leadSeleccionado, setLeadSeleccionado] = useState<Lead | null>(null);
  const [mensajeAccion, setMensajeAccion] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);

  // Bloque 1 — mejora del detalle (autorización explícita — "IMPLEMENTAR
  // BLOQUE 1 — MEJORA DEL DETALLE DE LEADS"): estos dos estados guardan el
  // id del cliente/solicitud ELEGIDO en los buscadores amigables (uso
  // interno para el PATCH); ya no se escriben a mano ni se precargan con
  // el vínculo actual, y nunca se muestran como UUID.
  const [clienteIdInput, setClienteIdInput] = useState('');
  const [solicitudIdInput, setSolicitudIdInput] = useState('');
  const [busquedaClienteVinculo, setBusquedaClienteVinculo] = useState('');
  const [busquedaSolicitudVinculo, setBusquedaSolicitudVinculo] = useState('');
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  // Selector de vinculación abierto (solo presentación).
  const [selectorVinculo, setSelectorVinculo] = useState<'cliente' | 'solicitud' | null>(null);
  const [cotizacionesLead, setCotizacionesLead] = useState<CotizacionLead[] | null>(null);
  const [estadoCotizacionesLead, setEstadoCotizacionesLead] = useState<EstadoApoyo>('cargando');
  // Solo presentación: filtros plegables en móvil y formulario de contacto plegado en CONVERTIDO/RECURRENTE.
  const [filtrosMovilAbiertos, setFiltrosMovilAbiertos] = useState(false);
  const [mostrarSeguimientoExtra, setMostrarSeguimientoExtra] = useState(false);
  // Enlace de solicitud para leads TIBIO (se genera y copia a mano; sin WhatsApp).
  const [enlaceSolicitud, setEnlaceSolicitud] = useState<{ url: string; expira_en: string } | null>(null);
  const [generandoEnlace, setGenerandoEnlace] = useState(false);
  const [errorEnlace, setErrorEnlace] = useState<string | null>(null);
  const [enlaceCopiado, setEnlaceCopiado] = useState(false);
  // undefined = todavía cargando; null = no se pudo obtener. Solo sirve para
  // distinguir "Yo" de "Otro comercial" — COMERCIAL no puede resolver el
  // nombre de otros usuarios (/api/usuarios es exclusivo de ADMIN).
  const [usuarioActualId, setUsuarioActualId] = useState<string | null | undefined>(undefined);
  const [tipoSeguimientoInput, setTipoSeguimientoInput] = useState('LLAMADA');
  const [observacionInput, setObservacionInput] = useState('');

  const [seguimientos, setSeguimientos] = useState<LeadSeguimiento[] | null>(null);
  const [loadingSeguimientos, setLoadingSeguimientos] = useState(false);

  const [comerciales, setComerciales] = useState<Usuario[] | null>(null);
  const [comercialElegido, setComercialElegido] = useState('');

  // Vista ADMIN — solo lectura/supervisión + asignar comercial. Estados
  // independientes de los de arriba (exclusivos del flujo COMERCIAL, sin
  // ningún cambio).
  const [usuariosPorId, setUsuariosPorId] = useState<Map<string, string>>(new Map());
  const [clientesPorId, setClientesPorId] = useState<Map<string, ClienteResumen>>(new Map());
  const [solicitudesPorId, setSolicitudesPorId] = useState<Map<string, Solicitud>>(new Map());
  const [estadoApoyo, setEstadoApoyo] = useState<EstadoApoyo>('cargando');

  const [busquedaAdmin, setBusquedaAdmin] = useState('');
  const [fuenteFiltroAdmin, setFuenteFiltroAdmin] = useState<(typeof FUENTES_FILTRO)[number]>('TODAS');
  const [clasificacionFiltroAdmin, setClasificacionFiltroAdmin] = useState<(typeof CLASIFICACIONES_FILTRO)[number]>('TODAS');
  const [estadoFiltroAdmin, setEstadoFiltroAdmin] = useState<(typeof ESTADOS_FILTRO_LEAD)[number]>('TODOS');
  const [fechaDesdeAdmin, setFechaDesdeAdmin] = useState('');
  const [fechaHastaAdmin, setFechaHastaAdmin] = useState('');
  const [ordenPorAdmin, setOrdenPorAdmin] = useState<OrdenPorLead>('recientes');
  const [paginaActualAdmin, setPaginaActualAdmin] = useState(1);
  const [registrosPorPaginaAdmin, setRegistrosPorPaginaAdmin] = useState<number>(10);

  async function cargar() {
    setLoadingLista(true);
    setErrorLista(null);

    try {
      const response = await fetchAutenticado('/api/leads', token);

      if (response.status === 403) {
        setErrorLista('No autorizado para consultar leads.');
        return;
      }
      if (!response.ok) {
        setErrorLista('No se pudo cargar el listado de leads.');
        return;
      }

      const data = (await response.json()) as { leads: Lead[] };
      setLeads(data.leads);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorLista('No se pudo cargar el listado de leads.');
    } finally {
      setLoadingLista(false);
    }
  }

  async function cargarComerciales() {
    try {
      const response = await fetchAutenticado('/api/usuarios', token);
      if (!response.ok) return;
      const data = (await response.json()) as { usuarios: Usuario[] };
      setComerciales(data.usuarios.filter((u) => u.rol === 'COMERCIAL' && u.activo));
      // Vista ADMIN: mismo listado ya solicitado, indexado además por
      // id -> nombre para resolver `comercial_id` en bandeja/detalle sin
      // mostrar el UUID crudo. No agrega ninguna llamada nueva.
      setUsuariosPorId(new Map(data.usuarios.map((u) => [u.id, u.nombre])));
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  useEffect(() => {
    cargar();
    if (esAdmin) {
      cargarComerciales();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, esAdmin]);

  // Carga de apoyo (clientes + solicitudes) para resolver cliente/solicitud
  // relacionados — antes exclusiva de la vista ADMIN, ahora también la usa
  // el detalle de COMERCIAL (Bloque 1). Mismos dos endpoints ya existentes
  // y accesibles para COMERCIAL (200 verificado en la auditoría).
  useEffect(() => {
    let cancelado = false;

    async function cargarApoyo() {
      setEstadoApoyo('cargando');
      try {
        const [respClientes, respSolicitudes] = await Promise.all([
          fetchAutenticado('/api/clientes', token),
          fetchAutenticado('/api/solicitudes', token),
        ]);

        if (!respClientes.ok || !respSolicitudes.ok) {
          if (!cancelado) setEstadoApoyo('error');
          return;
        }

        const dataClientes = (await respClientes.json()) as {
          clientes: { id: string; nombre: string; empresa: string | null; email: string | null }[];
        };
        const dataSolicitudes = (await respSolicitudes.json()) as { solicitudes: Solicitud[] };

        if (!cancelado) {
          const mapaClientes = new Map<string, ClienteResumen>();
          dataClientes.clientes.forEach((c) => mapaClientes.set(c.id, { nombre: c.nombre, empresa: c.empresa, email: c.email }));
          const mapaSolicitudes = new Map<string, Solicitud>();
          dataSolicitudes.solicitudes.forEach((s) => mapaSolicitudes.set(s.id, s));
          setClientesPorId(mapaClientes);
          setSolicitudesPorId(mapaSolicitudes);
          setEstadoApoyo('disponible');
        }
      } catch (err) {
        if (err instanceof SesionInvalidaError) {
          onSesionInvalida();
          return;
        }
        if (!cancelado) setEstadoApoyo('error');
      }
    }

    cargarApoyo();
    return () => {
      cancelado = true;
    };
  }, [token, onSesionInvalida]);

  // Identidad propia (GET /api/auth/me, ya existente) para representar
  // "Yo" en vez de un UUID. Solo se consulta fuera de ADMIN.
  useEffect(() => {
    if (esAdmin) return;
    let cancelado = false;
    obtenerMe(token)
      .then((u) => {
        if (!cancelado) setUsuarioActualId(u.id);
      })
      .catch((err) => {
        if (err instanceof SesionInvalidaError) {
          onSesionInvalida();
          return;
        }
        if (!cancelado) setUsuarioActualId(null);
      });
    return () => {
      cancelado = true;
    };
  }, [esAdmin, token, onSesionInvalida]);

  function nombreComercialAdmin(comercialId: string | null): string {
    if (!comercialId) return 'SIN ASIGNAR';
    if (estadoApoyo === 'cargando') return 'Cargando…';
    return usuariosPorId.get(comercialId) ?? '—';
  }

  function clienteResueltoAdmin(clienteId: string | null): ClienteResumen | null {
    if (!clienteId) return null;
    if (estadoApoyo !== 'disponible') return null;
    return clientesPorId.get(clienteId) ?? null;
  }

  function empresaAdmin(clienteId: string | null): string {
    const cliente = clienteResueltoAdmin(clienteId);
    return cliente?.empresa?.trim() ? cliente.empresa : '—';
  }

  function solicitudResueltaAdmin(solicitudId: string | null): Solicitud | null {
    if (!solicitudId) return null;
    if (estadoApoyo !== 'disponible') return null;
    return solicitudesPorId.get(solicitudId) ?? null;
  }

  // ---- Bloque 1 (detalle COMERCIAL): representación legible, sin UUID ----

  // COMERCIAL no puede resolver nombres de otros usuarios (/api/usuarios es
  // exclusivo de ADMIN) — nunca se inventa un nombre.
  function comercialMostrable(comercialId: string | null): string {
    if (!comercialId) return 'Sin asignar';
    if (usuarioActualId === undefined || usuarioActualId === null) return '—';
    return comercialId === usuarioActualId ? 'Yo' : 'Otro comercial';
  }

  function registradoPorMostrable(comercialId: string | null): string {
    if (!comercialId) return 'Desconocido';
    if (usuarioActualId === undefined || usuarioActualId === null) return '—';
    return comercialId === usuarioActualId ? 'Yo' : 'Otro comercial';
  }

  // Cliente para la bandeja COMERCIAL: nunca UUID; "Sin vincular" si no hay.
  function clienteMostrable(clienteId: string | null): string {
    if (!clienteId) return 'Sin vincular';
    const cliente = clienteResueltoAdmin(clienteId);
    if (cliente) return cliente.empresa?.trim() ? `${cliente.nombre} — ${cliente.empresa}` : cliente.nombre;
    return estadoApoyo === 'cargando' ? 'Cargando…' : '—';
  }

  function resumirTexto(texto: string, max: number): string {
    return texto.length > max ? `${texto.slice(0, max).trimEnd()}…` : texto;
  }

  function etiquetaCliente(c: ClienteResumen): string {
    return c.empresa?.trim() ? `${c.nombre} — ${c.empresa}` : c.nombre;
  }

  // Integridad Lead -> Cliente -> Solicitud (mismo criterio que valida el
  // backend con 409): si el lead ya tiene solicitud, el único cliente
  // compatible es el dueño de esa solicitud; si ya tiene cliente, el
  // selector de solicitudes solo muestra las de ese cliente.
  const clienteDeSolicitudVinculada = leadSeleccionado?.solicitud_id
    ? solicitudesPorId.get(leadSeleccionado.solicitud_id)?.cliente_id ?? null
    : null;
  const clienteDelLeadId = leadSeleccionado?.cliente_id ?? null;

  const clientesCandidatosVinculo = useMemo(() => {
    const termino = busquedaClienteVinculo.trim().toLowerCase();
    return Array.from(clientesPorId.entries())
      .map(([id, c]) => ({ id, ...c }))
      .filter((c) => !clienteDeSolicitudVinculada || c.id === clienteDeSolicitudVinculada)
      .filter(
        (c) =>
          !termino ||
          c.nombre.toLowerCase().includes(termino) ||
          (c.empresa?.toLowerCase().includes(termino) ?? false) ||
          (c.email?.toLowerCase().includes(termino) ?? false)
      );
  }, [clientesPorId, busquedaClienteVinculo, clienteDeSolicitudVinculada]);

  const solicitudesCandidatasVinculo = useMemo(() => {
    const termino = busquedaSolicitudVinculo.trim().toLowerCase();
    const todas: Solicitud[] = Array.from(solicitudesPorId.values());
    return todas
      .filter((s) => !clienteDelLeadId || s.cliente_id === clienteDelLeadId)
      .filter((s) => {
        if (!termino) return true;
        const cliente = clientesPorId.get(s.cliente_id);
        return (
          s.servicio.toLowerCase().includes(termino) ||
          s.descripcion.toLowerCase().includes(termino) ||
          s.estado.toLowerCase().includes(termino) ||
          new Date(s.creado_en).toLocaleDateString().includes(termino) ||
          (cliente?.nombre.toLowerCase().includes(termino) ?? false) ||
          (cliente?.empresa?.toLowerCase().includes(termino) ?? false)
        );
      })
      .sort((a, b) => new Date(b.creado_en).getTime() - new Date(a.creado_en).getTime());
  }, [solicitudesPorId, clientesPorId, busquedaSolicitudVinculo, clienteDelLeadId]);

  // Cotizaciones de la solicitud vinculada (solo lectura, endpoint existente).
  const solicitudDelLeadCaliente =
    leadSeleccionado && leadSeleccionado.clasificacion === 'CALIENTE' ? leadSeleccionado.solicitud_id : null;
  useEffect(() => {
    if (esAdmin || !solicitudDelLeadCaliente) {
      setCotizacionesLead(null);
      return;
    }
    let cancelado = false;
    setEstadoCotizacionesLead('cargando');
    (async () => {
      try {
        const response = await fetchAutenticado('/api/cotizaciones', token);
        if (!response.ok) throw new Error('cotizaciones');
        const data = (await response.json()) as { cotizaciones: CotizacionLead[] };
        if (cancelado) return;
        setCotizacionesLead(
          data.cotizaciones
            .filter((c) => c.solicitud_id === solicitudDelLeadCaliente)
            .sort((a, b) => new Date(b.creado_en).getTime() - new Date(a.creado_en).getTime())
        );
        setEstadoCotizacionesLead('disponible');
      } catch (err) {
        if (err instanceof SesionInvalidaError) {
          onSesionInvalida();
          return;
        }
        if (!cancelado) setEstadoCotizacionesLead('error');
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esAdmin, token, solicitudDelLeadCaliente]);

  const kpisAdmin = useMemo(() => {
    const base = { total: 0, FRIO: 0, TIBIO: 0, CALIENTE: 0, CONVERTIDO: 0, RECURRENTE: 0, activos: 0, descartados: 0 };
    if (!leads) return base;
    base.total = leads.length;
    for (const l of leads) {
      // El embudo por clasificación cuenta únicamente leads ACTIVO: un
      // descartado no altera esos conteos (solo el resumen por estado).
      if (l.estado === 'ACTIVO' && l.clasificacion in base) {
        (base as Record<string, number>)[l.clasificacion] += 1;
      }
      if (l.estado === 'DESCARTADO') base.descartados += 1;
      if (l.estado === 'ACTIVO') base.activos += 1;
    }
    return base;
  }, [leads]);

  const filtradasAdmin = useMemo(() => {
    if (!leads) return [];
    const termino = busquedaAdmin.trim().toLowerCase();

    return leads.filter((l) => {
      if (fuenteFiltroAdmin !== 'TODAS' && l.fuente !== fuenteFiltroAdmin) return false;
      if (clasificacionFiltroAdmin !== 'TODAS' && l.clasificacion !== clasificacionFiltroAdmin) return false;
      if (estadoFiltroAdmin !== 'TODOS' && l.estado !== estadoFiltroAdmin) return false;
      if (!fechaEnRangoLead(l.creado_en, fechaDesdeAdmin, fechaHastaAdmin)) return false;

      if (termino) {
        const empresa = empresaAdmin(l.cliente_id);
        const coincide =
          l.nombre.toLowerCase().includes(termino) ||
          (esAdmin && empresa !== '—' && empresa.toLowerCase().includes(termino)) ||
          l.telefono.toLowerCase().includes(termino) ||
          (l.email ?? '').toLowerCase().includes(termino);
        if (!coincide) return false;
      }

      return true;
    });
  }, [
    leads,
    busquedaAdmin,
    fuenteFiltroAdmin,
    clasificacionFiltroAdmin,
    estadoFiltroAdmin,
    fechaDesdeAdmin,
    fechaHastaAdmin,
    clientesPorId,
    estadoApoyo,
    esAdmin,
  ]);

  const ordenadasAdmin = useMemo(() => {
    const copia = [...filtradasAdmin];
    copia.sort((a, b) => {
      if (ordenPorAdmin === 'nombre_asc') return a.nombre.localeCompare(b.nombre);
      if (ordenPorAdmin === 'nombre_desc') return b.nombre.localeCompare(a.nombre);
      if (ordenPorAdmin === 'clasificacion') {
        return (ORDEN_CLASIFICACION[a.clasificacion] ?? 99) - (ORDEN_CLASIFICACION[b.clasificacion] ?? 99);
      }
      if (ordenPorAdmin === 'estado') {
        return (a.estado === 'ACTIVO' ? 0 : 1) - (b.estado === 'ACTIVO' ? 0 : 1);
      }
      const diferencia = new Date(a.creado_en).getTime() - new Date(b.creado_en).getTime();
      return ordenPorAdmin === 'recientes' ? -diferencia : diferencia;
    });
    return copia;
  }, [filtradasAdmin, ordenPorAdmin]);

  const totalPaginasAdmin = Math.max(1, Math.ceil(ordenadasAdmin.length / registrosPorPaginaAdmin));
  const paginaEfectivaAdmin = Math.min(paginaActualAdmin, totalPaginasAdmin);
  const datosPaginaAdmin = useMemo(() => {
    const inicio = (paginaEfectivaAdmin - 1) * registrosPorPaginaAdmin;
    return ordenadasAdmin.slice(inicio, inicio + registrosPorPaginaAdmin);
  }, [ordenadasAdmin, paginaEfectivaAdmin, registrosPorPaginaAdmin]);

  useEffect(() => {
    setPaginaActualAdmin(1);
  }, [busquedaAdmin, fuenteFiltroAdmin, clasificacionFiltroAdmin, estadoFiltroAdmin, fechaDesdeAdmin, fechaHastaAdmin, ordenPorAdmin, registrosPorPaginaAdmin]);

  function limpiarFiltrosAdmin() {
    setBusquedaAdmin('');
    setFuenteFiltroAdmin('TODAS');
    setClasificacionFiltroAdmin('TODAS');
    setEstadoFiltroAdmin('TODOS');
    setFechaDesdeAdmin('');
    setFechaHastaAdmin('');
    setOrdenPorAdmin('recientes');
  }

  const hayFiltrosActivosAdmin =
    busquedaAdmin.trim() !== '' ||
    fuenteFiltroAdmin !== 'TODAS' ||
    clasificacionFiltroAdmin !== 'TODAS' ||
    estadoFiltroAdmin !== 'TODOS' ||
    fechaDesdeAdmin !== '' ||
    fechaHastaAdmin !== '' ||
    ordenPorAdmin !== 'recientes';

  const paginasVisiblesAdmin = useMemo(() => {
    const paginas: (number | 'ellipsis')[] = [];
    const ventana = 1;
    for (let p = 1; p <= totalPaginasAdmin; p++) {
      if (p === 1 || p === totalPaginasAdmin || (p >= paginaEfectivaAdmin - ventana && p <= paginaEfectivaAdmin + ventana)) {
        paginas.push(p);
      } else if (paginas[paginas.length - 1] !== 'ellipsis') {
        paginas.push('ellipsis');
      }
    }
    return paginas;
  }, [totalPaginasAdmin, paginaEfectivaAdmin]);

  async function cargarSeguimientos(id: string) {
    setLoadingSeguimientos(true);
    try {
      const response = await fetchAutenticado(`/api/leads/${id}/seguimientos`, token);
      if (!response.ok) return;
      const data = (await response.json()) as { seguimientos: LeadSeguimiento[] };
      setSeguimientos(data.seguimientos);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    } finally {
      setLoadingSeguimientos(false);
    }
  }

  async function abrirDetalle(id: string) {
    setMensajeAccion(null);
    try {
      const response = await fetchAutenticado(`/api/leads/${id}`, token);
      if (!response.ok) return;
      const data = (await response.json()) as { lead: Lead };
      setLeadSeleccionado(data.lead);
      setClienteIdInput('');
      setSolicitudIdInput('');
      setBusquedaClienteVinculo('');
      setBusquedaSolicitudVinculo('');
      setSelectorVinculo(null);
      setMostrarSeguimientoExtra(false);
      setEnlaceSolicitud(null);
      setErrorEnlace(null);
      setEnlaceCopiado(false);
      setConfirmandoDescarte(false);
      setComercialElegido(data.lead.comercial_id ?? '');
      await cargarSeguimientos(id);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  async function patchLead(id: string, body: Record<string, unknown>, onExito?: (lead: Lead) => void) {
    setProcesando(true);
    setMensajeAccion(null);
    try {
      const response = await fetchAutenticado(`/api/leads/${id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMensajeAccion(data?.message || 'No se pudo actualizar el lead.');
        return;
      }
      setLeadSeleccionado(data.lead as Lead);
      onExito?.(data.lead as Lead);
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeAccion('No se pudo actualizar el lead.');
    } finally {
      setProcesando(false);
    }
  }

  async function handleVincularCliente(e: FormEvent) {
    e.preventDefault();
    if (!leadSeleccionado || !clienteIdInput.trim()) return;
    await patchLead(leadSeleccionado.id, { cliente_id: clienteIdInput.trim() }, () => {
      setClienteIdInput('');
      setBusquedaClienteVinculo('');
      setSelectorVinculo(null);
    });
  }

  async function handleVincularSolicitud(e: FormEvent) {
    e.preventDefault();
    if (!leadSeleccionado || !solicitudIdInput.trim()) return;
    await patchLead(leadSeleccionado.id, { solicitud_id: solicitudIdInput.trim() }, () => {
      setSolicitudIdInput('');
      setBusquedaSolicitudVinculo('');
      setSelectorVinculo(null);
    });
  }

  async function handleGenerarEnlace() {
    if (!leadSeleccionado) return;
    setGenerandoEnlace(true);
    setErrorEnlace(null);
    setEnlaceCopiado(false);
    try {
      const response = await fetchAutenticado(`/api/leads/${leadSeleccionado.id}/enlace-solicitud`, token, {
        method: 'POST',
      });
      const data = (await response.json().catch(() => null)) as {
        token?: string;
        expira_en?: string;
        message?: string;
      } | null;
      if (!response.ok || !data?.token || !data.expira_en) {
        setErrorEnlace(data?.message || 'No se pudo generar el enlace.');
        return;
      }
      setEnlaceSolicitud({
        url: `${window.location.origin}/solicitud/enlace/${encodeURIComponent(data.token)}`,
        expira_en: data.expira_en,
      });
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorEnlace('No se pudo generar el enlace.');
    } finally {
      setGenerandoEnlace(false);
    }
  }

  async function handleCopiarEnlace() {
    if (!enlaceSolicitud) return;
    try {
      await navigator.clipboard.writeText(enlaceSolicitud.url);
      setEnlaceCopiado(true);
      setErrorEnlace(null);
    } catch {
      setEnlaceCopiado(false);
      setErrorEnlace('No se pudo copiar automáticamente. Selecciona el enlace y cópialo manualmente.');
    }
  }

  async function handleMarcarRecurrente() {
    if (!leadSeleccionado) return;
    await patchLead(leadSeleccionado.id, { clasificacion: 'RECURRENTE' });
  }

  async function handleDescartar() {
    if (!leadSeleccionado) return;
    setConfirmandoDescarte(false);
    await patchLead(leadSeleccionado.id, { estado: 'DESCARTADO' });
  }

  async function handleRegistrarSeguimiento(e: FormEvent) {
    e.preventDefault();
    if (!leadSeleccionado) return;
    setProcesando(true);
    setMensajeAccion(null);
    try {
      const response = await fetchAutenticado(`/api/leads/${leadSeleccionado.id}/seguimientos`, token, {
        method: 'POST',
        body: JSON.stringify({
          tipo: tipoSeguimientoInput,
          observacion: observacionInput || undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMensajeAccion(data?.message || 'No se pudo registrar el seguimiento.');
        return;
      }
      setLeadSeleccionado(data.lead as Lead);
      setObservacionInput('');
      await cargarSeguimientos(leadSeleccionado.id);
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeAccion('No se pudo registrar el seguimiento.');
    } finally {
      setProcesando(false);
    }
  }

  async function handleAsignar(e: FormEvent) {
    e.preventDefault();
    if (!leadSeleccionado || !comercialElegido) return;
    setProcesando(true);
    setMensajeAccion(null);
    try {
      const response = await fetchAutenticado(`/api/leads/${leadSeleccionado.id}/asignar`, token, {
        method: 'PATCH',
        body: JSON.stringify({ comercial_id: comercialElegido }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMensajeAccion(data?.message || 'No se pudo asignar el comercial.');
        return;
      }
      setLeadSeleccionado(data.lead as Lead);
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeAccion('No se pudo asignar el comercial.');
    } finally {
      setProcesando(false);
    }
  }

  // Vista ADMIN — detalle exclusivamente de consulta + asignar comercial.
  // Ninguna acción comercial (vincular cliente/solicitud, registrar
  // seguimiento, marcar convertido/recurrente, descartar) se renderiza
  // aquí; el bloque existente más abajo (idéntico al de siempre) solo se
  // alcanza cuando esAdmin es false.
  if (leadSeleccionado && esAdmin) {
    const cliente = clienteResueltoAdmin(leadSeleccionado.cliente_id);
    const solicitud = solicitudResueltaAdmin(leadSeleccionado.solicitud_id);

    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setLeadSeleccionado(null);
            setMensajeAccion(null);
            setSeguimientos(null);
          }}
          className="mb-6 inline-flex items-center font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL LISTADO
        </button>

        <div className="bg-surface sharp-border p-6 space-y-5">
          <div className="flex justify-between items-start border-b border-outline pb-4">
            <h3 className="font-headline-md text-headline-md text-on-surface uppercase">{leadSeleccionado.nombre}</h3>
            <div className="flex flex-col items-end gap-1">
              <BadgeClasificacion valor={leadSeleccionado.clasificacion} />
              <BadgeEstadoLead valor={leadSeleccionado.estado} />
            </div>
          </div>

          <div>
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Lead</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-code-sm text-code-sm">
              <div>
                <dt className="text-on-surface-variant uppercase">Empresa</dt>
                <dd className="text-on-surface">{empresaAdmin(leadSeleccionado.cliente_id)}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Teléfono</dt>
                <dd className="text-on-surface">{leadSeleccionado.telefono}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Email</dt>
                <dd className="text-on-surface">{leadSeleccionado.email ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Fuente</dt>
                <dd className="text-on-surface">{leadSeleccionado.fuente}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Fecha de creación</dt>
                <dd className="text-on-surface">{new Date(leadSeleccionado.creado_en).toLocaleString()}</dd>
              </div>
            </dl>
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Comercial asignado</p>
            <p className="font-code-sm text-code-sm text-on-surface">{nombreComercialAdmin(leadSeleccionado.comercial_id)}</p>
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Cliente relacionado</p>
            {leadSeleccionado.cliente_id ? (
              cliente ? (
                <p className="font-code-sm text-code-sm text-on-surface">
                  {cliente.empresa?.trim() ? cliente.empresa : cliente.nombre}
                </p>
              ) : (
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">
                  {estadoApoyo === 'cargando' ? 'Cargando…' : '—'}
                </p>
              )
            ) : (
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">SIN VINCULAR</p>
            )}
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Solicitud relacionada</p>
            {leadSeleccionado.solicitud_id ? (
              solicitud ? (
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-code-sm text-code-sm">
                  <div>
                    <dt className="text-on-surface-variant uppercase">Servicio</dt>
                    <dd className="text-on-surface">{solicitud.servicio}</dd>
                  </div>
                  <div>
                    <dt className="text-on-surface-variant uppercase">Cantidad</dt>
                    <dd className="text-on-surface">{solicitud.cantidad}</dd>
                  </div>
                  <div>
                    <dt className="text-on-surface-variant uppercase">Estado de la solicitud</dt>
                    <dd className="text-on-surface">{solicitud.estado}</dd>
                  </div>
                </dl>
              ) : (
                <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">
                  {estadoApoyo === 'cargando' ? 'Cargando…' : '—'}
                </p>
              )
            ) : (
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">SIN VINCULAR</p>
            )}
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-3">Historial de seguimientos</p>
            {loadingSeguimientos && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO...</p>
            )}
            {!loadingSeguimientos && seguimientos && seguimientos.length === 0 && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Sin seguimientos registrados todavía.</p>
            )}
            {!loadingSeguimientos && seguimientos && seguimientos.length > 0 && (
              <div className="space-y-2">
                {[...seguimientos]
                  .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
                  .map((s) => (
                    <div key={s.id} className="bg-background border border-outline p-3">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-code-sm text-code-sm text-primary-container uppercase">{s.tipo}</span>
                        <span className="font-code-sm text-[10px] text-on-surface-variant uppercase">
                          {new Date(s.fecha).toLocaleString()}
                        </span>
                      </div>
                      {s.observacion && <p className="font-body-md text-body-md text-on-surface">{s.observacion}</p>}
                      <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-1">
                        Registrado por: {nombreComercialAdmin(s.comercial_id)}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-3">Asignación comercial</p>
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleAsignar}>
              <select
                value={comercialElegido}
                onChange={(e) => setComercialElegido(e.target.value)}
                className="bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none cursor-pointer"
              >
                <option value="">Seleccione un COMERCIAL activo</option>
                {(comerciales ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
              <button
                disabled={procesando || !comercialElegido}
                type="submit"
                className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
              >
                {procesando ? 'ASIGNANDO...' : 'ASIGNAR'}
              </button>
            </form>
            {mensajeAccion && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-3">{mensajeAccion}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Vista ADMIN — bandeja de solo supervisión. Sin ninguna acción
  // comercial en la tabla. La vista original (COMERCIAL, sin cambios) se
  // renderiza al final de este componente cuando esAdmin es false.
  if (esAdmin) {
    return (
      <div className="space-y-8">
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase max-w-2xl">
          Vista de supervisión: consulte el estado y evolución de los contactos comerciales registrados. Esta vista
          no permite vincular, registrar seguimientos, convertir ni descartar leads — esas acciones son
          responsabilidad de Comercial.
        </p>

        {loadingLista && (
          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO LEADS...</p>
        )}
        {!loadingLista && errorLista && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorLista}</p>}
        {!loadingLista && !errorLista && leads && leads.length === 0 && (
          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">NO HAY LEADS REGISTRADOS.</p>
        )}

        {!loadingLista && !errorLista && leads && leads.length > 0 && (
          <>
            <EmbudoKpis kpis={kpisAdmin} />

            {/* FILTROS */}
            <div className="bg-surface sharp-border p-5 space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_170px_220px_170px] gap-4">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                    search
                  </span>
                  <input
                    type="text"
                    value={busquedaAdmin}
                    onChange={(e) => setBusquedaAdmin(e.target.value)}
                    placeholder="Buscar por nombre, empresa, teléfono o email…"
                    className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                  />
                </div>
                <div className="relative">
                  <select
                    value={fuenteFiltroAdmin}
                    onChange={(e) => setFuenteFiltroAdmin(e.target.value as (typeof FUENTES_FILTRO)[number])}
                    className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    {FUENTES_FILTRO.map((f) => (
                      <option key={f} value={f}>
                        {f === 'TODAS' ? 'Fuente: Todas' : f}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                    expand_more
                  </span>
                </div>
                <div className="relative">
                  <select
                    value={clasificacionFiltroAdmin}
                    onChange={(e) => setClasificacionFiltroAdmin(e.target.value as (typeof CLASIFICACIONES_FILTRO)[number])}
                    className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    {CLASIFICACIONES_FILTRO.map((c) => (
                      <option key={c} value={c}>
                        {c === 'TODAS' ? 'Clasificación: Todas' : c}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                    expand_more
                  </span>
                </div>
                <div className="relative">
                  <select
                    value={estadoFiltroAdmin}
                    onChange={(e) => setEstadoFiltroAdmin(e.target.value as (typeof ESTADOS_FILTRO_LEAD)[number])}
                    className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    {ESTADOS_FILTRO_LEAD.map((e) => (
                      <option key={e} value={e}>
                        {e === 'TODOS' ? 'Estado: Todos' : e}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                    expand_more
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-[180px_180px_1fr_auto] gap-4 items-end">
                <div>
                  <label className="block font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase mb-1">
                    Fecha desde
                  </label>
                  <input
                    type="date"
                    value={fechaDesdeAdmin}
                    onChange={(e) => setFechaDesdeAdmin(e.target.value)}
                    className="w-full bg-background border border-outline px-3 py-2.5 text-on-surface text-sm font-code-sm focus:border-primary-container focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase mb-1">
                    Fecha hasta
                  </label>
                  <input
                    type="date"
                    value={fechaHastaAdmin}
                    onChange={(e) => setFechaHastaAdmin(e.target.value)}
                    className="w-full bg-background border border-outline px-3 py-2.5 text-on-surface text-sm font-code-sm focus:border-primary-container focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase mb-1">
                    Ordenar por
                  </label>
                  <div className="relative">
                  <select
                    value={ordenPorAdmin}
                    onChange={(e) => setOrdenPorAdmin(e.target.value as OrdenPorLead)}
                    className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    <option value="recientes">Más recientes</option>
                    <option value="antiguos">Más antiguas</option>
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                    expand_more
                  </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={limpiarFiltrosAdmin}
                  disabled={!hayFiltrosActivosAdmin}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                >
                  <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                  LIMPIAR FILTROS
                </button>
              </div>
            </div>

            {/* TABLA — desktop */}
            <div className="hidden md:block overflow-x-auto bg-surface sharp-border">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline">
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Lead</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Empresa</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Fuente</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Clasificación</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Estado</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Comercial</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Creado</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase text-right">
                      Acción
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {datosPaginaAdmin.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 px-4 text-center font-code-sm text-code-sm text-on-surface-variant uppercase">
                        Ningún resultado coincide con estos filtros.
                      </td>
                    </tr>
                  )}
                  {datosPaginaAdmin.map((l) => (
                    <tr key={l.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                      <td className="py-3 px-4 font-body-md text-body-md text-on-surface">{l.nombre}</td>
                      <td className="py-3 px-4 font-body-md text-body-md text-on-surface">{empresaAdmin(l.cliente_id)}</td>
                      <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant uppercase">{l.fuente}</td>
                      <td className="py-3 px-4">
                        <BadgeClasificacion valor={l.clasificacion} />
                      </td>
                      <td className="py-3 px-4">
                        <BadgeEstadoLead valor={l.estado} />
                      </td>
                      <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                        {nombreComercialAdmin(l.comercial_id)}
                      </td>
                      <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                        {new Date(l.creado_en).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => abrirDetalle(l.id)}
                          className="inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                        >
                          VER
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* TABLA — mobile (tarjetas) */}
            <div className="md:hidden space-y-3">
              {datosPaginaAdmin.length === 0 && (
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase text-center py-6">
                  Ningún resultado coincide con estos filtros.
                </p>
              )}
              {datosPaginaAdmin.map((l) => (
                <div key={l.id} className="bg-surface sharp-border border-l-4 border-l-primary-container p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-body-md text-body-md text-on-surface font-medium">{l.nombre}</p>
                      <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-0.5">
                        {empresaAdmin(l.cliente_id)} · {l.fuente}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <BadgeClasificacion valor={l.clasificacion} />
                      <BadgeEstadoLead valor={l.estado} />
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 font-code-sm text-[11px]">
                    <div>
                      <dt className="text-on-surface-variant uppercase">Comercial</dt>
                      <dd className="text-on-surface">{nombreComercialAdmin(l.comercial_id)}</dd>
                    </div>
                    <div>
                      <dt className="text-on-surface-variant uppercase">Creado</dt>
                      <dd className="text-on-surface">{new Date(l.creado_en).toLocaleDateString()}</dd>
                    </div>
                  </dl>

                  <div className="flex items-center justify-end pt-1 border-t border-outline">
                    <button
                      type="button"
                      onClick={() => abrirDetalle(l.id)}
                      className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                    >
                      VER
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* PAGINACIÓN */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-surface sharp-border p-4">
              <div className="flex items-center gap-3">
                <span className="font-code-sm text-[11px] text-on-surface-variant uppercase">
                  Mostrando {ordenadasAdmin.length === 0 ? 0 : (paginaEfectivaAdmin - 1) * registrosPorPaginaAdmin + 1}–
                  {Math.min(paginaEfectivaAdmin * registrosPorPaginaAdmin, ordenadasAdmin.length)} de{' '}
                  {ordenadasAdmin.length} leads
                </span>
                <div className="relative">
                  <select
                    value={registrosPorPaginaAdmin}
                    onChange={(e) => setRegistrosPorPaginaAdmin(Number(e.target.value))}
                    className="appearance-none bg-background border border-outline pl-3 pr-11 py-1.5 text-on-surface text-xs font-code-sm focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    {REGISTROS_POR_PAGINA_OPCIONES_LEAD.map((n) => (
                      <option key={n} value={n}>
                        {n} por página
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant">
                    expand_more
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={paginaEfectivaAdmin <= 1}
                  onClick={() => setPaginaActualAdmin(paginaEfectivaAdmin - 1)}
                  className="inline-flex items-center justify-center w-8 h-8 border border-outline text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                </button>

                {paginasVisiblesAdmin.map((p, idx) =>
                  p === 'ellipsis' ? (
                    <span key={`ellipsis-${idx}`} className="px-1 font-code-sm text-on-surface-variant">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPaginaActualAdmin(p)}
                      className={`inline-flex items-center justify-center w-8 h-8 font-code-sm text-xs transition-colors cursor-pointer ${
                        p === paginaEfectivaAdmin
                          ? 'bg-primary-container text-on-primary-container'
                          : 'border border-outline text-on-surface hover:bg-surface-container-high'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}

                <button
                  type="button"
                  disabled={paginaEfectivaAdmin >= totalPaginasAdmin}
                  onClick={() => setPaginaActualAdmin(paginaEfectivaAdmin + 1)}
                  className="inline-flex items-center justify-center w-8 h-8 border border-outline text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Vista COMERCIAL — detalle con vinculación guiada Cliente -> Solicitud -> Confirmación.
  if (leadSeleccionado) {
    const clienteVinculado = clienteResueltoAdmin(leadSeleccionado.cliente_id);
    const solicitudVinculada = solicitudResueltaAdmin(leadSeleccionado.solicitud_id);
    const clienteElegido = clienteIdInput ? clientesPorId.get(clienteIdInput) ?? null : null;
    const solicitudElegida = solicitudIdInput ? solicitudesPorId.get(solicitudIdInput) ?? null : null;
    const descartado = leadSeleccionado.estado === 'DESCARTADO';
    // Espejo visual del bloqueo de backend: CONVERTIDO y RECURRENTE ya no
    // admiten cambiar cliente ni solicitud (DESCARTADO oculta todo el bloque).
    const vinculosBloqueados =
      leadSeleccionado.clasificacion === 'CONVERTIDO' || leadSeleccionado.clasificacion === 'RECURRENTE';
    const clienteTieneSolicitudes = leadSeleccionado.cliente_id
      ? (Array.from(solicitudesPorId.values()) as Solicitud[]).some((sol) => sol.cliente_id === leadSeleccionado.cliente_id)
      : true;

    // ---- Vinculación (solo presentación) ----
    // La integridad Cliente <-> Solicitud la valida el backend (409); aquí
    // solo se muestra la relación y se ofrece el selector necesario.
    const tieneCliente = Boolean(leadSeleccionado.cliente_id);
    const tieneSolicitud = Boolean(leadSeleccionado.solicitud_id);
    const bloqueado = descartado || vinculosBloqueados;
    const motivoBloqueo = descartado ? 'DESCARTADO' : leadSeleccionado.clasificacion;
    const textoCargando = estadoApoyo === 'cargando' ? 'Cargando…' : '—';
    const textoCliente = !tieneCliente
      ? 'Sin cliente'
      : clienteVinculado
        ? etiquetaCliente(clienteVinculado)
        : textoCargando;
    const textoSolicitud = !tieneSolicitud
      ? 'Sin solicitud'
      : solicitudVinculada
        ? solicitudVinculada.servicio
        : textoCargando;
    const clienteDeSolicitudElegida = solicitudElegida ? clientesPorId.get(solicitudElegida.cliente_id) ?? null : null;
    const textoClienteDeSolicitudElegida = clienteDeSolicitudElegida
      ? etiquetaCliente(clienteDeSolicitudElegida)
      : textoCargando;

    const cerrarSelector = () => {
      setClienteIdInput('');
      setSolicitudIdInput('');
      setBusquedaClienteVinculo('');
      setBusquedaSolicitudVinculo('');
      setSelectorVinculo(null);
    };

    const filaVinculo = (etiqueta: string, valor: string) => (
      <div>
        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase">{etiqueta}</p>
        <p className="font-body-md text-sm text-on-surface">{valor}</p>
      </div>
    );

    const cajaBuscador = (valor: string, alCambiar: (v: string) => void, placeholder: string) => (
      <div className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
          search
        </span>
        <input
          type="text"
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
        />
      </div>
    );

    const claseFilaLista = (activa: boolean) =>
      `w-full text-left p-3 transition-colors cursor-pointer flex items-start justify-between gap-3 ${
        activa ? 'bg-primary-container/10' : 'hover:bg-surface-container-high'
      }`;

    // Lista de clientes (solo para leads sin cliente).
    const listaClientes = (
      <div className="space-y-2">
        {cajaBuscador(busquedaClienteVinculo, setBusquedaClienteVinculo, 'Buscar cliente por nombre, empresa o email…')}
        <div className="max-h-48 overflow-y-auto border border-outline divide-y divide-outline">
          {estadoApoyo === 'cargando' && (
            <p className="p-3 font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Cargando clientes…</p>
          )}
          {estadoApoyo === 'error' && (
            <p className="p-3 font-['Inter'] text-[13px] font-normal text-error uppercase">No se pudieron cargar los clientes.</p>
          )}
          {estadoApoyo === 'disponible' && clientesCandidatosVinculo.length === 0 && (
            <p className="p-3 font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Ningún cliente coincide.</p>
          )}
          {estadoApoyo === 'disponible' &&
            clientesCandidatosVinculo.slice(0, 20).map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={clienteIdInput === c.id}
                onClick={() => setClienteIdInput(c.id)}
                className={claseFilaLista(clienteIdInput === c.id)}
              >
                <span>
                  <span className="block font-body-md text-sm text-on-surface">{etiquetaCliente(c)}</span>
                  {c.email && <span className="block font-code-sm text-[11px] text-on-surface-variant">{c.email}</span>}
                </span>
                {clienteIdInput === c.id && (
                  <span className="material-symbols-outlined text-[18px] text-primary-container" aria-hidden="true">
                    check
                  </span>
                )}
              </button>
            ))}
        </div>
      </div>
    );

    // Lista de solicitudes: servicio, estado y fecha. Con cliente vinculado
    // solo aparecen las de ese cliente (y no la ya vinculada); sin cliente se
    // añade el nombre del cliente para distinguirlas.
    const solicitudesLista = solicitudesCandidatasVinculo.filter((s) => s.id !== leadSeleccionado.solicitud_id);
    const listaSolicitudes = (
      <div className="space-y-2">
        {cajaBuscador(busquedaSolicitudVinculo, setBusquedaSolicitudVinculo, 'Buscar solicitud…')}
        <div className="max-h-56 overflow-y-auto border border-outline divide-y divide-outline">
          {estadoApoyo === 'cargando' && (
            <p className="p-3 font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Cargando solicitudes…</p>
          )}
          {estadoApoyo === 'error' && (
            <p className="p-3 font-['Inter'] text-[13px] font-normal text-error uppercase">No se pudieron cargar las solicitudes.</p>
          )}
          {estadoApoyo === 'disponible' && solicitudesLista.length === 0 && (
            <p className="p-3 font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
              {busquedaSolicitudVinculo.trim()
                ? 'Ninguna solicitud coincide.'
                : tieneCliente
                  ? 'No hay otras solicitudes de este cliente.'
                  : 'No hay solicitudes.'}
            </p>
          )}
          {estadoApoyo === 'disponible' &&
            solicitudesLista.slice(0, 20).map((s) => {
              const cli = clientesPorId.get(s.cliente_id);
              const activa = solicitudIdInput === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={activa}
                  onClick={() => setSolicitudIdInput(s.id)}
                  className={claseFilaLista(activa)}
                >
                  <span>
                    <span className="block font-body-md text-sm text-on-surface">{s.servicio}</span>
                    {!tieneCliente && cli && (
                      <span className="block font-code-sm text-[11px] text-on-surface-variant">{etiquetaCliente(cli)}</span>
                    )}
                    <span className="block font-code-sm text-[10px] text-on-surface-variant uppercase mt-0.5">
                      {s.estado} · {new Date(s.creado_en).toLocaleDateString()}
                    </span>
                  </span>
                  {activa && (
                    <span className="material-symbols-outlined text-[18px] text-primary-container" aria-hidden="true">
                      check
                    </span>
                  )}
                </button>
              );
            })}
        </div>
      </div>
    );

    const botonesConfirmar = (textoConfirmar: string, habilitado: boolean) => (
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={procesando}
          onClick={cerrarSelector}
          className="px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
        >
          CANCELAR
        </button>
        <button
          type="submit"
          disabled={procesando || !habilitado}
          className="px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
        >
          {textoConfirmar}
        </button>
      </div>
    );

    const botonSecundario = (texto: string, alClick: () => void) => (
      <button
        type="button"
        onClick={alClick}
        className="px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
      >
        {texto}
      </button>
    );

    const esFrioActivo = leadSeleccionado.estado === 'ACTIVO' && leadSeleccionado.clasificacion === 'FRIO';
    const esCalienteActivo = leadSeleccionado.estado === 'ACTIVO' && leadSeleccionado.clasificacion === 'CALIENTE';
    const esTibioActivo = leadSeleccionado.estado === 'ACTIVO' && leadSeleccionado.clasificacion === 'TIBIO';
    const fueraDeGestion = !descartado && vinculosBloqueados; // CONVERTIDO o RECURRENTE
    // Un lead CALIENTE cuya solicitud ya tiene cotización no puede cambiar de
    // solicitud desde el lead (protección de interfaz). Mientras se comprueba
    // (o si la consulta falla) no se ofrece el cambio.
    const cotizacionProtegeVinculo =
      esCalienteActivo && estadoCotizacionesLead === 'disponible' && (cotizacionesLead?.length ?? 0) > 0;
    const comprobandoCotizacion = esCalienteActivo && tieneSolicitud && estadoCotizacionesLead !== 'disponible';

    // Formulario de seguimiento (único; se ubica según el estado del lead).
    const formSeguimiento = (destacado: boolean) => (
      <form className="space-y-3" onSubmit={handleRegistrarSeguimiento}>
        <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
          <select
            value={tipoSeguimientoInput}
            onChange={(e) => setTipoSeguimientoInput(e.target.value)}
            aria-label="Tipo de contacto"
            className="w-full bg-background border border-outline text-on-surface px-3 py-2.5 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none cursor-pointer"
          >
            {TIPOS_SEGUIMIENTO.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <textarea
            value={observacionInput}
            onChange={(e) => setObservacionInput(e.target.value)}
            placeholder="Observación del contacto"
            aria-label="Observación del contacto"
            rows={2}
            className="w-full bg-background border border-outline text-on-surface px-3 py-2 focus:border-primary-container transition-colors font-body-md text-sm resize-none outline-none"
          />
        </div>
        <button
          disabled={procesando}
          type="submit"
          className={`px-4 py-2 font-['Inter'] text-[14px] font-semibold transition-colors disabled:opacity-50 cursor-pointer ${
            destacado
              ? 'bg-primary-container text-on-primary-container hover:bg-primary-fixed-dim'
              : 'border border-outline text-on-surface hover:bg-surface-container-high'
          }`}
        >
          REGISTRAR CONTACTO
        </button>
      </form>
    );

    // Panel principal: la acción que corresponde a la etapa actual del lead.
    const panelPrincipal = (
      icono: string,
      titulo: string,
      cuerpo: ReactNode,
      variante: 'accion' | 'neutro' = 'accion'
    ) => (
      <div
        className={`p-4 sm:p-5 space-y-3 border ${
          variante === 'accion'
            ? 'border-primary-container bg-primary-container/5'
            : 'border-outline bg-surface-container-high'
        }`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`material-symbols-outlined text-[22px] ${variante === 'accion' ? 'text-primary-container' : 'text-on-surface-variant'}`}
            aria-hidden="true"
          >
            {icono}
          </span>
          <h4 className="font-label-caps text-label-caps text-on-surface uppercase">{titulo}</h4>
        </div>
        {cuerpo}
      </div>
    );

    let principal: ReactNode;
    if (descartado) {
      principal = panelPrincipal(
        'lock',
        'Modo consulta',
        <p className="font-body-md text-sm text-on-surface-variant">
          Lead descartado: la gestión está bloqueada. Solo puedes consultar la información y el historial.
        </p>,
        'neutro'
      );
    } else if (fueraDeGestion) {
      principal = panelPrincipal(
        leadSeleccionado.clasificacion === 'CONVERTIDO' ? 'check_circle' : 'autorenew',
        leadSeleccionado.clasificacion === 'CONVERTIDO' ? 'Lead convertido' : 'Relación posterior',
        <p className="font-body-md text-sm text-on-surface-variant">
          {leadSeleccionado.clasificacion === 'CONVERTIDO'
            ? 'Ya no es un prospecto en gestión normal: sale del flujo de leads.'
            : 'Relación posterior ya existente con el cliente. Ya no es un prospecto en gestión normal.'}
        </p>,
        'neutro'
      );
    } else if (esFrioActivo) {
      principal = panelPrincipal(
        'edit_note',
        'Registra un seguimiento',
        <>
          <p className="font-body-md text-sm text-on-surface-variant">
            Al registrar el primer contacto, el lead avanza a TIBIO.
          </p>
          {formSeguimiento(true)}
        </>
      );
    } else if (esTibioActivo) {
      principal = panelPrincipal(
        'add_link',
        'Enlace de solicitud',
        <>
          <p className="font-body-md text-sm text-on-surface-variant">
            El prospecto completa su solicitud desde el enlace y el lead pasa a CALIENTE. Válido 7 días y de un solo
            uso.
          </p>
          {!enlaceSolicitud ? (
            <button
              type="button"
              disabled={generandoEnlace}
              onClick={handleGenerarEnlace}
              className="px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
            >
              {generandoEnlace ? 'GENERANDO...' : 'GENERAR ENLACE DE SOLICITUD'}
            </button>
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                readOnly
                value={enlaceSolicitud.url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Enlace de solicitud"
                className="w-full bg-background border border-outline px-3 py-2.5 text-on-surface text-xs font-code-sm focus:border-primary-container focus:outline-hidden"
              />
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                Vigente hasta el {new Date(enlaceSolicitud.expira_en).toLocaleString()}. Cópialo y envíalo tú al
                prospecto: el sistema no lo envía.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleCopiarEnlace}
                  className="px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors cursor-pointer"
                >
                  COPIAR ENLACE
                </button>
                <button
                  type="button"
                  disabled={generandoEnlace}
                  onClick={handleGenerarEnlace}
                  className="px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {generandoEnlace ? 'GENERANDO...' : 'REGENERAR ENLACE'}
                </button>
              </div>
              {enlaceCopiado && (
                <p className="font-['Inter'] text-[13px] font-normal text-primary-container uppercase" role="status">
                  Enlace copiado.
                </p>
              )}
            </div>
          )}
          {errorEnlace && (
            <p className="font-['Inter'] text-[13px] font-normal text-error" role="alert">
              {errorEnlace}
            </p>
          )}
        </>
      );
    } else if (esCalienteActivo) {
      principal = panelPrincipal(
        'description',
        'Solicitud en curso',
        <>
          {tieneSolicitud ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {filaVinculo('Servicio', textoSolicitud)}
              {filaVinculo('Estado de la solicitud', solicitudVinculada ? solicitudVinculada.estado : textoCargando)}
              {filaVinculo(
                'Recibida',
                solicitudVinculada ? new Date(solicitudVinculada.creado_en).toLocaleDateString() : textoCargando
              )}
            </div>
          ) : (
            <p className="font-body-md text-sm text-on-surface-variant">Continúa el flujo de solicitud y cotización.</p>
          )}

          {tieneSolicitud && estadoCotizacionesLead === 'cargando' && (
            <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Cargando cotización…</p>
          )}
          {tieneSolicitud && estadoCotizacionesLead === 'error' && (
            <p className="font-['Inter'] text-[13px] font-normal text-error">No se pudo cargar la cotización.</p>
          )}
          {tieneSolicitud &&
            estadoCotizacionesLead === 'disponible' &&
            cotizacionesLead &&
            cotizacionesLead.length > 0 && (
              <div className="border-t border-outline pt-3 space-y-2">
                <p className="font-label-caps text-[10px] text-on-surface-variant uppercase">Cotización</p>
                {cotizacionesLead.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 bg-background border border-outline p-3"
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
                      <span
                        className={`inline-flex px-2 py-0.5 font-code-sm text-[10px] uppercase ${CLASE_ESTADO_COTIZACION[c.estado] ?? 'border border-outline text-on-surface-variant'}`}
                      >
                        {c.estado}
                      </span>
                      <span className="font-code-sm text-sm text-on-surface">
                        $
                        {Number(c.total ?? c.valor).toLocaleString('es-EC', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                      <span className="font-code-sm text-[11px] text-on-surface-variant">
                        {new Date(c.creado_en).toLocaleDateString()}
                      </span>
                    </div>
                    {onVerCotizacion && (
                      <button
                        type="button"
                        onClick={() => onVerCotizacion(c.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                      >
                        VER COTIZACIÓN
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                          chevron_right
                        </span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
        </>
      );
    }

    // Pipeline de clasificación: solo posición actual en el flujo aprobado.
    const ETAPAS = [
      { clave: 'FRIO', etiqueta: 'Frío', icono: 'ac_unit', paso: 'Seguimiento' },
      { clave: 'TIBIO', etiqueta: 'Tibio', icono: 'thermostat', paso: 'Enlace de solicitud' },
      { clave: 'CALIENTE', etiqueta: 'Caliente', icono: 'local_fire_department', paso: 'Cotización aceptada' },
      { clave: 'CONVERTIDO', etiqueta: 'Convertido', icono: 'check_circle', paso: '' },
    ];
    const idxActual =
      leadSeleccionado.clasificacion === 'RECURRENTE'
        ? ETAPAS.length
        : ETAPAS.findIndex((e) => e.clave === leadSeleccionado.clasificacion);

    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setLeadSeleccionado(null);
            setMensajeAccion(null);
            setSeguimientos(null);
            setConfirmandoDescarte(false);
          }}
          className="mb-6 inline-flex items-center font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL LISTADO
        </button>

        <div className="bg-surface sharp-border p-4 sm:p-6 space-y-6">
          {/* Cabecera: nombre + clasificación y estado */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <h3 className="font-headline-md text-headline-md text-on-surface uppercase break-words min-w-0">
              {leadSeleccionado.nombre}
            </h3>
            <div className="flex flex-wrap gap-2 shrink-0">
              <BadgeClasificacion valor={leadSeleccionado.clasificacion} />
              <BadgeEstadoLead valor={leadSeleccionado.estado} />
            </div>
          </div>

          {/* Flujo: FRIO -> TIBIO -> CALIENTE -> CONVERTIDO (RECURRENTE, posterior) */}
          <ol
            aria-label="Etapa del lead en el flujo comercial"
            className={`flex items-center border-y border-outline py-3 ${descartado ? 'opacity-50' : ''}`}
          >
            {ETAPAS.map((etapa, i) => {
              const actual = i === idxActual;
              const pasada = i < idxActual;
              return (
                <li key={etapa.clave} className={`flex items-center ${i < ETAPAS.length - 1 ? 'flex-1' : ''}`}>
                  <span
                    aria-current={actual ? 'step' : undefined}
                    title={etapa.etiqueta}
                    className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 border font-code-sm text-[10px] uppercase ${
                      actual
                        ? 'border-primary-container bg-primary-container text-on-primary-container'
                        : pasada
                          ? 'border-outline-variant text-on-surface'
                          : 'border-outline text-on-surface-variant/60'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                      {pasada ? 'check' : etapa.icono}
                    </span>
                    <span className={actual ? '' : 'hidden sm:inline'}>{etapa.etiqueta}</span>
                  </span>
                  {i < ETAPAS.length - 1 && (
                    <span className="flex-1 flex flex-col items-center px-1 min-w-0">
                      <span className="hidden md:block font-code-sm text-[9px] uppercase text-on-surface-variant/70 leading-none mb-1 truncate max-w-full">
                        {etapa.paso}
                      </span>
                      <span className={`block h-px w-full ${pasada ? 'bg-outline-variant' : 'bg-outline'}`} />
                    </span>
                  )}
                </li>
              );
            })}
            {leadSeleccionado.clasificacion === 'RECURRENTE' && (
              <li className="flex items-center pl-2">
                <span
                  aria-current="step"
                  className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 border border-tertiary-container bg-tertiary-container text-on-primary-container font-code-sm text-[10px] uppercase"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                    autorenew
                  </span>
                  Recurrente
                </span>
              </li>
            )}
          </ol>

          {mensajeAccion && (
            <div role="alert" className="flex items-start gap-2 border border-error bg-error-container/20 p-3">
              <span className="material-symbols-outlined text-[18px] text-error shrink-0" aria-hidden="true">
                error
              </span>
              <p className="font-body-md text-sm text-error">{mensajeAccion}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-[auto_1fr] gap-x-8 gap-y-6">
            {/* ACCIÓN PRINCIPAL (según etapa) */}
            <div className="lg:col-start-2 lg:row-start-1 min-w-0">{principal}</div>

            {/* INFORMACIÓN + VINCULACIÓN */}
            <div className="lg:col-start-1 lg:row-start-1 lg:row-span-2 min-w-0 space-y-6 lg:border-r lg:border-outline lg:pr-8">
              <section className="space-y-3">
                <TituloSeccion icono="person">Información del lead</TituloSeccion>
                <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-4 font-code-sm text-code-sm">
                  <div className="min-w-0">
                    <dt className="text-on-surface-variant uppercase text-[10px]">Teléfono</dt>
                    <dd className="text-on-surface break-words">{leadSeleccionado.telefono}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-on-surface-variant uppercase text-[10px]">Email</dt>
                    <dd className="text-on-surface break-all">{leadSeleccionado.email ?? 'No especificado'}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-on-surface-variant uppercase text-[10px]">Fuente</dt>
                    <dd className="text-on-surface">{leadSeleccionado.fuente}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-on-surface-variant uppercase text-[10px]">Comercial asignado</dt>
                    <dd className="text-on-surface">{comercialMostrable(leadSeleccionado.comercial_id)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-on-surface-variant uppercase text-[10px]">Creado</dt>
                    <dd className="text-on-surface">{new Date(leadSeleccionado.creado_en).toLocaleDateString()}</dd>
                  </div>
                </dl>
              </section>

              <section className="border-t border-outline pt-6 space-y-3">
                <TituloSeccion icono="link">Vinculación</TituloSeccion>

                {bloqueado && (
                  <div className="border border-outline bg-surface-container-high p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-[20px] text-on-surface" aria-hidden="true">
                        lock
                      </span>
                      <div>
                        <p className="font-label-caps text-[11px] text-on-surface uppercase">Vinculación protegida</p>
                        <p className="font-body-md text-sm text-on-surface-variant">
                          No puede modificarse porque el Lead está {motivoBloqueo}.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {filaVinculo('Cliente', textoCliente)}
                      {filaVinculo('Solicitud', textoSolicitud)}
                    </div>
                  </div>
                )}

                {/* Con cliente y solicitud */}
                {!bloqueado && tieneCliente && tieneSolicitud && cotizacionProtegeVinculo && (
                  <div className="border border-outline bg-surface-container-high p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-[20px] text-on-surface" aria-hidden="true">
                        lock
                      </span>
                      <div>
                        <p className="font-label-caps text-[11px] text-on-surface uppercase">Vinculación protegida</p>
                        <p className="font-body-md text-sm text-on-surface-variant">
                          Esta solicitud tiene una cotización asociada y no puede cambiarse desde el Lead.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {filaVinculo('Cliente', textoCliente)}
                      {filaVinculo('Solicitud', textoSolicitud)}
                    </div>
                  </div>
                )}
                {!bloqueado && tieneCliente && tieneSolicitud && !cotizacionProtegeVinculo && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3">
                      {filaVinculo('Cliente', textoCliente)}
                      {filaVinculo('Solicitud', textoSolicitud)}
                    </div>
                    {comprobandoCotizacion ? (
                      <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                        {estadoCotizacionesLead === 'error'
                          ? 'No se pudo comprobar la cotización de la solicitud.'
                          : 'Comprobando cotización…'}
                      </p>
                    ) : selectorVinculo !== 'solicitud' ? (
                      botonSecundario('CAMBIAR SOLICITUD', () => setSelectorVinculo('solicitud'))
                    ) : (
                      <form className="space-y-3 border-t border-outline pt-3" onSubmit={handleVincularSolicitud}>
                        <p className="font-label-caps text-[11px] text-on-surface uppercase">Cambiar solicitud</p>
                        <p className="font-body-md text-sm text-on-surface-variant">
                          Selecciona una nueva solicitud de este cliente.
                        </p>
                        {listaSolicitudes}
                        {botonesConfirmar('CONFIRMAR CAMBIO', Boolean(solicitudElegida))}
                      </form>
                    )}
                  </div>
                )}

                {/* Con cliente, sin solicitud */}
                {!bloqueado && tieneCliente && !tieneSolicitud && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3">
                      {filaVinculo('Cliente', textoCliente)}
                      {filaVinculo('Solicitud', 'Sin solicitud vinculada')}
                    </div>
                    {esTibioActivo ? (
                      <p className="font-body-md text-sm text-on-surface-variant">
                        La solicitud se vinculará automáticamente cuando el prospecto use tu enlace.
                      </p>
                    ) : esFrioActivo ? null : estadoApoyo === 'disponible' && !clienteTieneSolicitudes ? (
                      <p className="font-body-md text-sm text-on-surface-variant">
                        Este cliente no tiene solicitudes registradas.
                      </p>
                    ) : selectorVinculo !== 'solicitud' ? (
                      botonSecundario('VINCULAR SOLICITUD EXISTENTE', () => setSelectorVinculo('solicitud'))
                    ) : (
                      <form className="space-y-3 border-t border-outline pt-3" onSubmit={handleVincularSolicitud}>
                        <p className="font-label-caps text-[11px] text-on-surface uppercase">
                          Vincular solicitud existente
                        </p>
                        <p className="font-body-md text-sm text-on-surface-variant">
                          Solo se muestran las solicitudes de este cliente.
                        </p>
                        {listaSolicitudes}
                        {botonesConfirmar('CONFIRMAR VINCULACIÓN', Boolean(solicitudElegida))}
                      </form>
                    )}
                  </div>
                )}

                {/* Sin cliente */}
                {!bloqueado && !tieneCliente && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3">
                      {filaVinculo('Cliente', 'Sin cliente vinculado')}
                      {filaVinculo('Solicitud', 'Sin solicitud vinculada')}
                    </div>
                    {selectorVinculo === null && (
                      <>
                        {esFrioActivo ? (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-body-md text-sm text-on-surface-variant">
                              Opcional: ¿este contacto ya es un cliente registrado?
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectorVinculo('cliente')}
                              className="font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-on-surface underline underline-offset-4 cursor-pointer"
                            >
                              VINCULAR CLIENTE EXISTENTE
                            </button>
                          </div>
                        ) : (
                          <>
                            <p className="font-body-md text-sm text-on-surface-variant">
                              {esTibioActivo
                                ? 'El cliente y la solicitud se vincularán automáticamente cuando el prospecto use tu enlace. ¿El cliente ya existe en el sistema?'
                                : '¿Este contacto ya existe en el sistema?'}
                            </p>
                            <div className="flex flex-wrap gap-3">
                              {botonSecundario('VINCULAR CLIENTE EXISTENTE', () => setSelectorVinculo('cliente'))}
                              {!esTibioActivo &&
                                botonSecundario('VINCULAR SOLICITUD EXISTENTE', () => setSelectorVinculo('solicitud'))}
                            </div>
                          </>
                        )}
                      </>
                    )}
                    {selectorVinculo === 'cliente' && (
                      <form className="space-y-3 border-t border-outline pt-3" onSubmit={handleVincularCliente}>
                        <p className="font-label-caps text-[11px] text-on-surface uppercase">
                          Vincular cliente existente
                        </p>
                        {listaClientes}
                        {clienteElegido && filaVinculo('Cliente que se vinculará', etiquetaCliente(clienteElegido))}
                        {botonesConfirmar('CONFIRMAR VINCULACIÓN', Boolean(clienteElegido))}
                      </form>
                    )}
                    {selectorVinculo === 'solicitud' && (
                      <form className="space-y-3 border-t border-outline pt-3" onSubmit={handleVincularSolicitud}>
                        <p className="font-label-caps text-[11px] text-on-surface uppercase">
                          Vincular solicitud existente
                        </p>
                        <p className="font-body-md text-sm text-on-surface-variant">
                          El cliente se toma de la solicitud elegida.
                        </p>
                        {listaSolicitudes}
                        {solicitudElegida && (
                          <div className="grid grid-cols-1 gap-3">
                            {filaVinculo('Solicitud', solicitudElegida.servicio)}
                            {filaVinculo('Cliente que se vinculará', textoClienteDeSolicitudElegida)}
                          </div>
                        )}
                        {botonesConfirmar('CONFIRMAR VINCULACIÓN', Boolean(solicitudElegida))}
                      </form>
                    )}
                  </div>
                )}
              </section>
            </div>

            {/* SEGUIMIENTO, HISTORIAL Y ACCIONES */}
            <div className="lg:col-start-2 lg:row-start-2 min-w-0 space-y-6">
              {!descartado && !esFrioActivo && (
                <section className="space-y-3">
                  <TituloSeccion icono="edit_note">Seguimiento</TituloSeccion>
                  {fueraDeGestion && !mostrarSeguimientoExtra ? (
                    botonSecundario('REGISTRAR CONTACTO', () => setMostrarSeguimientoExtra(true))
                  ) : (
                    formSeguimiento(false)
                  )}
                </section>
              )}

              <section className="space-y-3">
                <TituloSeccion icono="history">Historial de contactos</TituloSeccion>
                {loadingSeguimientos && (
                  <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO...</p>
                )}
                {!loadingSeguimientos && seguimientos && seguimientos.length === 0 && (
                  <p className="font-body-md text-sm text-on-surface-variant">Sin contactos registrados todavía.</p>
                )}
                {!loadingSeguimientos && seguimientos && seguimientos.length > 0 && (
                  <div className="space-y-2">
                    {seguimientos.map((s) => (
                      <div key={s.id} className="bg-background border border-outline p-3">
                        <div className="flex justify-between items-start gap-3 mb-1">
                          <span className="font-code-sm text-code-sm text-primary-container uppercase">{s.tipo}</span>
                          <span className="font-code-sm text-[10px] text-on-surface-variant uppercase text-right">
                            {new Date(s.fecha).toLocaleString()}
                          </span>
                        </div>
                        {s.observacion && <p className="font-body-md text-body-md text-on-surface">{s.observacion}</p>}
                        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-1">
                          Registrado por: {registradoPorMostrable(s.comercial_id)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {(leadSeleccionado.clasificacion === 'CONVERTIDO' || esFrioActivo || esTibioActivo || esCalienteActivo) && (
                <section className="border-t border-outline pt-6 space-y-3">
                  <TituloSeccion icono="tune">Otras acciones</TituloSeccion>
                  <div className="flex flex-wrap gap-3 items-center">
                    {leadSeleccionado.clasificacion === 'CONVERTIDO' && (
                      <button
                        type="button"
                        disabled={procesando}
                        onClick={handleMarcarRecurrente}
                        className="px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        MARCAR RECURRENTE
                      </button>
                    )}
                    {!(esFrioActivo || esTibioActivo || esCalienteActivo) ? null : !confirmandoDescarte ? (
                      <button
                        type="button"
                        disabled={procesando}
                        onClick={() => setConfirmandoDescarte(true)}
                        className="px-4 py-2 border border-outline text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        DESCARTAR LEAD
                      </button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3 border border-error p-3">
                        <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">
                          ¿Descartar este lead? Esta acción no se puede deshacer.
                        </p>
                        <button
                          type="button"
                          disabled={procesando}
                          onClick={handleDescartar}
                          className="px-4 py-2 border border-error text-error hover:bg-error hover:text-on-error transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                        >
                          CONFIRMAR DESCARTE
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmandoDescarte(false)}
                          className="px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                        >
                          CANCELAR
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Bandeja COMERCIAL. Reutiliza la lógica genérica de filtros / orden /
  // paginación (filtradasAdmin, ordenadasAdmin, datosPaginaAdmin,
  // paginasVisiblesAdmin) sin cambiar permisos, visibilidad ni reglas.
  const clienteCelda = (clienteId: string | null) => {
    if (!clienteId) return <span className="text-sm text-on-surface-variant/60 italic">Sin vincular</span>;
    const c = clienteResueltoAdmin(clienteId);
    if (!c) return <span className="text-sm text-on-surface-variant">{estadoApoyo === 'cargando' ? 'Cargando…' : '—'}</span>;
    return (
      <>
        <p className="text-sm text-on-surface">{c.nombre}</p>
        {c.empresa?.trim() && <p className="font-code-sm text-[11px] text-on-surface-variant">{c.empresa}</p>}
      </>
    );
  };

  const comercialCelda = (comercialId: string | null) => {
    const texto = comercialMostrable(comercialId);
    if (texto === 'Yo') return <span className="font-code-sm text-xs text-primary-container uppercase">Yo</span>;
    if (texto === 'Sin asignar') {
      return <span className="font-code-sm text-xs text-on-surface-variant/60 italic whitespace-nowrap">Sin asignar</span>;
    }
    return <span className="font-code-sm text-xs text-on-surface-variant whitespace-nowrap">{texto}</span>;
  };

  const claseSelectFiltro =
    'w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer';
  const campoFiltro = (etiqueta: string, control: ReactNode) => (
    <label className="block min-w-0">
      <span className="block font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase mb-1">{etiqueta}</span>
      {control}
    </label>
  );
  const filtrosAplicados =
    (clasificacionFiltroAdmin !== 'TODAS' ? 1 : 0) +
    (estadoFiltroAdmin !== 'TODOS' ? 1 : 0) +
    (fuenteFiltroAdmin !== 'TODAS' ? 1 : 0) +
    (ordenPorAdmin !== 'recientes' ? 1 : 0);

  return (
    <div className="space-y-6">
      {loadingLista && (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO LEADS...</p>
      )}
      {!loadingLista && errorLista && (
        <div role="alert" className="flex items-start gap-2 border border-error bg-error-container/20 p-3">
          <span className="material-symbols-outlined text-[18px] text-error shrink-0" aria-hidden="true">
            error
          </span>
          <p className="font-body-md text-sm text-error">{errorLista}</p>
        </div>
      )}

      {!loadingLista && !errorLista && (
        <>
          <EmbudoKpis kpis={kpisAdmin} />

          {!leads || leads.length === 0 ? (
            <div className="bg-surface sharp-border p-8 text-center space-y-2">
              <span className="material-symbols-outlined text-3xl text-on-surface-variant" aria-hidden="true">
                inbox
              </span>
              <p className="font-body-md text-body-md text-on-surface">No hay leads registrados.</p>
            </div>
          ) : (
            <>
              {/* BÚSQUEDA Y FILTROS */}
              <div className="bg-surface sharp-border p-4 space-y-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1 min-w-0">
                    <span
                      className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant"
                      aria-hidden="true"
                    >
                      search
                    </span>
                    <input
                      type="text"
                      value={busquedaAdmin}
                      onChange={(e) => setBusquedaAdmin(e.target.value)}
                      placeholder="Buscar por nombre, teléfono o email..."
                      aria-label="Buscar leads"
                      className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm placeholder:text-xs sm:placeholder:text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                    />
                  </div>
                  <button
                    type="button"
                    aria-expanded={filtrosMovilAbiertos}
                    onClick={() => setFiltrosMovilAbiertos((v) => !v)}
                    className="lg:hidden inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                      tune
                    </span>
                    FILTROS{filtrosAplicados > 0 ? ` (${filtrosAplicados})` : ''}
                  </button>
                </div>

                <div
                  className={`${filtrosMovilAbiertos ? 'grid' : 'hidden'} lg:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_2fr_auto] gap-3 items-end`}
                >
                  {campoFiltro(
                    'Clasificación',
                    <div className="relative">
                      <select
                        value={clasificacionFiltroAdmin}
                        onChange={(e) =>
                          setClasificacionFiltroAdmin(e.target.value as (typeof CLASIFICACIONES_FILTRO)[number])
                        }
                        className={claseSelectFiltro}
                      >
                        {CLASIFICACIONES_FILTRO.map((c) => (
                          <option key={c} value={c}>
                            {c === 'TODAS' ? 'Todas' : c}
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                        expand_more
                      </span>
                    </div>
                  )}
                  {campoFiltro(
                    'Estado',
                    <div className="relative">
                      <select
                        value={estadoFiltroAdmin}
                        onChange={(e) => setEstadoFiltroAdmin(e.target.value as (typeof ESTADOS_FILTRO_LEAD)[number])}
                        className={claseSelectFiltro}
                      >
                        {ESTADOS_FILTRO_LEAD.map((e) => (
                          <option key={e} value={e}>
                            {e === 'TODOS' ? 'Todos' : e}
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                        expand_more
                      </span>
                    </div>
                  )}
                  {campoFiltro(
                    'Fuente',
                    <div className="relative">
                      <select
                        value={fuenteFiltroAdmin}
                        onChange={(e) => setFuenteFiltroAdmin(e.target.value as (typeof FUENTES_FILTRO)[number])}
                        className={claseSelectFiltro}
                      >
                        {FUENTES_FILTRO.map((f) => (
                          <option key={f} value={f}>
                            {f === 'TODAS' ? 'Todas' : f}
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                        expand_more
                      </span>
                    </div>
                  )}
                  {campoFiltro(
                    'Ordenar por',
                    <div className="relative">
                      <select
                        value={ordenPorAdmin}
                        onChange={(e) => setOrdenPorAdmin(e.target.value as OrdenPorLead)}
                        className={claseSelectFiltro}
                      >
                      <option value="recientes">Fecha: más recientes</option>
                      <option value="antiguos">Fecha: más antiguos</option>
                      <option value="nombre_asc">Nombre: A → Z</option>
                      <option value="nombre_desc">Nombre: Z → A</option>
                      <option value="clasificacion">Clasificación: fría → recurrente</option>
                      <option value="estado">Estado: activos primero</option>
                      </select>
                      <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                        expand_more
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={limpiarFiltrosAdmin}
                    disabled={!hayFiltrosActivosAdmin}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-on-surface-variant hover:text-on-surface disabled:opacity-40 disabled:cursor-not-allowed font-['Inter'] text-[14px] font-semibold cursor-pointer whitespace-nowrap"
                  >
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                      restart_alt
                    </span>
                    LIMPIAR
                  </button>
                </div>

                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                  {ordenadasAdmin.length === leads.length
                    ? `${leads.length} leads`
                    : `${ordenadasAdmin.length} de ${leads.length} leads`}
                </p>
              </div>

              {/* TABLA — escritorio */}
              <div className="hidden md:block bg-surface sharp-border overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-outline bg-surface-container-high/40">
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase w-[27%]">Lead</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Clasificación</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Estado</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase w-[24%]">Cliente</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Comercial</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Creado</th>
                      <th className="py-3 px-4">
                        <span className="sr-only">Acción</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {datosPaginaAdmin.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-10 px-4 text-center">
                          <p className="font-body-md text-sm text-on-surface-variant">
                            Ningún lead coincide con estos filtros.
                          </p>
                        </td>
                      </tr>
                    )}
                    {datosPaginaAdmin.map((l) => (
                      <tr
                        key={l.id}
                        onClick={() => abrirDetalle(l.id)}
                        className={`border-b border-outline last:border-b-0 hover:bg-surface-container-high transition-colors cursor-pointer ${
                          l.estado === 'DESCARTADO' ? 'opacity-70' : ''
                        }`}
                      >
                        <td className="py-3.5 px-4 align-top">
                          <p className="font-body-md text-body-md font-medium text-on-surface">{l.nombre}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-code-sm text-[11px] text-on-surface-variant">
                            <span className="inline-flex items-center gap-1">
                              <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
                                call
                              </span>
                              {l.telefono}
                            </span>
                            <span className="uppercase text-on-surface-variant/70">· {l.fuente}</span>
                          </p>
                        </td>
                        <td className="py-3.5 px-4 align-top">
                          <BadgeClasificacion valor={l.clasificacion} />
                        </td>
                        <td className="py-3.5 px-4 align-top">
                          <EstadoLeadCelda estado={l.estado} />
                        </td>
                        <td className="py-3.5 px-4 align-top">{clienteCelda(l.cliente_id)}</td>
                        <td className="py-3.5 px-4 pt-4 align-top">{comercialCelda(l.comercial_id)}</td>
                        <td className="py-3.5 px-4 pt-4 align-top font-code-sm text-xs text-on-surface-variant whitespace-nowrap">
                          {new Date(l.creado_en).toLocaleDateString()}
                        </td>
                        <td className="py-3.5 px-4 align-top text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              abrirDetalle(l.id);
                            }}
                            className="inline-flex items-center gap-1 whitespace-nowrap px-3 py-1.5 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                          >
                            VER DETALLE
                            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                              chevron_right
                            </span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* TARJETAS — móvil */}
              <div className="md:hidden space-y-3">
                {datosPaginaAdmin.length === 0 && (
                  <p className="font-body-md text-sm text-on-surface-variant text-center py-6">
                    Ningún lead coincide con estos filtros.
                  </p>
                )}
                {datosPaginaAdmin.map((l) => (
                  <div
                    key={l.id}
                    className={`bg-surface sharp-border border-l-4 ${BORDE_CLASIFICACION[l.clasificacion] ?? 'border-l-outline'} p-4 space-y-3 ${
                      l.estado === 'DESCARTADO' ? 'opacity-75' : ''
                    }`}
                  >
                    <div>
                      <p className="font-body-md text-body-md font-medium text-on-surface">{l.nombre}</p>
                      <p className="mt-0.5 flex items-center gap-1 font-code-sm text-[11px] text-on-surface-variant">
                        <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
                          call
                        </span>
                        {l.telefono}
                        <span className="uppercase text-on-surface-variant/70">· {l.fuente}</span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <BadgeClasificacion valor={l.clasificacion} />
                      <EstadoLeadCelda estado={l.estado} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="min-w-0">
                        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase mb-0.5">Cliente</p>
                        {clienteCelda(l.cliente_id)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase mb-0.5">Comercial</p>
                        {comercialCelda(l.comercial_id)}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 pt-3 border-t border-outline">
                      <span className="font-code-sm text-[11px] text-on-surface-variant">
                        Creado {new Date(l.creado_en).toLocaleDateString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => abrirDetalle(l.id)}
                        className="inline-flex items-center gap-1 px-4 py-2 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                      >
                        VER DETALLE
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                          chevron_right
                        </span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* PAGINACIÓN */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-surface sharp-border p-4">
                <div className="flex items-center gap-3">
                  <span className="font-code-sm text-[11px] text-on-surface-variant uppercase">
                    Mostrando {ordenadasAdmin.length === 0 ? 0 : (paginaEfectivaAdmin - 1) * registrosPorPaginaAdmin + 1}–
                    {Math.min(paginaEfectivaAdmin * registrosPorPaginaAdmin, ordenadasAdmin.length)} de{' '}
                    {ordenadasAdmin.length}
                  </span>
                  <div className="relative">
                  <select
                    value={registrosPorPaginaAdmin}
                    onChange={(e) => setRegistrosPorPaginaAdmin(Number(e.target.value))}
                    aria-label="Leads por página"
                    className="appearance-none bg-background border border-outline pl-3 pr-11 py-1.5 text-on-surface text-xs font-code-sm focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    {REGISTROS_POR_PAGINA_OPCIONES_LEAD.map((n) => (
                      <option key={n} value={n}>
                        {n} por página
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant">
                    expand_more
                  </span>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Página anterior"
                    disabled={paginaEfectivaAdmin <= 1}
                    onClick={() => setPaginaActualAdmin(paginaEfectivaAdmin - 1)}
                    className="inline-flex items-center justify-center w-8 h-8 border border-outline text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                  </button>

                  {paginasVisiblesAdmin.map((p, idx) =>
                    p === 'ellipsis' ? (
                      <span key={`ellipsis-${idx}`} className="px-1 font-code-sm text-on-surface-variant">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPaginaActualAdmin(p)}
                        className={`inline-flex items-center justify-center w-8 h-8 font-code-sm text-xs transition-colors cursor-pointer ${
                          p === paginaEfectivaAdmin
                            ? 'bg-primary-container text-on-primary-container'
                            : 'border border-outline text-on-surface hover:bg-surface-container-high'
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}

                  <button
                    type="button"
                    aria-label="Página siguiente"
                    disabled={paginaEfectivaAdmin >= totalPaginasAdmin}
                    onClick={() => setPaginaActualAdmin(paginaEfectivaAdmin + 1)}
                    className="inline-flex items-center justify-center w-8 h-8 border border-outline text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
