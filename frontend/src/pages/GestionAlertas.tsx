import { useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';
import type { Solicitud } from './BandejaSolicitudes';

export interface Alerta {
  id: string;
  orden_id: string;
  tipo: string;
  condicion: string;
  mensaje: string;
  estado: string;
  creado_en: string;
  leida: boolean;
  leida_en: string | null;
}

interface GestionAlertasProps {
  token: string;
  // Vista ADMIN (autorización explícita — "IMPLEMENTACIÓN AUTORIZADA —
  // ALERTAS ADMIN"): consulta/supervisión únicamente, sin "ATENDER".
  // COMERCIAL/OPERATIVO (esAdmin=false — en la práctica solo OPERATIVO
  // llega aquí, COMERCIAL sigue sin acceso vía tieneOrdenes en
  // AreaPrivada.tsx) conservan exactamente el comportamiento existente.
  esAdmin: boolean;
  // ALERTAS-02 (decisión 5A): true solo para el OPERATIVO responsable (el backend lo vuelve a
  // verificar en cada PATCH /:id/atender); false para ADMIN (vista de solo supervisión, sin
  // cambios) y para COMERCIAL (2B es de consulta, nunca de atención).
  puedeAtender: boolean;
  // Cableado de navegación (sin react-router, mismo criterio ya usado en
  // el resto del proyecto): al pulsar "VER ORDEN" se le pide a
  // AreaPrivada.tsx que cambie de sección y preseleccione la orden en
  // GestionOrdenes.tsx.
  onVerOrden: (ordenId: string) => void;
  onSesionInvalida: () => void;
}

// Solo los campos que la vista ADMIN necesita de /api/ordenes,
// /api/cotizaciones y /api/clientes para resolver el contexto de una
// alerta — mismo patrón de solo lectura ya usado en GestionOrdenes.tsx.
interface OrdenResumen {
  id: string;
  codigo: string;
  estado: string;
  avance: number;
  responsable_id: string | null;
  cotizacion_id: string;
}

interface CotizacionResumen {
  solicitud_id: string;
}

interface ClienteResumen {
  nombre: string;
  empresa: string | null;
}

type EstadoApoyo = 'cargando' | 'disponible' | 'error';

type OrdenPorAlerta = 'recientes' | 'antiguos';

const REGISTROS_POR_PAGINA_OPCIONES_ALERTA = [10, 25, 50] as const;

// Badges por estado real de alerta (los 4 valores permitidos por
// chk_alertas_estado — solo PENDIENTE/ATENDIDA se producen hoy por
// código, ver auditoría previa; se contemplan los 4 por si el esquema
// llegara a usarlos). Colores tomados exclusivamente de los tokens ya
// definidos en index.css.
const BADGE_ESTADO_ALERTA: Record<string, string> = {
  PENDIENTE: 'border border-primary-container text-primary-container bg-primary-container/10',
  ENVIADA: 'border border-outline-variant text-on-surface-variant bg-outline-variant/10',
  ATENDIDA: 'border border-primary-container bg-primary-container text-on-primary-container',
  CANCELADA: 'border border-secondary-container text-secondary bg-secondary-container/30',
};

function claseBadgeEstadoAlerta(estado: string): string {
  return BADGE_ESTADO_ALERTA[estado] ?? 'border border-outline text-on-surface-variant';
}

function fechaEnRangoAlerta(fechaIso: string, desde: string, hasta: string): boolean {
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

function KpiAlerta({
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
    <div className={`bg-surface sharp-border p-4 border-l-4 ${claseBorde} flex items-center gap-3`}>
      <span className={`inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-full ${claseIcono}`}>
        <span className="material-symbols-outlined text-[20px]">{icono}</span>
      </span>
      <div className="min-w-0">
        <p className="font-headline-md text-headline-md font-black text-on-surface leading-none">{valor}</p>
        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase mt-1 break-words">{etiqueta}</p>
      </div>
    </div>
  );
}

export default function GestionAlertas({ token, esAdmin, puedeAtender, onVerOrden, onSesionInvalida }: GestionAlertasProps) {
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [procesando, setProcesando] = useState<string | null>(null);

  // Vista ADMIN — solo lectura/supervisión. Estados independientes de los
  // de arriba (exclusivos del flujo COMERCIAL/OPERATIVO, sin cambios).
  const [ordenesPorId, setOrdenesPorId] = useState<Map<string, OrdenResumen>>(new Map());
  const [cotizacionesPorId, setCotizacionesPorId] = useState<Map<string, CotizacionResumen>>(new Map());
  const [solicitudesPorId, setSolicitudesPorId] = useState<Map<string, Solicitud>>(new Map());
  const [clientesPorId, setClientesPorId] = useState<Map<string, ClienteResumen>>(new Map());
  const [usuariosPorId, setUsuariosPorId] = useState<Map<string, string>>(new Map());
  const [estadoApoyo, setEstadoApoyo] = useState<EstadoApoyo>('cargando');

  const [alertaSeleccionada, setAlertaSeleccionada] = useState<Alerta | null>(null);

  const [busquedaAdmin, setBusquedaAdmin] = useState('');
  const [tipoFiltroAdmin, setTipoFiltroAdmin] = useState('TODOS');
  const [condicionFiltroAdmin, setCondicionFiltroAdmin] = useState('TODOS');
  const [estadoFiltroAdmin, setEstadoFiltroAdmin] = useState('TODOS');
  const [fechaDesdeAdmin, setFechaDesdeAdmin] = useState('');
  const [fechaHastaAdmin, setFechaHastaAdmin] = useState('');
  const [ordenPorAdmin, setOrdenPorAdmin] = useState<OrdenPorAlerta>('recientes');
  const [paginaActualAdmin, setPaginaActualAdmin] = useState(1);
  const [registrosPorPaginaAdmin, setRegistrosPorPaginaAdmin] = useState<number>(10);

  async function cargar() {
    setLoading(true);
    setError(null);

    try {
      // ALERTAS-02 (decisión 8A): GET /api/alertas ya es una consulta pura (no genera nada). La
      // generación es un paso previo y explícito, best-effort — si falla (ej. algún rol sin
      // permiso, error de red), simplemente se continúa con la consulta; nunca bloquea la lectura.
      await fetchAutenticado('/api/alertas/generar', token, { method: 'POST' }).catch(() => undefined);

      const response = await fetchAutenticado('/api/alertas', token);

      if (response.status === 403) {
        setError('No autorizado para consultar alertas.');
        return;
      }
      if (!response.ok) {
        setError('No se pudo cargar el listado de alertas.');
        return;
      }

      const data = (await response.json()) as { alertas: Alerta[] };
      setAlertas(data.alertas);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setError('No se pudo cargar el listado de alertas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Vista ADMIN: carga de apoyo (órdenes + cotizaciones + solicitudes +
  // clientes + usuarios) para resolver el contexto de cada alerta —
  // exactamente los listados ya existentes, cargados UNA sola vez cada
  // uno (nunca un GET por alerta). Nunca se ejecuta si esAdmin es false:
  // no agrega ninguna llamada nueva al flujo de OPERATIVO.
  useEffect(() => {
    if (!esAdmin) return;
    let cancelado = false;

    async function cargarApoyo() {
      setEstadoApoyo('cargando');
      try {
        const [respOrdenes, respCotizaciones, respSolicitudes, respClientes, respUsuarios] = await Promise.all([
          fetchAutenticado('/api/ordenes', token),
          fetchAutenticado('/api/cotizaciones', token),
          fetchAutenticado('/api/solicitudes', token),
          fetchAutenticado('/api/clientes', token),
          fetchAutenticado('/api/usuarios', token),
        ]);

        if (!respOrdenes.ok || !respCotizaciones.ok || !respSolicitudes.ok || !respClientes.ok || !respUsuarios.ok) {
          if (!cancelado) setEstadoApoyo('error');
          return;
        }

        const dataOrdenes = (await respOrdenes.json()) as { ordenes: OrdenResumen[] };
        const dataCotizaciones = (await respCotizaciones.json()) as {
          cotizaciones: { id: string; solicitud_id: string }[];
        };
        const dataSolicitudes = (await respSolicitudes.json()) as { solicitudes: Solicitud[] };
        const dataClientes = (await respClientes.json()) as {
          clientes: { id: string; nombre: string; empresa: string | null }[];
        };
        const dataUsuarios = (await respUsuarios.json()) as { usuarios: { id: string; nombre: string }[] };

        if (!cancelado) {
          const mapaOrdenes = new Map<string, OrdenResumen>();
          dataOrdenes.ordenes.forEach((o) => mapaOrdenes.set(o.id, o));
          const mapaCotizaciones = new Map<string, CotizacionResumen>();
          dataCotizaciones.cotizaciones.forEach((c) => mapaCotizaciones.set(c.id, { solicitud_id: c.solicitud_id }));
          const mapaSolicitudes = new Map<string, Solicitud>();
          dataSolicitudes.solicitudes.forEach((s) => mapaSolicitudes.set(s.id, s));
          const mapaClientes = new Map<string, ClienteResumen>();
          dataClientes.clientes.forEach((c) => mapaClientes.set(c.id, { nombre: c.nombre, empresa: c.empresa }));
          const mapaUsuarios = new Map<string, string>();
          dataUsuarios.usuarios.forEach((u) => mapaUsuarios.set(u.id, u.nombre));

          setOrdenesPorId(mapaOrdenes);
          setCotizacionesPorId(mapaCotizaciones);
          setSolicitudesPorId(mapaSolicitudes);
          setClientesPorId(mapaClientes);
          setUsuariosPorId(mapaUsuarios);
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
  }, [esAdmin, token, onSesionInvalida]);

  // Resuelve alerta.orden_id -> orden -> cotización -> solicitud ->
  // cliente, todo sobre los mapas ya cargados (sin ningún GET adicional).
  function datosOrdenAlerta(ordenId: string): { orden: OrdenResumen | null; cliente: string; servicio: string } {
    if (estadoApoyo === 'cargando') return { orden: null, cliente: 'Cargando…', servicio: 'Cargando…' };
    if (estadoApoyo === 'error') return { orden: null, cliente: '—', servicio: '—' };
    const orden = ordenesPorId.get(ordenId) ?? null;
    if (!orden) return { orden: null, cliente: '—', servicio: '—' };
    const cotizacion = cotizacionesPorId.get(orden.cotizacion_id);
    const solicitud = cotizacion ? solicitudesPorId.get(cotizacion.solicitud_id) : undefined;
    const cliente = solicitud ? clientesPorId.get(solicitud.cliente_id) : undefined;
    const nombreCliente = cliente ? (cliente.empresa?.trim() ? cliente.empresa : cliente.nombre) : '—';
    return { orden, cliente: nombreCliente, servicio: solicitud?.servicio ?? '—' };
  }

  function nombreResponsableAlerta(responsableId: string | null): string {
    if (!responsableId) return 'Sin asignar';
    if (estadoApoyo === 'cargando') return 'Cargando…';
    return usuariosPorId.get(responsableId) ?? '—';
  }

  const kpisAdmin = useMemo(() => {
    if (!alertas) return { total: 0, pendientes: 0, atendidas: 0 };
    return {
      total: alertas.length,
      pendientes: alertas.filter((a) => a.estado === 'PENDIENTE').length,
      atendidas: alertas.filter((a) => a.estado === 'ATENDIDA').length,
    };
  }, [alertas]);

  // Opciones de filtro derivadas de los datos reales (no una lista fija):
  // igual criterio ya usado para "Servicio" en BandejaSolicitudes.tsx —
  // nunca se muestra como opción un tipo/condición/estado que no exista
  // realmente en los datos cargados.
  const tiposDisponibles = useMemo(() => {
    if (!alertas) return [];
    const unicos: string[] = [];
    for (const a of alertas) if (!unicos.includes(a.tipo)) unicos.push(a.tipo);
    return unicos.sort((a, b) => a.localeCompare(b));
  }, [alertas]);

  const condicionesDisponibles = useMemo(() => {
    if (!alertas) return [];
    const unicas: string[] = [];
    for (const a of alertas) if (!unicas.includes(a.condicion)) unicas.push(a.condicion);
    return unicas.sort((a, b) => a.localeCompare(b));
  }, [alertas]);

  const estadosDisponibles = useMemo(() => {
    if (!alertas) return [];
    const unicos: string[] = [];
    for (const a of alertas) if (!unicos.includes(a.estado)) unicos.push(a.estado);
    return unicos.sort((a, b) => a.localeCompare(b));
  }, [alertas]);

  const filtradasAdmin = useMemo(() => {
    if (!alertas) return [];
    const termino = busquedaAdmin.trim().toLowerCase();

    return alertas.filter((a) => {
      if (tipoFiltroAdmin !== 'TODOS' && a.tipo !== tipoFiltroAdmin) return false;
      if (condicionFiltroAdmin !== 'TODOS' && a.condicion !== condicionFiltroAdmin) return false;
      if (estadoFiltroAdmin !== 'TODOS' && a.estado !== estadoFiltroAdmin) return false;
      if (!fechaEnRangoAlerta(a.creado_en, fechaDesdeAdmin, fechaHastaAdmin)) return false;

      if (termino) {
        const { orden, cliente, servicio } = datosOrdenAlerta(a.orden_id);
        const coincide =
          (orden?.codigo.toLowerCase().includes(termino) ?? false) ||
          cliente.toLowerCase().includes(termino) ||
          servicio.toLowerCase().includes(termino) ||
          a.mensaje.toLowerCase().includes(termino);
        if (!coincide) return false;
      }

      return true;
    });
  }, [
    alertas,
    busquedaAdmin,
    tipoFiltroAdmin,
    condicionFiltroAdmin,
    estadoFiltroAdmin,
    fechaDesdeAdmin,
    fechaHastaAdmin,
    ordenesPorId,
    cotizacionesPorId,
    solicitudesPorId,
    clientesPorId,
    estadoApoyo,
  ]);

  const ordenadasAdmin = useMemo(() => {
    const copia = [...filtradasAdmin];
    copia.sort((a, b) => {
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
  }, [busquedaAdmin, tipoFiltroAdmin, condicionFiltroAdmin, estadoFiltroAdmin, fechaDesdeAdmin, fechaHastaAdmin, ordenPorAdmin, registrosPorPaginaAdmin]);

  function limpiarFiltrosAdmin() {
    setBusquedaAdmin('');
    setTipoFiltroAdmin('TODOS');
    setCondicionFiltroAdmin('TODOS');
    setEstadoFiltroAdmin('TODOS');
    setFechaDesdeAdmin('');
    setFechaHastaAdmin('');
    setOrdenPorAdmin('recientes');
  }

  const hayFiltrosActivosAdmin =
    busquedaAdmin.trim() !== '' ||
    tipoFiltroAdmin !== 'TODOS' ||
    condicionFiltroAdmin !== 'TODOS' ||
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

  async function handleAtender(id: string) {
    setProcesando(id);
    try {
      const response = await fetchAutenticado(`/api/alertas/${id}/atender`, token, {
        method: 'PATCH',
      });
      if (!response.ok) return;
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    } finally {
      setProcesando(null);
    }
  }

  // Vista ADMIN — detalle exclusivamente de consulta. Sin botón ATENDER;
  // incluye VER ORDEN (cableado hacia AreaPrivada.tsx, sin rutas nuevas).
  if (alertaSeleccionada && esAdmin) {
    const { orden, cliente, servicio } = datosOrdenAlerta(alertaSeleccionada.orden_id);

    return (
      <div>
        <button
          type="button"
          onClick={() => setAlertaSeleccionada(null)}
          className="min-h-11 -mt-2.5 mb-3.5 inline-flex items-center font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL LISTADO
        </button>

        <div className="bg-surface sharp-border p-6 space-y-5">
          <div className="flex flex-wrap justify-between items-start gap-x-4 gap-y-3 border-b border-outline pb-4">
            <div className="min-w-0 flex-1 basis-52">
              <h3 className="font-headline-md text-headline-md text-on-surface uppercase wrap-anywhere">
                {alertaSeleccionada.tipo} · {alertaSeleccionada.condicion}
              </h3>
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-1">
                {new Date(alertaSeleccionada.creado_en).toLocaleString()}
              </p>
            </div>
            <span className={`inline-flex shrink-0 whitespace-nowrap px-3 py-1 font-code-sm text-xs uppercase ${claseBadgeEstadoAlerta(alertaSeleccionada.estado)}`}>
              {alertaSeleccionada.estado.replace(/_/g, ' ')}
            </span>
          </div>

          <div>
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Mensaje</p>
            <p className="font-body-md text-body-md text-on-surface wrap-anywhere">{alertaSeleccionada.mensaje}</p>
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Orden relacionada</p>
            {orden ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-code-sm text-code-sm">
                <div>
                  <dt className="text-on-surface-variant uppercase">Código</dt>
                  <dd className="text-on-surface">{orden.codigo}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Estado de la orden</dt>
                  <dd className="text-on-surface">{orden.estado.replace(/_/g, ' ')}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Cliente</dt>
                  <dd className="text-on-surface">{cliente}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Servicio</dt>
                  <dd className="text-on-surface">{servicio}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Responsable</dt>
                  <dd className="text-on-surface">{nombreResponsableAlerta(orden.responsable_id)}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Avance</dt>
                  <dd className="text-on-surface">{orden.avance}%</dd>
                </div>
              </dl>
            ) : (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                {estadoApoyo === 'cargando' ? 'Cargando datos de la orden…' : 'No se pudo obtener la orden relacionada.'}
              </p>
            )}

            {orden && (
              <button
                type="button"
                onClick={() => onVerOrden(alertaSeleccionada.orden_id)}
                aria-label="Ver orden relacionada"
                title="Ver orden"
                className="mt-4 inline-flex items-center justify-center w-11 h-11 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors cursor-pointer"
              >
                <Eye size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Vista ADMIN — bandeja de solo supervisión. Sin botón ATENDER en
  // ninguna fila. La vista original (COMERCIAL/OPERATIVO, sin cambios)
  // se renderiza al final de este componente cuando esAdmin es false.
  if (esAdmin) {
    return (
      <div className="space-y-8">
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase max-w-2xl">
          Vista de supervisión: consulte las alertas generadas por el sistema y su contexto. Esta vista no permite
          atenderlas — esa acción es responsabilidad de Operativo.
        </p>

        {loading && <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO ALERTAS...</p>}
        {!loading && error && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{error}</p>}
        {!loading && !error && alertas && alertas.length === 0 && (
          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">NO HAY ALERTAS REGISTRADAS.</p>
        )}

        {!loading && !error && alertas && alertas.length > 0 && (
          <>
            {/* KPI */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <KpiAlerta
                icono="notifications"
                valor={kpisAdmin.total}
                etiqueta="Total"
                claseIcono="bg-surface-container-high text-on-surface"
                claseBorde="border-l-outline"
              />
              <KpiAlerta
                icono="schedule"
                valor={kpisAdmin.pendientes}
                etiqueta="Pendientes"
                claseIcono="bg-primary-container/20 text-primary-container"
                claseBorde="border-l-primary-container"
              />
              <KpiAlerta
                icono="check_circle"
                valor={kpisAdmin.atendidas}
                etiqueta="Atendidas"
                claseIcono="bg-primary-container text-on-primary-container"
                claseBorde="border-l-primary-container"
              />
            </div>

            {/* FILTROS */}
            <div className="bg-surface sharp-border p-5 space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_180px_200px_170px] gap-4">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                    search
                  </span>
                  <input
                    type="text"
                    value={busquedaAdmin}
                    onChange={(e) => setBusquedaAdmin(e.target.value)}
                    placeholder="Buscar por código de orden, cliente, servicio o mensaje…"
                    className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                  />
                </div>
                <div className="relative">
                  <select
                    value={tipoFiltroAdmin}
                    onChange={(e) => setTipoFiltroAdmin(e.target.value)}
                    className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    <option value="TODOS">Tipo: Todos</option>
                    {tiposDisponibles.map((tipo) => (
                      <option key={tipo} value={tipo}>
                        {tipo}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                    expand_more
                  </span>
                </div>
                <div className="relative">
                  <select
                    value={condicionFiltroAdmin}
                    onChange={(e) => setCondicionFiltroAdmin(e.target.value)}
                    className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    <option value="TODOS">Condición: Todas</option>
                    {condicionesDisponibles.map((condicion) => (
                      <option key={condicion} value={condicion}>
                        {condicion}
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
                    onChange={(e) => setEstadoFiltroAdmin(e.target.value)}
                    className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    <option value="TODOS">Estado: Todos</option>
                    {estadosDisponibles.map((estado) => (
                      <option key={estado} value={estado}>
                        {estado.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                    expand_more
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[180px_180px_1fr_auto] gap-4 items-end">
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
                      onChange={(e) => setOrdenPorAdmin(e.target.value as OrdenPorAlerta)}
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
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Tipo</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Condición</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Orden</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Cliente</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Servicio</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Estado</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Fecha</th>
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
                  {datosPaginaAdmin.map((a) => {
                    const { orden, cliente, servicio } = datosOrdenAlerta(a.orden_id);
                    return (
                      <tr key={a.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                        <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface">{a.tipo}</td>
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">{a.condicion}</td>
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface">{orden?.codigo ?? '—'}</td>
                        <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface">{cliente}</td>
                        <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface break-words">{servicio}</td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex whitespace-nowrap px-2.5 py-1 font-code-sm text-[11px]! leading-tight uppercase ${claseBadgeEstadoAlerta(a.estado)}`}>
                            {a.estado.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                          {new Date(a.creado_en).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setAlertaSeleccionada(a)}
                            aria-label="Ver detalle de la alerta"
                            title="Ver detalle"
                            className="inline-flex items-center justify-center w-11 h-11 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors cursor-pointer"
                          >
                            <Eye size={18} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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
              {datosPaginaAdmin.map((a) => {
                const { orden, cliente, servicio } = datosOrdenAlerta(a.orden_id);
                return (
                  <div key={a.id} className="bg-surface sharp-border border-l-4 border-l-primary-container p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="font-body-md text-body-md text-on-surface font-medium wrap-anywhere">
                          {a.tipo} · {a.condicion}
                        </p>
                        <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-0.5 wrap-anywhere">
                          {orden?.codigo ?? '—'} — {cliente}
                        </p>
                      </div>
                      <span className={`inline-flex shrink-0 whitespace-nowrap px-2.5 py-1 font-code-sm text-[11px]! leading-tight uppercase ${claseBadgeEstadoAlerta(a.estado)}`}>
                        {a.estado.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <dl className="grid grid-cols-2 gap-2 font-code-sm text-[11px] wrap-anywhere">
                      <div>
                        <dt className="text-on-surface-variant uppercase">Servicio</dt>
                        <dd className="text-on-surface">{servicio}</dd>
                      </div>
                      <div>
                        <dt className="text-on-surface-variant uppercase">Fecha</dt>
                        <dd className="text-on-surface">{new Date(a.creado_en).toLocaleDateString()}</dd>
                      </div>
                    </dl>

                    <div className="flex items-center justify-end pt-1 border-t border-outline">
                      <button
                        type="button"
                        onClick={() => setAlertaSeleccionada(a)}
                        aria-label="Ver detalle de la alerta"
                        title="Ver detalle"
                        className="flex-1 inline-flex items-center justify-center min-h-11 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors cursor-pointer"
                      >
                        <Eye size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* PAGINACIÓN */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-surface sharp-border p-4">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-3 gap-y-2">
                <span className="font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                  Mostrando {ordenadasAdmin.length === 0 ? 0 : (paginaEfectivaAdmin - 1) * registrosPorPaginaAdmin + 1}–
                  {Math.min(paginaEfectivaAdmin * registrosPorPaginaAdmin, ordenadasAdmin.length)} de{' '}
                  {ordenadasAdmin.length} alertas
                </span>
                <div className="relative">
                  <select
                    value={registrosPorPaginaAdmin}
                    onChange={(e) => setRegistrosPorPaginaAdmin(Number(e.target.value))}
                    className="appearance-none bg-background border border-outline pl-3 pr-11 py-1.5 text-on-surface font-['Inter'] text-[13px] font-normal focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    {REGISTROS_POR_PAGINA_OPCIONES_ALERTA.map((n) => (
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
                    <span key={`ellipsis-${idx}`} className="px-1 font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPaginaActualAdmin(p)}
                      className={`inline-flex items-center justify-center w-8 h-8 font-['Inter'] text-[14px] font-semibold transition-colors cursor-pointer ${
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

  // Vista OPERATIVO/COMERCIAL — lista propia ya filtrada por el backend (1A: solo las órdenes de
  // las que el OPERATIVO es responsable; 2B: solo tipo ENTREGA para COMERCIAL). ALERTAS-02 agrega
  // "VER ORDEN" (reutilizando la misma navegación ya usada en la vista ADMIN, sin rutas nuevas) y
  // condiciona "ATENDER" a `puedeAtender` (false para COMERCIAL) y a que la alerta siga PENDIENTE
  // (una alerta ya CANCELADA por obsoleta — decisiones 6A/7A — o ya ATENDIDA no ofrece la acción).
  return (
    <div>
      {loading && <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO ALERTAS...</p>}
      {!loading && error && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{error}</p>}
      {!loading && !error && alertas && alertas.length === 0 && (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">NO HAY ALERTAS REGISTRADAS.</p>
      )}
      {!loading && !error && alertas && alertas.length > 0 && (
        <div className="space-y-3">
          {alertas.map((a) => (
            <div key={a.id} className="bg-surface sharp-border p-4 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                  <span className="font-code-sm text-code-sm text-primary-container uppercase">
                    {a.tipo} · {a.condicion}
                  </span>
                  <span className="font-code-sm text-[10px] text-on-surface-variant uppercase">{a.estado.replace(/_/g, ' ')}</span>
                </div>
                <p className="font-body-md text-body-md text-on-surface wrap-anywhere">{a.mensaje}</p>
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-1">
                  {new Date(a.creado_en).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap sm:flex-col gap-2 sm:items-end sm:shrink-0">
                <button
                  type="button"
                  onClick={() => onVerOrden(a.orden_id)}
                  aria-label="Ver orden relacionada"
                  title="Ver orden"
                  className="inline-flex items-center justify-center w-11 h-11 border border-outline text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
                >
                  <Eye size={18} aria-hidden="true" />
                </button>
                {puedeAtender && a.estado === 'PENDIENTE' && (
                  <button
                    type="button"
                    disabled={procesando === a.id}
                    onClick={() => handleAtender(a.id)}
                    className="px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    ATENDER
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
