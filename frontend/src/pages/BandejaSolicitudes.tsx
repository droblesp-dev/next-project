import { useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';
import { esCantidadDesconocida, formatearCantidad } from '../lib/cantidadSolicitud';
import fabricacionGalleryImg from '../assets/images/fabricacion_gallery_1788229017518.jpg';

export interface Solicitud {
  id: string;
  cliente_id: string;
  servicio: string;
  descripcion: string;
  cantidad: number;
  fecha_requerida: string | null;
  estado: string;
  especificaciones: string | null;
  requiere_comprobante: boolean;
  creado_en: string;
  actualizado_en: string;
  codigo: string | null;
}

interface BandejaSolicitudesProps {
  token: string;
  // Mejora UX (Análisis IA / Comunicación técnica): controla únicamente si
  // se muestra el indicador de "canal de comunicación disponible" por fila
  // — mismo permiso ya usado en DetalleSolicitud.tsx para el chat
  // (COMERCIAL/OPERATIVO). No se agrega ninguna llamada nueva al backend:
  // el indicador señala que la funcionalidad existe, no si esta solicitud
  // en particular ya tiene mensajes (ese dato no lo expone el listado).
  puedeChatear: boolean;
  onSeleccionar: (id: string) => void;
  onSesionInvalida: () => void;
}

// Solo los campos que esta pantalla necesita de /api/clientes (nombre para
// mostrar). No se persiste ni se envía nada — es una segunda lectura, de
// solo lectura, para resolver cliente_id -> nombre en el cliente.
interface ClienteResumen {
  nombre: string;
  empresa: string | null;
  telefono: string;
}

// Lo que se muestra de un cliente: `principal` es la empresa si existe, si
// no el nombre de la persona de contacto (nunca ambos como principal, para
// no duplicar). `contacto` es el nombre de la persona, pero solo cuando NO
// es ya el principal (para no repetirlo); `telefono` es el teléfono, si
// está disponible. Ambos se etiquetan explícitamente al mostrarse (ver
// `lineaContacto`) — un teléfono sin etiqueta no se reconoce de inmediato
// como tal.
interface InfoCliente {
  principal: string;
  contacto: string | null;
  telefono: string | null;
}

// Línea compacta, con etiquetas explícitas, para los lugares de espacio
// reducido (tabla, tarjetas, vista rápida) — nunca duplica el nombre si ya
// es el principal, y nunca muestra "Contacto:"/"Teléfono:" vacío.
function lineaContacto(info: InfoCliente): string | null {
  const partes = [
    info.contacto ? `Contacto: ${info.contacto}` : null,
    info.telefono ? `Teléfono: ${info.telefono}` : null,
  ].filter((v): v is string => Boolean(v));
  return partes.length ? partes.join(' · ') : null;
}

type EstadoClientes = 'cargando' | 'disponible' | 'no_autorizado' | 'error';

const ESTADOS_FILTRO = ['TODOS', 'NUEVA', 'EN_REVISION', 'COTIZADA', 'CANCELADA'] as const;
type EstadoFiltro = (typeof ESTADOS_FILTRO)[number];

type OrdenPor = 'recientes' | 'antiguos';

const REGISTROS_POR_PAGINA_OPCIONES = [10, 25, 50] as const;

// Badges por estado real (los 4 únicos valores permitidos por PostgreSQL,
// ver chk_solicitudes_estado) — colores tomados exclusivamente de los
// tokens ya definidos en index.css, sin introducir ningún color nuevo.
const BADGE_ESTADO: Record<string, string> = {
  NUEVA: 'border border-primary-container text-primary-container bg-primary-container/10',
  EN_REVISION: 'border border-outline-variant text-on-surface-variant bg-outline-variant/10',
  COTIZADA: 'border border-primary-container bg-primary-container text-on-primary-container',
  CANCELADA: 'border border-error text-error bg-error-container/20',
};

function claseBadgeEstado(estado: string): string {
  return BADGE_ESTADO[estado] ?? 'border border-outline text-on-surface-variant';
}

function fechaEnRango(fechaIso: string, desde: string, hasta: string): boolean {
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

function Kpi({
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
    <div className={`bg-surface sharp-border px-5 py-4 border-l-4 ${claseBorde} flex items-center gap-4`}>
      <span
        className={`inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-full ${claseIcono}`}
      >
        <span className="material-symbols-outlined text-[22px]">{icono}</span>
      </span>
      <div className="min-w-0">
        <p className="font-['Montserrat'] text-[22px] font-semibold leading-[1.3] text-on-surface">{valor}</p>
        <p className="font-label-caps text-label-caps text-on-surface-variant uppercase mt-0.5 break-words">{etiqueta}</p>
      </div>
    </div>
  );
}

export default function BandejaSolicitudes({ token, puedeChatear, onSeleccionar, onSesionInvalida }: BandejaSolicitudesProps) {
  const [solicitudes, setSolicitudes] = useState<Solicitud[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Resolución de nombre de cliente (Fase UX Bandeja): segunda llamada de
  // solo lectura a /api/clientes, independiente de la carga de solicitudes
  // — un fallo aquí (p. ej. 403 para OPERATIVO, que no tiene acceso a este
  // endpoint) nunca bloquea ni rompe el resto de la pantalla.
  const [clientesPorId, setClientesPorId] = useState<Map<string, ClienteResumen>>(new Map());
  const [estadoClientes, setEstadoClientes] = useState<EstadoClientes>('cargando');

  // Filtros — todos client-side, sobre el array ya cargado (el backend no
  // acepta ningún parámetro de filtro/paginación).
  const [busqueda, setBusqueda] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>('TODOS');
  const [servicioFiltro, setServicioFiltro] = useState('TODOS');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [ordenPor, setOrdenPor] = useState<OrdenPor>('recientes');

  // Paginación — client-side.
  const [paginaActual, setPaginaActual] = useState(1);
  const [registrosPorPagina, setRegistrosPorPagina] = useState<number>(10);

  // Vista rápida: solicitud actualmente resaltada (no navega, solo
  // previsualiza). Inicia en la más reciente una vez cargan los datos.
  const [vistaRapidaId, setVistaRapidaId] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    async function cargar() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetchAutenticado('/api/solicitudes', token);

        if (response.status === 403) {
          if (!cancelado) setError('No autorizado para consultar solicitudes.');
          return;
        }

        if (!response.ok) {
          if (!cancelado) setError('No se pudo cargar la bandeja de solicitudes.');
          return;
        }

        const data = (await response.json()) as { solicitudes: Solicitud[] };
        if (!cancelado) {
          setSolicitudes(data.solicitudes);
          setVistaRapidaId((actual) => actual ?? data.solicitudes[0]?.id ?? null);
        }
      } catch (err) {
        if (err instanceof SesionInvalidaError) {
          onSesionInvalida();
          return;
        }
        if (!cancelado) setError('No se pudo cargar la bandeja de solicitudes.');
      } finally {
        if (!cancelado) setLoading(false);
      }
    }

    cargar();
    return () => {
      cancelado = true;
    };
  }, [token, onSesionInvalida]);

  useEffect(() => {
    let cancelado = false;

    async function cargarClientes() {
      setEstadoClientes('cargando');

      try {
        const response = await fetchAutenticado('/api/clientes', token);

        if (response.status === 403) {
          if (!cancelado) setEstadoClientes('no_autorizado');
          return;
        }
        if (!response.ok) {
          if (!cancelado) setEstadoClientes('error');
          return;
        }

        const data = (await response.json()) as {
          clientes: { id: string; nombre: string; empresa: string | null; telefono: string }[];
        };
        if (!cancelado) {
          const mapa = new Map<string, ClienteResumen>();
          data.clientes.forEach((c) => mapa.set(c.id, { nombre: c.nombre, empresa: c.empresa, telefono: c.telefono }));
          setClientesPorId(mapa);
          setEstadoClientes('disponible');
        }
      } catch (err) {
        if (err instanceof SesionInvalidaError) {
          onSesionInvalida();
          return;
        }
        if (!cancelado) setEstadoClientes('error');
      }
    }

    cargarClientes();
    return () => {
      cancelado = true;
    };
  }, [token, onSesionInvalida]);

  function infoCliente(clienteId: string): InfoCliente {
    if (estadoClientes === 'cargando') return { principal: 'Cargando…', contacto: null, telefono: null };
    if (estadoClientes === 'no_autorizado') return { principal: '— (sin acceso)', contacto: null, telefono: null };
    if (estadoClientes === 'error') return { principal: '—', contacto: null, telefono: null };
    const cliente = clientesPorId.get(clienteId);
    if (!cliente) return { principal: '—', contacto: null, telefono: null };

    const empresa = cliente.empresa?.trim() || null;
    const nombre = cliente.nombre?.trim() || null;
    const telefono = cliente.telefono?.trim() || null;
    const principal = empresa || nombre || '—';
    // El nombre solo se repite como "contacto" cuando ya se usó la empresa
    // como principal — si no hay empresa, el nombre ya es el principal y
    // no debe duplicarse aquí.
    const contacto = empresa && nombre ? nombre : null;

    return { principal, contacto, telefono };
  }

  const serviciosDisponibles = useMemo(() => {
    if (!solicitudes) return [];
    const unicos: string[] = [];
    for (const s of solicitudes) {
      if (!unicos.includes(s.servicio)) unicos.push(s.servicio);
    }
    return unicos.sort((a, b) => a.localeCompare(b));
  }, [solicitudes]);

  const kpis = useMemo(() => {
    const base = { total: 0, NUEVA: 0, EN_REVISION: 0, COTIZADA: 0, CANCELADA: 0 };
    if (!solicitudes) return base;
    base.total = solicitudes.length;
    for (const s of solicitudes) {
      if (s.estado in base) {
        (base as Record<string, number>)[s.estado] += 1;
      }
    }
    return base;
  }, [solicitudes]);

  const filtradas = useMemo(() => {
    if (!solicitudes) return [];
    const termino = busqueda.trim().toLowerCase();

    return solicitudes.filter((s) => {
      if (estadoFiltro !== 'TODOS' && s.estado !== estadoFiltro) return false;
      if (servicioFiltro !== 'TODOS' && s.servicio !== servicioFiltro) return false;
      if (!fechaEnRango(s.creado_en, fechaDesde, fechaHasta)) return false;

      if (termino) {
        const cliente = estadoClientes === 'disponible' ? clientesPorId.get(s.cliente_id) : null;
        const coincide =
          s.servicio.toLowerCase().includes(termino) ||
          s.descripcion.toLowerCase().includes(termino) ||
          (s.codigo?.toLowerCase().includes(termino) ?? false) ||
          (cliente ? cliente.nombre.toLowerCase().includes(termino) : false) ||
          (cliente?.empresa ? cliente.empresa.toLowerCase().includes(termino) : false);
        if (!coincide) return false;
      }

      return true;
    });
  }, [solicitudes, busqueda, estadoFiltro, servicioFiltro, fechaDesde, fechaHasta, estadoClientes, clientesPorId]);

  const ordenadas = useMemo(() => {
    const copia = [...filtradas];
    copia.sort((a, b) => {
      const diferencia = new Date(a.creado_en).getTime() - new Date(b.creado_en).getTime();
      return ordenPor === 'recientes' ? -diferencia : diferencia;
    });
    return copia;
  }, [filtradas, ordenPor]);

  const totalPaginas = Math.max(1, Math.ceil(ordenadas.length / registrosPorPagina));
  const paginaEfectiva = Math.min(paginaActual, totalPaginas);
  const datosPagina = useMemo(() => {
    const inicio = (paginaEfectiva - 1) * registrosPorPagina;
    return ordenadas.slice(inicio, inicio + registrosPorPagina);
  }, [ordenadas, paginaEfectiva, registrosPorPagina]);

  // Cualquier cambio de filtro/orden/tamaño de página vuelve a la página 1
  // — evita quedar en una página vacía tras filtrar.
  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda, estadoFiltro, servicioFiltro, fechaDesde, fechaHasta, ordenPor, registrosPorPagina]);

  function limpiarFiltros() {
    setBusqueda('');
    setEstadoFiltro('TODOS');
    setServicioFiltro('TODOS');
    setFechaDesde('');
    setFechaHasta('');
    setOrdenPor('recientes');
  }

  const hayFiltrosActivos =
    busqueda.trim() !== '' ||
    estadoFiltro !== 'TODOS' ||
    servicioFiltro !== 'TODOS' ||
    fechaDesde !== '' ||
    fechaHasta !== '' ||
    ordenPor !== 'recientes';

  const paginasVisibles = useMemo(() => {
    const paginas: (number | 'ellipsis')[] = [];
    const ventana = 1;
    for (let p = 1; p <= totalPaginas; p++) {
      if (p === 1 || p === totalPaginas || (p >= paginaEfectiva - ventana && p <= paginaEfectiva + ventana)) {
        paginas.push(p);
      } else if (paginas[paginas.length - 1] !== 'ellipsis') {
        paginas.push('ellipsis');
      }
    }
    return paginas;
  }, [totalPaginas, paginaEfectiva]);

  const vistaRapida = useMemo(() => {
    if (!solicitudes || !vistaRapidaId) return null;
    return solicitudes.find((s) => s.id === vistaRapidaId) ?? null;
  }, [solicitudes, vistaRapidaId]);

  const infoClienteVistaRapida = useMemo(() => {
    if (!vistaRapida) return null;
    return infoCliente(vistaRapida.cliente_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vistaRapida, clientesPorId, estadoClientes]);

  if (loading) {
    return <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO SOLICITUDES...</p>;
  }

  if (error) {
    return <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{error}</p>;
  }

  if (!solicitudes || solicitudes.length === 0) {
    return <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">NO HAY SOLICITUDES REGISTRADAS.</p>;
  }

  return (
    <div className="space-y-8">
      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Kpi
          icono="description"
          valor={kpis.total}
          etiqueta="Total de solicitudes"
          claseIcono="bg-surface-container-high text-on-surface"
          claseBorde="border-l-outline"
        />
        <Kpi
          icono="fiber_new"
          valor={kpis.NUEVA}
          etiqueta="Nuevas"
          claseIcono="bg-primary-container/20 text-primary-container"
          claseBorde="border-l-primary-container"
        />
        <Kpi
          icono="sync"
          valor={kpis.EN_REVISION}
          etiqueta="En revisión"
          claseIcono="bg-outline-variant/30 text-on-surface-variant"
          claseBorde="border-l-outline-variant"
        />
        <Kpi
          icono="request_quote"
          valor={kpis.COTIZADA}
          etiqueta="Cotizadas"
          claseIcono="bg-primary-container text-on-primary-container"
          claseBorde="border-l-primary-container"
        />
        <Kpi
          icono="cancel"
          valor={kpis.CANCELADA}
          etiqueta="Canceladas"
          claseIcono="bg-error-container/40 text-error"
          claseBorde="border-l-error"
        />
      </div>

      {/* FILTROS */}
      <div className="bg-surface sharp-border p-5 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px_220px] gap-4">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
              search
            </span>
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por código, cliente, servicio o descripción…"
              className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
            />
          </div>

          <div className="relative">
            <select
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value as EstadoFiltro)}
              className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
            >
              {ESTADOS_FILTRO.map((estado) => (
                <option key={estado} value={estado}>
                  {estado === 'TODOS' ? 'Estado: Todos' : estado.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <span className="material-symbols-outlined pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
              expand_more
            </span>
          </div>

          <div className="relative">
            <select
              value={servicioFiltro}
              onChange={(e) => setServicioFiltro(e.target.value)}
              className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
            >
              <option value="TODOS">Servicio: Todos</option>
              {serviciosDisponibles.map((servicio) => (
                <option key={servicio} value={servicio}>
                  {servicio}
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
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="w-full bg-background border border-outline px-3 py-2.5 text-on-surface text-sm font-code-sm focus:border-primary-container focus:outline-hidden"
            />
          </div>
          <div>
            <label className="block font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase mb-1">
              Fecha hasta
            </label>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="w-full bg-background border border-outline px-3 py-2.5 text-on-surface text-sm font-code-sm focus:border-primary-container focus:outline-hidden"
            />
          </div>
          <div>
            <label className="block font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase mb-1">
              Ordenar por
            </label>
            <div className="relative">
              <select
                value={ordenPor}
                onChange={(e) => setOrdenPor(e.target.value as OrdenPor)}
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
            onClick={limpiarFiltros}
            disabled={!hayFiltrosActivos}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[16px]">restart_alt</span>
            LIMPIAR FILTROS
          </button>
        </div>
      </div>

      {/* TABLA — desktop */}
      <div className="hidden xl:block overflow-x-auto bg-surface sharp-border">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-outline">
              <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">N.º Solicitud</th>
              <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Fecha</th>
              <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Cliente</th>
              <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Servicio</th>
              <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Cantidad</th>
              <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Estado</th>
              <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Últ. actualización</th>
              <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {datosPagina.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 px-4 text-center font-code-sm text-code-sm text-on-surface-variant uppercase">
                  Ningún resultado coincide con estos filtros.
                </td>
              </tr>
            )}
            {datosPagina.map((s) => {
              const infoClienteFila = infoCliente(s.cliente_id);
              return (
              <tr
                key={s.id}
                onClick={() => setVistaRapidaId(s.id)}
                className={`border-b border-outline hover:bg-surface-container-high transition-colors cursor-pointer ${
                  vistaRapidaId === s.id ? 'bg-surface-container-high' : ''
                }`}
              >
                <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface whitespace-nowrap">{s.codigo ?? '—'}</td>
                <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal text-on-surface-variant">
                  {new Date(s.creado_en).toLocaleDateString()}
                </td>
                <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface">
                  <div>{infoClienteFila.principal}</div>
                  {lineaContacto(infoClienteFila) && (
                    <div className="font-code-sm text-[11px] text-on-surface-variant mt-0.5 wrap-anywhere">
                      {lineaContacto(infoClienteFila)}
                    </div>
                  )}
                </td>
                <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface break-words">{s.servicio}</td>
                <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface">{formatearCantidad(s.cantidad, s.especificaciones)}</td>
                <td className="py-3 px-4">
                  <span className={`inline-flex whitespace-nowrap px-2.5 py-1 font-code-sm text-[11px]! leading-tight uppercase ${claseBadgeEstado(s.estado)}`}>
                    {s.estado.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal text-on-surface-variant">
                  {new Date(s.actualizado_en).toLocaleString()}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => onSeleccionar(s.id)}
                      aria-label="Ver detalle de la solicitud"
                      title="Ver detalle"
                      className="inline-flex items-center justify-center w-11 h-11 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors cursor-pointer"
                    >
                      <Eye size={18} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* TABLA — mobile (tarjetas, no tabla comprimida) */}
      <div className="xl:hidden space-y-3">
        {datosPagina.length === 0 && (
          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase text-center py-6">
            Ningún resultado coincide con estos filtros.
          </p>
        )}
        {datosPagina.map((s) => {
          const infoClienteTarjeta = infoCliente(s.cliente_id);
          return (
          <div key={s.id} className="bg-surface sharp-border border-l-4 border-l-primary-container p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1 basis-40">
                <p className="font-body-md text-body-md text-on-surface font-medium wrap-anywhere">{s.servicio}</p>
                <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-0.5 wrap-anywhere">{infoClienteTarjeta.principal}</p>
                {lineaContacto(infoClienteTarjeta) && (
                  <p className="font-code-sm text-[11px] text-on-surface-variant mt-0.5 wrap-anywhere">{lineaContacto(infoClienteTarjeta)}</p>
                )}
              </div>
              <span className={`inline-flex shrink-0 whitespace-nowrap px-2.5 py-1 font-code-sm text-[11px]! leading-tight uppercase ${claseBadgeEstado(s.estado)}`}>
                {s.estado.replace(/_/g, ' ')}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-2 font-code-sm text-[11px] wrap-anywhere">
              <div className="col-span-2">
                <dt className="text-on-surface-variant uppercase">N.º Solicitud</dt>
                <dd className="text-on-surface">{s.codigo ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Cantidad</dt>
                <dd className="text-on-surface">{formatearCantidad(s.cantidad, s.especificaciones)}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Fecha</dt>
                <dd className="text-on-surface">{new Date(s.creado_en).toLocaleDateString()}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-on-surface-variant uppercase">Últ. actualización</dt>
                <dd className="text-on-surface">{new Date(s.actualizado_en).toLocaleString()}</dd>
              </div>
            </dl>

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-outline">
              <button
                type="button"
                onClick={() => onSeleccionar(s.id)}
                aria-label="Ver detalle de la solicitud"
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
            Mostrando {ordenadas.length === 0 ? 0 : (paginaEfectiva - 1) * registrosPorPagina + 1}–
            {Math.min(paginaEfectiva * registrosPorPagina, ordenadas.length)} de {ordenadas.length} solicitudes
          </span>
          <div className="relative">
            <select
              value={registrosPorPagina}
              onChange={(e) => setRegistrosPorPagina(Number(e.target.value))}
              className="appearance-none bg-background border border-outline pl-3 pr-11 py-1.5 text-on-surface font-['Inter'] text-[13px] font-normal focus:border-primary-container focus:outline-hidden cursor-pointer"
            >
              {REGISTROS_POR_PAGINA_OPCIONES.map((n) => (
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
            disabled={paginaEfectiva <= 1}
            onClick={() => setPaginaActual(paginaEfectiva - 1)}
            className="inline-flex items-center justify-center w-8 h-8 border border-outline text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_left</span>
          </button>

          {paginasVisibles.map((p, idx) =>
            p === 'ellipsis' ? (
              <span key={`ellipsis-${idx}`} className="px-1 font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => setPaginaActual(p)}
                className={`inline-flex items-center justify-center w-8 h-8 font-['Inter'] text-[14px] font-semibold transition-colors cursor-pointer ${
                  p === paginaEfectiva
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
            disabled={paginaEfectiva >= totalPaginas}
            onClick={() => setPaginaActual(paginaEfectiva + 1)}
            className="inline-flex items-center justify-center w-8 h-8 border border-outline text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
          </button>
        </div>
      </div>

      {/* VISTA RÁPIDA + DISTRIBUCIÓN + IDENTIDAD */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-surface sharp-border p-5 flex flex-col lg:min-h-[19rem]">
          <p className="font-label-caps text-label-caps text-primary-container uppercase mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">visibility</span>
            Vista rápida
          </p>
          {!vistaRapida && (
            <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Seleccione una fila de la tabla.</p>
          )}
          {vistaRapida && (
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className={`inline-flex whitespace-nowrap px-2.5 py-1 font-code-sm text-[11px]! leading-tight uppercase ${claseBadgeEstado(vistaRapida.estado)}`}>
                  {vistaRapida.estado.replace(/_/g, ' ')}
                </span>
                <span className="font-code-sm text-[10px] text-on-surface-variant">
                  {new Date(vistaRapida.creado_en).toLocaleDateString()}
                </span>
              </div>
              <p className="font-body-md text-body-md text-on-surface">{infoClienteVistaRapida?.principal}</p>
              {infoClienteVistaRapida && lineaContacto(infoClienteVistaRapida) && (
                <p className="font-code-sm text-[11px] text-on-surface-variant">{lineaContacto(infoClienteVistaRapida)}</p>
              )}
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">{vistaRapida.servicio}</p>
              <p className="font-code-sm text-[11px] text-on-surface-variant">
                {esCantidadDesconocida(vistaRapida.especificaciones)
                  ? `Cantidad: ${formatearCantidad(vistaRapida.cantidad, vistaRapida.especificaciones)}`
                  : `${formatearCantidad(vistaRapida.cantidad, vistaRapida.especificaciones)} unidades`}
              </p>
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                Últ. actualización: {new Date(vistaRapida.actualizado_en).toLocaleString()}
              </p>
              <div className="mt-auto pt-3 border-t border-outline">
                <button
                  type="button"
                  onClick={() => onSeleccionar(vistaRapida.id)}
                  aria-label="Ver detalle de la solicitud"
                  title="Ver detalle"
                  className="w-full inline-flex items-center justify-center h-11 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors cursor-pointer"
                >
                  <Eye size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-surface sharp-border p-5 flex flex-col lg:min-h-[19rem]">
          <p className="font-label-caps text-label-caps text-primary-container uppercase mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">bar_chart</span>
            Distribución de solicitudes
          </p>
          <div className="flex-1 flex items-end justify-between gap-2 sm:gap-3 min-h-32">
            {(['NUEVA', 'EN_REVISION', 'COTIZADA', 'CANCELADA'] as const).map((estado) => {
              const valor = kpis[estado];
              const maximo = Math.max(kpis.NUEVA, kpis.EN_REVISION, kpis.COTIZADA, kpis.CANCELADA, 1);
              const alturaPorcentaje = Math.max((valor / maximo) * 100, valor > 0 ? 6 : 0);
              return (
                <div key={estado} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full gap-1">
                  <span className="font-code-sm text-xs text-on-surface">{valor}</span>
                  <div
                    className={`w-full ${estado === 'CANCELADA' ? 'bg-error' : 'bg-primary-container'}`}
                    style={{ height: `${alturaPorcentaje}%`, opacity: estado === 'EN_REVISION' ? 0.6 : 1 }}
                  />
                  <span
                    className={`font-code-sm text-[9px]! text-on-surface-variant max-w-full uppercase text-center flex sm:inline items-center justify-center h-8 sm:h-auto ${
                      estado === 'EN_REVISION' ? 'sm:whitespace-nowrap' : ''
                    }`}
                  >
                    {estado === 'EN_REVISION' ? 'En revisión' : estado}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative overflow-hidden sharp-border min-h-[180px] lg:min-h-[19rem] flex items-end">
          <img src={fabricacionGalleryImg} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/20" />
          <div className="relative z-10 p-5">
            <p className="font-headline-md text-headline-md text-on-surface leading-tight">
              Precisión.
              <br />
              Trabajo.
              <br />
              Resultados.
            </p>
            <div className="w-10 h-1 bg-primary-container mt-3" />
          </div>
        </div>
      </div>
    </div>
  );
}
