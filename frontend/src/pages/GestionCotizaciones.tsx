import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';
import type { Solicitud } from './BandejaSolicitudes';

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
  // Acceso desde Leads (mismo patrón que Órdenes desde Alertas): abre una
  // cotización concreta al montar la sección y se consume una sola vez.
  cotizacionIdInicial?: string | null;
  onCotizacionInicialConsumida?: () => void;
  // Vista ADMIN (rol de supervisión, autorización explícita —
  // "AUTORIZACIÓN DE IMPLEMENTACIÓN — COTIZACIONES ADMIN"): oculta la
  // creación y toda acción comercial (enviar, generar enlace, gestionar
  // anticipo/saldo) y agrega KPI/filtros/tabla/paginación de solo lectura.
  // COMERCIAL (esAdmin=false) conserva exactamente el comportamiento ya
  // existente más abajo, sin ningún cambio. IMPORTANTE: esto es una
  // decisión de presentación, no de seguridad — el backend (ver
  // cotizaciones.routes.ts) sigue aceptando estas acciones desde un JWT de
  // ADMIN; esa inconsistencia queda documentada como pendiente, no se
  // corrige en esta tarea.
  esAdmin: boolean;
  onSesionInvalida: () => void;
}

// Solo los campos que la vista ADMIN necesita de /api/clientes (nombre
// para mostrar) — mismo patrón de solo lectura ya usado en
// BandejaSolicitudes.tsx.
interface ClienteResumen {
  nombre: string;
  empresa: string | null;
}

type EstadoApoyo = 'cargando' | 'disponible' | 'error';

// Los 6 únicos valores reales permitidos por chk_cotizaciones_estado.
const ESTADOS_FILTRO_COTIZACION = ['TODOS', 'BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA', 'VENCIDA', 'CANCELADA'] as const;
type EstadoFiltroCotizacion = (typeof ESTADOS_FILTRO_COTIZACION)[number];

type OrdenPorAdmin = 'recientes' | 'antiguos' | 'mayor_valor' | 'menor_valor';

const REGISTROS_POR_PAGINA_OPCIONES_COTIZACION = [10, 25, 50] as const;

// Badges por estado real de cotización — colores tomados exclusivamente de
// los tokens ya definidos en index.css, sin introducir ningún color nuevo
// (mismo criterio ya aplicado en BandejaSolicitudes.tsx).
const BADGE_ESTADO_COTIZACION: Record<string, string> = {
  BORRADOR: 'border border-outline text-on-surface-variant',
  ENVIADA: 'border border-primary-container text-primary-container bg-primary-container/10',
  ACEPTADA: 'border border-primary-container bg-primary-container text-on-primary-container',
  RECHAZADA: 'border border-error text-error bg-error-container/20',
  VENCIDA: 'border border-outline-variant text-on-surface-variant bg-outline-variant/10',
  CANCELADA: 'border border-secondary-container text-secondary bg-secondary-container/30',
};

function claseBadgeEstadoCotizacion(estado: string): string {
  return BADGE_ESTADO_COTIZACION[estado] ?? 'border border-outline text-on-surface-variant';
}

// Etiqueta de botón más natural que el nombre crudo del estado destino —
// no cambia la transición real (sigue siendo handleCambiarEstado(destino)),
// solo el texto visible.
const ETIQUETAS_TRANSICION_COTIZACION: Record<string, string> = {
  ENVIADA: 'ENVIAR',
  CANCELADA: 'CANCELAR',
  VENCIDA: 'MARCAR VENCIDA',
};

function etiquetaTransicionCotizacion(destino: string): string {
  return ETIQUETAS_TRANSICION_COTIZACION[destino] ?? destino;
}

function fechaEnRangoCotizacion(fechaIso: string, desde: string, hasta: string): boolean {
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

function KpiCotizacion({
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
      <div>
        <p className="font-headline-md text-headline-md font-black text-on-surface leading-none">{valor}</p>
        <p className="font-label-caps text-[10px] text-on-surface-variant uppercase mt-1">{etiqueta}</p>
      </div>
    </div>
  );
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

export default function GestionCotizaciones({
  token,
  esAdmin,
  onSesionInvalida,
  cotizacionIdInicial,
  onCotizacionInicialConsumida,
}: GestionCotizacionesProps) {
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[] | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  // Vista ADMIN — solo lectura/supervisión. Estados independientes de los
  // de más abajo (que siguen siendo exclusivos del flujo COMERCIAL, sin
  // ningún cambio).
  const [solicitudesPorId, setSolicitudesPorId] = useState<Map<string, Solicitud>>(new Map());
  const [clientesPorId, setClientesPorId] = useState<Map<string, ClienteResumen>>(new Map());
  const [estadoApoyo, setEstadoApoyo] = useState<EstadoApoyo>('cargando');

  const [busquedaAdmin, setBusquedaAdmin] = useState('');
  const [estadoFiltroAdmin, setEstadoFiltroAdmin] = useState<EstadoFiltroCotizacion>('TODOS');
  const [fechaDesdeAdmin, setFechaDesdeAdmin] = useState('');
  const [fechaHastaAdmin, setFechaHastaAdmin] = useState('');
  const [ordenPorAdmin, setOrdenPorAdmin] = useState<OrdenPorAdmin>('recientes');
  const [paginaActualAdmin, setPaginaActualAdmin] = useState(1);
  const [registrosPorPaginaAdmin, setRegistrosPorPaginaAdmin] = useState<number>(10);

  // Rediseño UI (autorización explícita — "REDISEÑO UI GESTIÓN DE
  // COTIZACIONES — COMERCIAL"): sección "NUEVA COTIZACIÓN" colapsable, y
  // selector de solicitud amigable (cliente/servicio/descripción) en vez
  // del UUID plano como único punto de interacción — reutiliza
  // solicitudesPorId ya cargado, ningún endpoint nuevo.
  const [mostrandoFormularioCrear, setMostrandoFormularioCrear] = useState(false);
  const [busquedaSolicitudNueva, setBusquedaSolicitudNueva] = useState('');
  const [mostrandoBuscadorSolicitud, setMostrandoBuscadorSolicitud] = useState(false);

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

  // Edición de condiciones comerciales — EXCLUSIVA de BORRADOR (autorización
  // explícita — "IMPLEMENTACIÓN AUTORIZADA — EDICIÓN DE COTIZACIONES
  // BORRADOR"). Mismos 6 campos y mismos valores por defecto que el
  // formulario de creación — aquí se pre-cargan con los valores actuales de
  // la cotización seleccionada al abrir la edición.
  const [editando, setEditando] = useState(false);
  const [valorEdicion, setValorEdicion] = useState('');
  const [descripcionEdicion, setDescripcionEdicion] = useState('');
  const [ivaPorcentajeEdicion, setIvaPorcentajeEdicion] = useState('15');
  const [anticipoPorcentajeEdicion, setAnticipoPorcentajeEdicion] = useState('50');
  const [metodoAnticipoEdicion, setMetodoAnticipoEdicion] = useState('TRANSFERENCIA');
  const [diasVigenciaEdicion, setDiasVigenciaEdicion] = useState('15');
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [mensajeEdicion, setMensajeEdicion] = useState<string | null>(null);

  const [gestionandoAnticipo, setGestionandoAnticipo] = useState(false);
  const [mensajeAnticipo, setMensajeAnticipo] = useState<string | null>(null);
  const [descargandoComprobante, setDescargandoComprobante] = useState(false);

  const [gestionandoSaldo, setGestionandoSaldo] = useState(false);
  const [mensajeSaldo, setMensajeSaldo] = useState<string | null>(null);
  const [descargandoComprobanteSaldo, setDescargandoComprobanteSaldo] = useState(false);
  const [metodoSaldoElegido, setMetodoSaldoElegido] = useState('EFECTIVO');

  // Bloque enlace público (autorización explícita — "IMPLEMENTACIÓN
  // AUTORIZADA — SOLICITUDES COMERCIAL", Parte B): expone
  // POST /api/cotizaciones/:id/enlace, ya existente en el backend pero sin
  // ninguna UI hasta ahora. `enlaceInfo` vive solo en memoria — el backend
  // tampoco persiste el código en texto plano (solo su hash), así que no
  // hay ningún valor adicional que "recordar" entre sesiones.
  const [enlaceInfo, setEnlaceInfo] = useState<{ token: string; codigo: string } | null>(null);
  const [generandoEnlace, setGenerandoEnlace] = useState(false);
  const [mensajeEnlace, setMensajeEnlace] = useState<string | null>(null);
  const [mostrandoCodigo, setMostrandoCodigo] = useState(false);
  const [enlaceCopiado, setEnlaceCopiado] = useState(false);

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

  useEffect(() => {
    if (cotizacionIdInicial) {
      abrirDetalle(cotizacionIdInicial);
      onCotizacionInicialConsumida?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cotizacionIdInicial]);

  // Apoyo de solicitudes/clientes — antes exclusivo de la vista ADMIN,
  // ahora también alimenta la bandeja/detalle de COMERCIAL (rediseño
  // autorizado — "REDISEÑO UI GESTIÓN DE COTIZACIONES — COMERCIAL"): mismos
  // dos endpoints ya existentes (/api/solicitudes, /api/clientes, ambos ya
  // accesibles para COMERCIAL — clientes.routes.ts/solicitudes.routes.ts
  // exigen ADMIN/COMERCIAL), ninguno nuevo. Se ejecuta para ambos roles.
  useEffect(() => {
    let cancelado = false;

    async function cargarApoyo() {
      setEstadoApoyo('cargando');
      try {
        const [respSolicitudes, respClientes] = await Promise.all([
          fetchAutenticado('/api/solicitudes', token),
          fetchAutenticado('/api/clientes', token),
        ]);

        if (!respSolicitudes.ok || !respClientes.ok) {
          if (!cancelado) setEstadoApoyo('error');
          return;
        }

        const dataSolicitudes = (await respSolicitudes.json()) as { solicitudes: Solicitud[] };
        const dataClientes = (await respClientes.json()) as {
          clientes: { id: string; nombre: string; empresa: string | null }[];
        };

        if (!cancelado) {
          const mapaSolicitudes = new Map<string, Solicitud>();
          dataSolicitudes.solicitudes.forEach((s) => mapaSolicitudes.set(s.id, s));
          const mapaClientes = new Map<string, ClienteResumen>();
          dataClientes.clientes.forEach((c) => mapaClientes.set(c.id, { nombre: c.nombre, empresa: c.empresa }));
          setSolicitudesPorId(mapaSolicitudes);
          setClientesPorId(mapaClientes);
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

  function nombreClienteAdmin(clienteId: string | undefined): string {
    if (!clienteId) return '—';
    if (estadoApoyo === 'cargando') return 'Cargando…';
    if (estadoApoyo === 'error') return '—';
    const cliente = clientesPorId.get(clienteId);
    if (!cliente) return '—';
    return cliente.empresa?.trim() ? cliente.empresa : cliente.nombre;
  }

  const kpisAdmin = useMemo(() => {
    const base = { total: 0, BORRADOR: 0, ENVIADA: 0, ACEPTADA: 0, RECHAZADA: 0, VENCIDA: 0, CANCELADA: 0 };
    if (!cotizaciones) return base;
    base.total = cotizaciones.length;
    for (const c of cotizaciones) {
      if (c.estado in base) {
        (base as Record<string, number>)[c.estado] += 1;
      }
    }
    return base;
  }, [cotizaciones]);

  const filtradasAdmin = useMemo(() => {
    if (!cotizaciones) return [];
    const termino = busquedaAdmin.trim().toLowerCase();

    return cotizaciones.filter((c) => {
      if (estadoFiltroAdmin !== 'TODOS' && c.estado !== estadoFiltroAdmin) return false;
      if (!fechaEnRangoCotizacion(c.creado_en, fechaDesdeAdmin, fechaHastaAdmin)) return false;

      if (termino) {
        const solicitud = solicitudesPorId.get(c.solicitud_id) ?? null;
        const cliente = solicitud && estadoApoyo === 'disponible' ? clientesPorId.get(solicitud.cliente_id) : null;
        const coincide =
          (solicitud?.servicio.toLowerCase().includes(termino) ?? false) ||
          (solicitud?.descripcion.toLowerCase().includes(termino) ?? false) ||
          (c.descripcion ? c.descripcion.toLowerCase().includes(termino) : false) ||
          (cliente?.nombre.toLowerCase().includes(termino) ?? false) ||
          (cliente?.empresa ? cliente.empresa.toLowerCase().includes(termino) : false) ||
          c.id.toLowerCase().includes(termino) ||
          c.solicitud_id.toLowerCase().includes(termino);
        if (!coincide) return false;
      }

      return true;
    });
  }, [cotizaciones, busquedaAdmin, estadoFiltroAdmin, fechaDesdeAdmin, fechaHastaAdmin, solicitudesPorId, clientesPorId, estadoApoyo]);

  const ordenadasAdmin = useMemo(() => {
    const copia = [...filtradasAdmin];
    copia.sort((a, b) => {
      if (ordenPorAdmin === 'mayor_valor' || ordenPorAdmin === 'menor_valor') {
        const valorA = Number(a.total ?? a.valor) || 0;
        const valorB = Number(b.total ?? b.valor) || 0;
        const diferencia = valorA - valorB;
        return ordenPorAdmin === 'mayor_valor' ? -diferencia : diferencia;
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
  }, [busquedaAdmin, estadoFiltroAdmin, fechaDesdeAdmin, fechaHastaAdmin, ordenPorAdmin, registrosPorPaginaAdmin]);

  function limpiarFiltrosAdmin() {
    setBusquedaAdmin('');
    setEstadoFiltroAdmin('TODOS');
    setFechaDesdeAdmin('');
    setFechaHastaAdmin('');
    setOrdenPorAdmin('recientes');
  }

  const hayFiltrosActivosAdmin =
    busquedaAdmin.trim() !== '' ||
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

  // Solicitudes elegibles para crear una cotización — solo EN_REVISION
  // (misma precondición que ya exige crearCotizacion() en el backend,
  // aquí solo como guía de UX), filtradas por cliente/servicio/descripción
  // si hay texto de búsqueda. Nunca inventa datos: si solicitudesPorId
  // todavía no cargó, la lista sale vacía y la UI lo indica.
  const solicitudesElegibles = useMemo(() => {
    const termino = busquedaSolicitudNueva.trim().toLowerCase();
    const todas: Solicitud[] = Array.from(solicitudesPorId.values());
    return todas
      .filter((s) => s.estado === 'EN_REVISION')
      .filter((s) => {
        if (!termino) return true;
        const cliente = estadoApoyo === 'disponible' ? clientesPorId.get(s.cliente_id) : null;
        return (
          s.servicio.toLowerCase().includes(termino) ||
          s.descripcion.toLowerCase().includes(termino) ||
          (cliente?.nombre.toLowerCase().includes(termino) ?? false) ||
          (cliente?.empresa ? cliente.empresa.toLowerCase().includes(termino) : false)
        );
      })
      .sort((a, b) => new Date(b.creado_en).getTime() - new Date(a.creado_en).getTime());
  }, [solicitudesPorId, clientesPorId, estadoApoyo, busquedaSolicitudNueva]);

  const solicitudSeleccionadaNueva = solicitudIdNueva ? solicitudesPorId.get(solicitudIdNueva) ?? null : null;

  function handleSeleccionarSolicitudNueva(id: string) {
    setSolicitudIdNueva(id);
    setMostrandoBuscadorSolicitud(false);
    setBusquedaSolicitudNueva('');
  }

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
      setMostrandoFormularioCrear(false);
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
    // Cada cotización abierta empieza sin un enlace mostrado en pantalla —
    // el backend invalida el código anterior cada vez que se genera uno
    // nuevo, así que no tiene sentido arrastrar visualmente el de una
    // cotización distinta.
    setEnlaceInfo(null);
    setMensajeEnlace(null);
    setMostrandoCodigo(false);
    setEnlaceCopiado(false);
    // Tampoco tiene sentido arrastrar un formulario de edición abierto de
    // una cotización distinta a la que se está por mostrar.
    setEditando(false);
    setMensajeEdicion(null);
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

  // Genera (o regenera) el enlace público — endpoint ya existente en el
  // backend (cotizaciones.routes.ts:56), exclusivo de ADMIN/COMERCIAL y
  // restringido a cotizaciones ENVIADA (CotizacionNoDisponibleError en
  // cualquier otro estado). El backend nunca envía nada por correo/
  // WhatsApp/SMS — token y código se devuelven una sola vez en esta
  // respuesta para que Comercial los comparta manualmente, tal como ya
  // documentaba el propio controller.
  async function handleGenerarEnlace() {
    if (!cotizacionSeleccionada) return;
    setGenerandoEnlace(true);
    setMensajeEnlace(null);
    setMostrandoCodigo(false);
    setEnlaceCopiado(false);

    try {
      const response = await fetchAutenticado(`/api/cotizaciones/${cotizacionSeleccionada.id}/enlace`, token, {
        method: 'POST',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeEnlace(data?.message || 'No se pudo generar el enlace.');
        setEnlaceInfo(null);
        return;
      }

      setEnlaceInfo({ token: data.token as string, codigo: data.codigo as string });
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeEnlace('No se pudo generar el enlace.');
    } finally {
      setGenerandoEnlace(false);
    }
  }

  // Construye la URL pública exactamente con la misma ruta que ya
  // interpreta AppRoot.tsx (`/cotizacion/publica/:token`, ver
  // extraerTokenCotizacionPublica) — ninguna ruta nueva, solo se arma el
  // enlace completo a partir del token ya devuelto por el backend.
  function urlPublicaCotizacion(tokenEnlace: string): string {
    return `${window.location.origin}/cotizacion/publica/${encodeURIComponent(tokenEnlace)}`;
  }

  async function handleCopiarEnlace() {
    if (!enlaceInfo) return;
    try {
      await navigator.clipboard.writeText(urlPublicaCotizacion(enlaceInfo.token));
      setEnlaceCopiado(true);
    } catch {
      setMensajeEnlace('No se pudo copiar automáticamente. Copie el enlace manualmente.');
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

  // Edición de condiciones comerciales — EXCLUSIVA de BORRADOR (autorización
  // explícita — "IMPLEMENTACIÓN AUTORIZADA — EDICIÓN DE COTIZACIONES
  // BORRADOR"). Pre-carga el formulario con los valores actuales de la
  // cotización seleccionada — nunca con los defaults de creación.
  function handleAbrirEdicion() {
    if (!cotizacionSeleccionada) return;
    setValorEdicion(cotizacionSeleccionada.valor);
    setDescripcionEdicion(cotizacionSeleccionada.descripcion ?? '');
    setIvaPorcentajeEdicion(cotizacionSeleccionada.iva_porcentaje ?? '15');
    setAnticipoPorcentajeEdicion(cotizacionSeleccionada.anticipo_porcentaje ?? '0');
    setMetodoAnticipoEdicion(cotizacionSeleccionada.metodo_anticipo ?? 'TRANSFERENCIA');
    setDiasVigenciaEdicion('15');
    setMensajeEdicion(null);
    setEditando(true);
  }

  function handleCancelarEdicion() {
    setEditando(false);
    setMensajeEdicion(null);
  }

  async function handleGuardarEdicion(e: FormEvent) {
    e.preventDefault();
    if (!cotizacionSeleccionada) return;
    setGuardandoEdicion(true);
    setMensajeEdicion(null);

    try {
      const anticipoPorcentajeNum = Number(anticipoPorcentajeEdicion);
      const body: Record<string, unknown> = {
        valor: Number(valorEdicion),
        descripcion: descripcionEdicion.trim() || undefined,
        iva_porcentaje: Number(ivaPorcentajeEdicion),
        anticipo_porcentaje: anticipoPorcentajeNum,
        dias_vigencia: Number(diasVigenciaEdicion),
      };
      // Misma regla que la creación (D.2): metodo_anticipo es obligatorio
      // si anticipo>0 y NO debe enviarse si anticipo=0.
      if (anticipoPorcentajeNum > 0) {
        body.metodo_anticipo = metodoAnticipoEdicion;
      }

      const response = await fetchAutenticado(`/api/cotizaciones/${cotizacionSeleccionada.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => null);

      if (response.status === 409) {
        setMensajeEdicion(data?.message || 'Esta cotización ya no está en BORRADOR y no puede editarse.');
        await abrirDetalle(cotizacionSeleccionada.id);
        await cargar();
        return;
      }
      if (!response.ok) {
        setMensajeEdicion(data?.message || 'No se pudo guardar la edición.');
        return;
      }

      // Los valores mostrados (subtotal/IVA/total/anticipo/saldo) son
      // exactamente los que devuelve el backend recalculados — el frontend
      // no repite ningún cálculo, igual que en la creación.
      setCotizacionSeleccionada(data.cotizacion as Cotizacion);
      setEditando(false);
      setMensajeCambio('Cotización actualizada correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeEdicion('No se pudo guardar la edición.');
    } finally {
      setGuardandoEdicion(false);
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

  // Vista ADMIN — detalle exclusivamente de consulta. Ningún bloque de
  // acción (cambiar estado, generar enlace, anticipo, saldo) se renderiza
  // aquí; el bloque existente más abajo (idéntico al de siempre) solo se
  // alcanza cuando esAdmin es false.
  if (cotizacionSeleccionada && esAdmin) {
    const solicitud = solicitudesPorId.get(cotizacionSeleccionada.solicitud_id) ?? null;
    const cliente = solicitud ? clientesPorId.get(solicitud.cliente_id) ?? null : null;
    const nombreClienteDetalle = cliente
      ? cliente.empresa?.trim()
        ? cliente.empresa
        : cliente.nombre
      : nombreClienteAdmin(solicitud?.cliente_id);

    return (
      <div>
        <button
          type="button"
          onClick={() => setCotizacionSeleccionada(null)}
          className="mb-6 inline-flex items-center font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL LISTADO
        </button>

        <div className="bg-surface sharp-border p-6 space-y-5">
          <div className="flex justify-between items-start border-b border-outline pb-4">
            <div>
              <h3 className="font-headline-md text-headline-md text-on-surface uppercase">{nombreClienteDetalle}</h3>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mt-1">
                {solicitud?.servicio ?? 'Servicio no disponible'}
              </p>
            </div>
            <span className={`inline-flex px-3 py-1 font-code-sm text-xs uppercase ${claseBadgeEstadoCotizacion(cotizacionSeleccionada.estado)}`}>
              {cotizacionSeleccionada.estado}
            </span>
          </div>

          <div>
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Solicitud relacionada</p>
            {solicitud ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-code-sm text-code-sm">
                <div className="sm:col-span-2">
                  <dt className="text-on-surface-variant uppercase">Descripción</dt>
                  <dd className="text-on-surface">{solicitud.descripcion}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Cantidad</dt>
                  <dd className="text-on-surface">{solicitud.cantidad}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Fecha requerida</dt>
                  <dd className="text-on-surface">{solicitud.fecha_requerida ?? 'No especificada'}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Especificaciones</dt>
                  <dd className="text-on-surface">{solicitud.especificaciones ?? 'Ninguna'}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Estado de la solicitud</dt>
                  <dd className="text-on-surface">{solicitud.estado}</dd>
                </div>
              </dl>
            ) : (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                {estadoApoyo === 'cargando' ? 'Cargando datos de la solicitud…' : 'No se pudo obtener la solicitud relacionada.'}
              </p>
            )}
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Condiciones comerciales</p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 font-code-sm text-code-sm">
              <div>
                <dt className="text-on-surface-variant uppercase">Valor</dt>
                <dd className="text-on-surface">{cotizacionSeleccionada.valor}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">IVA ({cotizacionSeleccionada.iva_porcentaje ?? '—'}%)</dt>
                <dd className="text-on-surface">{cotizacionSeleccionada.iva_valor ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Total</dt>
                <dd className="text-on-surface">{cotizacionSeleccionada.total ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Vigencia</dt>
                <dd className="text-on-surface">
                  {cotizacionSeleccionada.fecha_vigencia ? new Date(cotizacionSeleccionada.fecha_vigencia).toLocaleString() : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Creada</dt>
                <dd className="text-on-surface">{new Date(cotizacionSeleccionada.creado_en).toLocaleString()}</dd>
              </div>
            </dl>
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Anticipo</p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 font-code-sm text-code-sm">
              <div>
                <dt className="text-on-surface-variant uppercase">Porcentaje</dt>
                <dd className="text-on-surface">{cotizacionSeleccionada.anticipo_porcentaje ?? '—'}%</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Valor</dt>
                <dd className="text-on-surface">{cotizacionSeleccionada.anticipo_valor ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Método</dt>
                <dd className="text-on-surface">{cotizacionSeleccionada.metodo_anticipo ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Estado del anticipo</dt>
                <dd className="text-on-surface">{cotizacionSeleccionada.estado_anticipo ?? '—'}</dd>
              </div>
            </dl>
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Saldo</p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 font-code-sm text-code-sm">
              <div>
                <dt className="text-on-surface-variant uppercase">Pendiente</dt>
                <dd className="text-on-surface">{cotizacionSeleccionada.saldo_pendiente ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Método</dt>
                <dd className="text-on-surface">{cotizacionSeleccionada.metodo_saldo ?? 'Sin definir'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Estado del saldo</dt>
                <dd className="text-on-surface">{cotizacionSeleccionada.estado_saldo}</dd>
              </div>
            </dl>
          </div>

          <div className="border-t border-outline pt-4 space-y-1">
            <p className="font-code-sm text-[10px] text-on-surface-variant uppercase break-all">
              ID técnico de la cotización: {cotizacionSeleccionada.id}
            </p>
            <p className="font-code-sm text-[10px] text-on-surface-variant uppercase break-all">
              ID técnico de la solicitud: {cotizacionSeleccionada.solicitud_id}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (cotizacionSeleccionada) {
    // Resolución de cliente/servicio — mismo patrón/mismos endpoints ya
    // usados por la vista ADMIN (solicitudesPorId/clientesPorId, cargados
    // por el efecto de apoyo que ahora también corre para COMERCIAL, ver
    // más arriba). Sin datos inventados: si la solicitud o el cliente no
    // están disponibles todavía, se muestra un estado honesto en su lugar.
    const solicitudDetalle = solicitudesPorId.get(cotizacionSeleccionada.solicitud_id) ?? null;
    const clienteDetalle = solicitudDetalle ? clientesPorId.get(solicitudDetalle.cliente_id) ?? null : null;
    const nombreClienteDetalle = clienteDetalle
      ? clienteDetalle.empresa?.trim()
        ? clienteDetalle.empresa
        : clienteDetalle.nombre
      : nombreClienteAdmin(solicitudDetalle?.cliente_id);

    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setCotizacionSeleccionada(null);
            setMensajeCambio(null);
          }}
          className="mb-6 inline-flex items-center font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL LISTADO
        </button>

        <div className="bg-surface sharp-border p-6 space-y-5">
          <div className="flex justify-between items-start border-b border-outline pb-4">
            <div>
              <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-1">
                Detalle de cotización
              </h3>
              <p className="font-headline-md text-headline-md text-on-surface uppercase">{nombreClienteDetalle}</p>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mt-1">
                {solicitudDetalle?.servicio ?? 'Servicio no disponible'}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {cotizacionSeleccionada.estado === 'BORRADOR' && !editando && (
                <button
                  type="button"
                  onClick={handleAbrirEdicion}
                  className="inline-flex items-center px-3 py-1 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                >
                  EDITAR
                </button>
              )}
              <span
                className={`inline-flex px-3 py-1 font-code-sm text-xs uppercase ${claseBadgeEstadoCotizacion(cotizacionSeleccionada.estado)}`}
              >
                {cotizacionSeleccionada.estado}
              </span>
            </div>
          </div>

          {/* INFORMACIÓN GENERAL — cliente/servicio resueltos vía
              solicitudesPorId/clientesPorId, nunca inventados. */}
          <div>
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Información general</p>
            {solicitudDetalle ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-code-sm text-code-sm">
                <div>
                  <dt className="text-on-surface-variant uppercase">Cliente</dt>
                  <dd className="text-on-surface">{nombreClienteDetalle}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Servicio</dt>
                  <dd className="text-on-surface">{solicitudDetalle.servicio}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-on-surface-variant uppercase">Descripción de la solicitud</dt>
                  <dd className="text-on-surface">{solicitudDetalle.descripcion}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Fecha</dt>
                  <dd className="text-on-surface">{new Date(cotizacionSeleccionada.creado_en).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Vigencia</dt>
                  <dd className="text-on-surface">
                    {cotizacionSeleccionada.fecha_vigencia
                      ? new Date(cotizacionSeleccionada.fecha_vigencia).toLocaleString()
                      : '—'}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                {estadoApoyo === 'cargando' ? 'Cargando datos de la solicitud…' : 'No se pudo obtener la solicitud relacionada.'}
              </p>
            )}
            <p className="font-code-sm text-[10px] text-on-surface-variant uppercase break-all mt-3">
              ID técnico de solicitud: {cotizacionSeleccionada.solicitud_id}
            </p>
          </div>

          {/* INFORMACIÓN COMERCIAL — en BORRADOR se reemplaza por el
              formulario de edición (autorización explícita — "IMPLEMENTACIÓN
              AUTORIZADA — EDICIÓN DE COTIZACIONES BORRADOR"). Mismos 6
              campos e inputs del formulario de creación, sin solicitud_id
              (no editable). */}
          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Información comercial</p>
            {editando ? (
            <form className="space-y-4" onSubmit={handleGuardarEdicion}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Valor</label>
                  <input
                    value={valorEdicion}
                    onChange={(e) => setValorEdicion(e.target.value)}
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
                    value={descripcionEdicion}
                    onChange={(e) => setDescripcionEdicion(e.target.value)}
                    className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                    type="text"
                  />
                </div>
                <div>
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">IVA</label>
                  <select
                    value={ivaPorcentajeEdicion}
                    onChange={(e) => setIvaPorcentajeEdicion(e.target.value)}
                    className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                  >
                    <option value="15">15%</option>
                    <option value="0">0%</option>
                  </select>
                </div>
                <div>
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">Anticipo</label>
                  <select
                    value={anticipoPorcentajeEdicion}
                    onChange={(e) => setAnticipoPorcentajeEdicion(e.target.value)}
                    className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                  >
                    <option value="50">50%</option>
                    <option value="0">0%</option>
                    <option value="75">75%</option>
                  </select>
                </div>
                {anticipoPorcentajeEdicion !== '0' && (
                  <div>
                    <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                      Método de anticipo
                    </label>
                    <select
                      value={metodoAnticipoEdicion}
                      onChange={(e) => setMetodoAnticipoEdicion(e.target.value)}
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
                    value={diasVigenciaEdicion}
                    onChange={(e) => setDiasVigenciaEdicion(e.target.value)}
                    required
                    className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                    type="number"
                    min="1"
                    step="1"
                  />
                </div>
              </div>

              {mensajeEdicion && (
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">{mensajeEdicion}</p>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={guardandoEdicion}
                  className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {guardandoEdicion ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
                </button>
                <button
                  type="button"
                  disabled={guardandoEdicion}
                  onClick={handleCancelarEdicion}
                  className="inline-flex items-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                >
                  CANCELAR
                </button>
              </div>
            </form>
          ) : (
            <>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 font-code-sm text-code-sm">
                <div>
                  <dt className="text-on-surface-variant uppercase">Subtotal</dt>
                  <dd className="text-on-surface">{cotizacionSeleccionada.valor}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">IVA ({cotizacionSeleccionada.iva_porcentaje}%)</dt>
                  <dd className="text-on-surface">{cotizacionSeleccionada.iva_valor}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Total</dt>
                  <dd className="text-on-surface font-bold">{cotizacionSeleccionada.total}</dd>
                </div>
              </dl>

              {cotizacionSeleccionada.descripcion && (
                <div className="mt-3">
                  <p className="font-code-sm text-[10px] text-on-surface-variant uppercase mb-1">Nota de la cotización</p>
                  <p className="font-body-md text-body-md text-on-surface">{cotizacionSeleccionada.descripcion}</p>
                </div>
              )}
            </>
          )}
          </div>

          {/* ACCIONES — cambio de estado (guía de UX según TRANSICIONES;
              el backend es la única autoridad real). Enlace público y
              gestión de anticipo/saldo, cada una con sus propias
              precondiciones de estado, siguen justo debajo. */}
          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-3">Acciones</p>
            <div className="flex flex-wrap gap-3">
              {(TRANSICIONES[cotizacionSeleccionada.estado] ?? []).map((destino) => (
                <button
                  key={destino}
                  type="button"
                  disabled={cambiando}
                  onClick={() => handleCambiarEstado(destino)}
                  className={`inline-flex items-center px-4 py-2 border transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer ${
                    destino === 'CANCELADA'
                      ? 'border-error text-error hover:bg-error hover:text-on-error'
                      : 'border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container'
                  }`}
                >
                  {etiquetaTransicionCotizacion(destino)}
                </button>
              ))}
              {(TRANSICIONES[cotizacionSeleccionada.estado] ?? []).length === 0 && (
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                  Este estado no admite más transiciones.
                </p>
              )}
            </div>
            {mensajeCambio && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-3">{mensajeCambio}</p>
            )}
          </div>

          {/* Enlace público — solo disponible para cotizaciones ENVIADA
              (misma restricción que ya exige el backend). Ningún envío
              automático: Comercial copia/comparte el enlace y, si el
              cliente lo pide, el código, siempre manualmente y fuera del
              sistema. */}
          {cotizacionSeleccionada.estado === 'ENVIADA' && (
            <div className="border-t border-outline pt-4 space-y-3">
              <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Enlace público</p>

              {!enlaceInfo && (
                <>
                  <button
                    type="button"
                    disabled={generandoEnlace}
                    onClick={handleGenerarEnlace}
                    className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {generandoEnlace ? 'GENERANDO...' : 'GENERAR ENLACE'}
                  </button>
                  <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                    El enlace y el código deben compartirse únicamente con el cliente correspondiente.
                  </p>
                </>
              )}

              {enlaceInfo && (
                <div className="bg-background border border-primary-container p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex w-2 h-2 rounded-full bg-primary-container" />
                    <p className="font-label-caps text-label-caps text-primary-container uppercase">
                      Enlace público — activo
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleCopiarEnlace}
                      className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                    >
                      {enlaceCopiado ? 'ENLACE COPIADO' : 'COPIAR ENLACE'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMostrandoCodigo((v) => !v)}
                      className="inline-flex items-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                    >
                      {mostrandoCodigo ? 'OCULTAR CÓDIGO' : 'MOSTRAR CÓDIGO'}
                    </button>
                    <button
                      type="button"
                      disabled={generandoEnlace}
                      onClick={handleGenerarEnlace}
                      className="inline-flex items-center px-4 py-2 border border-outline text-on-surface-variant hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      {generandoEnlace ? 'REGENERANDO...' : 'REGENERAR'}
                    </button>
                  </div>

                  {mostrandoCodigo && (
                    <p className="font-code-sm text-code-sm text-on-surface">
                      Código de acceso: <span className="text-primary-container font-bold">{enlaceInfo.codigo}</span>
                    </p>
                  )}

                  <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                    El enlace y el código deben compartirse únicamente con el cliente correspondiente. Regenerar
                    invalida el código anterior.
                  </p>
                </div>
              )}

              {mensajeEnlace && (
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">{mensajeEnlace}</p>
              )}
            </div>
          )}

          {cotizacionSeleccionada.estado === 'ACEPTADA' &&
            cotizacionSeleccionada.estado_anticipo &&
            cotizacionSeleccionada.estado_anticipo !== 'NO_APLICA' && (
              <div className="border-t border-outline pt-4 space-y-3">
                <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Anticipo</p>
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
                    className="inline-flex items-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
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
                      className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      VALIDAR ANTICIPO
                    </button>
                    <button
                      type="button"
                      disabled={gestionandoAnticipo}
                      onClick={() => handleGestionarAnticipo('RECHAZAR')}
                      className="inline-flex items-center px-4 py-2 border border-error text-error hover:bg-error hover:text-on-error transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      RECHAZAR ANTICIPO
                    </button>
                  </div>
                )}

                {mensajeAnticipo && (
                  <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">{mensajeAnticipo}</p>
                )}
              </div>
            )}

          {cotizacionSeleccionada.estado === 'ACEPTADA' && (
            <div className="border-t border-outline pt-4 space-y-3">
              <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Saldo</p>
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
                  className="inline-flex items-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
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
                      className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      VALIDAR SALDO
                    </button>
                    <button
                      type="button"
                      disabled={gestionandoSaldo}
                      onClick={() => handleGestionarSaldo('RECHAZAR')}
                      className="inline-flex items-center px-4 py-2 border border-error text-error hover:bg-error hover:text-on-error transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      RECHAZAR SALDO
                    </button>
                  </div>
                </div>
              )}

              {cotizacionSeleccionada.estado_saldo === 'RECHAZADO' && (
                <div className="space-y-3">
                  <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">
                    Saldo rechazado. Puede reabrirlo para permitir un nuevo intento de pago.
                  </p>
                  <button
                    type="button"
                    disabled={gestionandoSaldo}
                    onClick={handleReabrirSaldo}
                    className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    {gestionandoSaldo ? 'REABRIENDO...' : 'REABRIR SALDO'}
                  </button>
                </div>
              )}

              {mensajeSaldo && <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">{mensajeSaldo}</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Vista ADMIN — bandeja de solo supervisión. Se autoriza explícitamente
  // sin botón "Nueva cotización" y sin ninguna acción comercial: solo
  // KPI + filtros + tabla + paginación, todo de lectura. No se modifica en
  // esta tarea (rediseño exclusivo de COMERCIAL — el listado que sigue
  // después de este bloque).
  if (esAdmin) {
    return (
      <div className="space-y-8">
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase max-w-2xl">
          Vista de supervisión: consulte el estado y las condiciones comerciales de las cotizaciones registradas. Esta
          vista no permite crear, enviar ni modificar cotizaciones — esas acciones son responsabilidad de Comercial.
        </p>

        {loadingLista && (
          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO COTIZACIONES...</p>
        )}
        {!loadingLista && errorLista && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorLista}</p>}
        {!loadingLista && !errorLista && cotizaciones && cotizaciones.length === 0 && (
          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">NO HAY COTIZACIONES REGISTRADAS.</p>
        )}

        {!loadingLista && !errorLista && cotizaciones && cotizaciones.length > 0 && (
          <>
            {/* KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
              <KpiCotizacion
                icono="request_quote"
                valor={kpisAdmin.total}
                etiqueta="Total"
                claseIcono="bg-surface-container-high text-on-surface"
                claseBorde="border-l-outline"
              />
              <KpiCotizacion
                icono="draft"
                valor={kpisAdmin.BORRADOR}
                etiqueta="Borrador"
                claseIcono="bg-surface-container-high text-on-surface-variant"
                claseBorde="border-l-outline"
              />
              <KpiCotizacion
                icono="send"
                valor={kpisAdmin.ENVIADA}
                etiqueta="Enviadas"
                claseIcono="bg-primary-container/20 text-primary-container"
                claseBorde="border-l-primary-container"
              />
              <KpiCotizacion
                icono="check_circle"
                valor={kpisAdmin.ACEPTADA}
                etiqueta="Aceptadas"
                claseIcono="bg-primary-container text-on-primary-container"
                claseBorde="border-l-primary-container"
              />
              <KpiCotizacion
                icono="cancel"
                valor={kpisAdmin.RECHAZADA}
                etiqueta="Rechazadas"
                claseIcono="bg-error-container/40 text-error"
                claseBorde="border-l-error"
              />
              <KpiCotizacion
                icono="schedule"
                valor={kpisAdmin.VENCIDA}
                etiqueta="Vencidas"
                claseIcono="bg-outline-variant/30 text-on-surface-variant"
                claseBorde="border-l-outline-variant"
              />
              <KpiCotizacion
                icono="block"
                valor={kpisAdmin.CANCELADA}
                etiqueta="Canceladas"
                claseIcono="bg-secondary-container/40 text-secondary"
                claseBorde="border-l-secondary-container"
              />
            </div>

            {/* FILTROS */}
            <div className="bg-surface sharp-border p-5 space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                    search
                  </span>
                  <input
                    type="text"
                    value={busquedaAdmin}
                    onChange={(e) => setBusquedaAdmin(e.target.value)}
                    placeholder="Buscar por cliente, servicio o descripción…"
                    className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                  />
                </div>
                <div className="relative">
                  <select
                    value={estadoFiltroAdmin}
                    onChange={(e) => setEstadoFiltroAdmin(e.target.value as EstadoFiltroCotizacion)}
                    className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    {ESTADOS_FILTRO_COTIZACION.map((estado) => (
                      <option key={estado} value={estado}>
                        {estado === 'TODOS' ? 'Estado: Todos' : estado}
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
                    onChange={(e) => setOrdenPorAdmin(e.target.value as OrdenPorAdmin)}
                    className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    <option value="recientes">Más recientes</option>
                    <option value="antiguos">Más antiguas</option>
                    <option value="mayor_valor">Mayor valor</option>
                    <option value="menor_valor">Menor valor</option>
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
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Fecha</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Cliente</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Servicio</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Valor</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Anticipo</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Saldo</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Vigencia</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Estado</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase text-right">
                      Acción
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {datosPaginaAdmin.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-6 px-4 text-center font-code-sm text-code-sm text-on-surface-variant uppercase">
                        Ningún resultado coincide con estos filtros.
                      </td>
                    </tr>
                  )}
                  {datosPaginaAdmin.map((c) => {
                    const solicitud = solicitudesPorId.get(c.solicitud_id);
                    return (
                      <tr key={c.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                          {new Date(c.creado_en).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 font-body-md text-body-md text-on-surface">
                          {nombreClienteAdmin(solicitud?.cliente_id)}
                        </td>
                        <td className="py-3 px-4 font-body-md text-body-md text-on-surface">{solicitud?.servicio ?? '—'}</td>
                        <td className="py-3 px-4 font-body-md text-body-md text-on-surface">{c.total ?? c.valor}</td>
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                          {c.estado_anticipo === 'NO_APLICA' || !c.anticipo_porcentaje
                            ? 'No aplica'
                            : `${c.anticipo_porcentaje}% · ${c.estado_anticipo}`}
                        </td>
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                          {c.saldo_pendiente ? `${c.saldo_pendiente} · ${c.estado_saldo}` : '—'}
                        </td>
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                          {c.fecha_vigencia ? new Date(c.fecha_vigencia).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex px-2.5 py-1 font-code-sm text-[10px] uppercase ${claseBadgeEstadoCotizacion(c.estado)}`}
                          >
                            {c.estado}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => abrirDetalle(c.id)}
                            className="inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                          >
                            VER
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
              {datosPaginaAdmin.map((c) => {
                const solicitud = solicitudesPorId.get(c.solicitud_id);
                return (
                  <div key={c.id} className="bg-surface sharp-border border-l-4 border-l-primary-container p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-body-md text-body-md text-on-surface font-medium">{solicitud?.servicio ?? '—'}</p>
                        <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-0.5">
                          {nombreClienteAdmin(solicitud?.cliente_id)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 px-2.5 py-1 font-code-sm text-[10px] uppercase ${claseBadgeEstadoCotizacion(c.estado)}`}
                      >
                        {c.estado}
                      </span>
                    </div>

                    <dl className="grid grid-cols-2 gap-2 font-code-sm text-[11px]">
                      <div>
                        <dt className="text-on-surface-variant uppercase">Valor</dt>
                        <dd className="text-on-surface">{c.total ?? c.valor}</dd>
                      </div>
                      <div>
                        <dt className="text-on-surface-variant uppercase">Fecha</dt>
                        <dd className="text-on-surface">{new Date(c.creado_en).toLocaleDateString()}</dd>
                      </div>
                      <div>
                        <dt className="text-on-surface-variant uppercase">Anticipo</dt>
                        <dd className="text-on-surface">
                          {c.estado_anticipo === 'NO_APLICA' || !c.anticipo_porcentaje
                            ? 'No aplica'
                            : `${c.anticipo_porcentaje}% · ${c.estado_anticipo}`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-on-surface-variant uppercase">Saldo</dt>
                        <dd className="text-on-surface">{c.saldo_pendiente ? `${c.saldo_pendiente} · ${c.estado_saldo}` : '—'}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-on-surface-variant uppercase">Vigencia</dt>
                        <dd className="text-on-surface">
                          {c.fecha_vigencia ? new Date(c.fecha_vigencia).toLocaleDateString() : '—'}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex items-center justify-end pt-1 border-t border-outline">
                      <button
                        type="button"
                        onClick={() => abrirDetalle(c.id)}
                        className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                      >
                        VER
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* PAGINACIÓN */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-surface sharp-border p-4">
              <div className="flex items-center gap-3">
                <span className="font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                  Mostrando {ordenadasAdmin.length === 0 ? 0 : (paginaEfectivaAdmin - 1) * registrosPorPaginaAdmin + 1}–
                  {Math.min(paginaEfectivaAdmin * registrosPorPaginaAdmin, ordenadasAdmin.length)} de {ordenadasAdmin.length}{' '}
                  cotizaciones
                </span>
                <div className="relative">
                  <select
                    value={registrosPorPaginaAdmin}
                    onChange={(e) => setRegistrosPorPaginaAdmin(Number(e.target.value))}
                    className="appearance-none bg-background border border-outline pl-3 pr-11 py-1.5 text-on-surface font-['Inter'] text-[13px] font-normal focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    {REGISTROS_POR_PAGINA_OPCIONES_COTIZACION.map((n) => (
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

  return (
    <div className="space-y-8">
      <div>
        <h2 className="font-headline-md text-headline-md text-on-surface uppercase">Gestión de cotizaciones</h2>
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-1">
          Administra, revisa y envía las cotizaciones comerciales.
        </p>
      </div>

      {loadingLista && (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO COTIZACIONES...</p>
      )}
      {!loadingLista && errorLista && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorLista}</p>}

      {!loadingLista && !errorLista && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
            <KpiCotizacion
              icono="request_quote"
              valor={kpisAdmin.total}
              etiqueta="Total"
              claseIcono="bg-surface-container-high text-on-surface"
              claseBorde="border-l-outline"
            />
            <KpiCotizacion
              icono="draft"
              valor={kpisAdmin.BORRADOR}
              etiqueta="Borradores"
              claseIcono="bg-surface-container-high text-on-surface-variant"
              claseBorde="border-l-outline"
            />
            <KpiCotizacion
              icono="send"
              valor={kpisAdmin.ENVIADA}
              etiqueta="Enviadas"
              claseIcono="bg-primary-container/20 text-primary-container"
              claseBorde="border-l-primary-container"
            />
            <KpiCotizacion
              icono="check_circle"
              valor={kpisAdmin.ACEPTADA}
              etiqueta="Aceptadas"
              claseIcono="bg-primary-container text-on-primary-container"
              claseBorde="border-l-primary-container"
            />
            <KpiCotizacion
              icono="cancel"
              valor={kpisAdmin.RECHAZADA}
              etiqueta="Rechazadas"
              claseIcono="bg-error-container/40 text-error"
              claseBorde="border-l-error"
            />
            <KpiCotizacion
              icono="schedule"
              valor={kpisAdmin.VENCIDA}
              etiqueta="Vencidas"
              claseIcono="bg-outline-variant/30 text-on-surface-variant"
              claseBorde="border-l-outline-variant"
            />
            <KpiCotizacion
              icono="block"
              valor={kpisAdmin.CANCELADA}
              etiqueta="Canceladas"
              claseIcono="bg-secondary-container/40 text-secondary"
              claseBorde="border-l-secondary-container"
            />
          </div>

          {/* NUEVA COTIZACIÓN — sección compacta y colapsable (rediseño
              autorizado — "REDISEÑO UI GESTIÓN DE COTIZACIONES —
              COMERCIAL"): no ocupa espacio cuando no se usa. Mismo
              endpoint/validaciones de siempre (POST /api/cotizaciones);
              ninguna regla de negocio se mueve al frontend. */}
          <div className="bg-surface sharp-border p-6">
            <button
              type="button"
              onClick={() => setMostrandoFormularioCrear((v) => !v)}
              className="w-full flex items-center justify-between cursor-pointer"
            >
              <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase">
                + NUEVA COTIZACIÓN
              </h3>
              <span className="material-symbols-outlined text-primary-container text-[20px]">
                {mostrandoFormularioCrear ? 'expand_less' : 'expand_more'}
              </span>
            </button>

            {mostrandoFormularioCrear && (
              <div className="mt-4 space-y-4">
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                  Solo se puede crear para una solicitud existente en estado EN_REVISION.
                </p>

                {/* Selector de solicitud amigable — cliente/servicio/
                    descripción en vez del UUID plano como único punto de
                    interacción. Datos resueltos de /api/solicitudes +
                    /api/clientes (ya cargados más arriba); si no hay datos
                    de apoyo disponibles, se ofrece el UUID como respaldo
                    técnico, nunca un cliente/servicio inventado. */}
                <div>
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                    Solicitud
                  </label>

                  {solicitudSeleccionadaNueva && !mostrandoBuscadorSolicitud ? (
                    <div className="bg-background border border-primary-container p-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="font-label-caps text-[10px] text-primary-container uppercase mb-1">
                          Solicitud seleccionada
                        </p>
                        <p className="font-body-md text-sm text-on-surface">
                          {nombreClienteAdmin(solicitudSeleccionadaNueva.cliente_id)} —{' '}
                          {solicitudSeleccionadaNueva.servicio}
                        </p>
                        <p className="font-code-sm text-[11px] text-on-surface-variant mt-0.5">
                          {solicitudSeleccionadaNueva.descripcion}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMostrandoBuscadorSolicitud(true)}
                        className="shrink-0 font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-on-surface uppercase underline cursor-pointer"
                      >
                        Cambiar
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                          search
                        </span>
                        <input
                          type="text"
                          value={busquedaSolicitudNueva}
                          onChange={(e) => setBusquedaSolicitudNueva(e.target.value)}
                          placeholder="Buscar solicitud por cliente, servicio o descripción…"
                          className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto border border-outline divide-y divide-outline">
                        {estadoApoyo === 'cargando' && (
                          <p className="p-3 font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                            Cargando solicitudes…
                          </p>
                        )}
                        {estadoApoyo === 'error' && (
                          <p className="p-3 font-['Inter'] text-[13px] font-normal text-error uppercase">
                            No se pudieron cargar las solicitudes.
                          </p>
                        )}
                        {estadoApoyo === 'disponible' && solicitudesElegibles.length === 0 && (
                          <p className="p-3 font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                            Ninguna solicitud EN_REVISION coincide.
                          </p>
                        )}
                        {estadoApoyo === 'disponible' &&
                          solicitudesElegibles.slice(0, 20).map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => handleSeleccionarSolicitudNueva(s.id)}
                              className="w-full text-left p-3 hover:bg-surface-container-high transition-colors cursor-pointer"
                            >
                              <p className="font-body-md text-sm text-on-surface">
                                {nombreClienteAdmin(s.cliente_id)} — {s.servicio}
                              </p>
                              <p className="font-code-sm text-[11px] text-on-surface-variant mt-0.5 line-clamp-1">
                                {s.descripcion}
                              </p>
                            </button>
                          ))}
                      </div>
                      {/* Respaldo técnico: si por algún motivo no hay datos de
                          apoyo disponibles, se permite igual pegar el UUID
                          directo — nunca se bloquea la creación por esto. */}
                      <details className="font-code-sm text-[11px] text-on-surface-variant">
                        <summary className="cursor-pointer uppercase">Usar ID de solicitud directamente</summary>
                        <input
                          value={solicitudIdNueva}
                          onChange={(e) => setSolicitudIdNueva(e.target.value)}
                          className="w-full mt-2 bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md text-sm outline-none"
                          type="text"
                          placeholder="UUID de la solicitud"
                        />
                      </details>
                    </div>
                  )}
                </div>

                <form className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end" onSubmit={handleCrear}>
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
                      className="inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {creando ? 'CREANDO...' : 'CREAR COTIZACIÓN'}
                    </button>
                    {mensajeCrear && (
                      <span className="ml-4 font-code-sm text-xs text-on-surface-variant uppercase">{mensajeCrear}</span>
                    )}
                  </div>
                </form>
              </div>
            )}
          </div>

          {!cotizaciones || cotizaciones.length === 0 ? (
            <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
              NO HAY COTIZACIONES REGISTRADAS.
            </p>
          ) : (
            <>
              {/* FILTROS */}
              <div className="bg-surface sharp-border p-5 space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                      search
                    </span>
                    <input
                      type="text"
                      value={busquedaAdmin}
                      onChange={(e) => setBusquedaAdmin(e.target.value)}
                      placeholder="Buscar por cliente, servicio, descripción o ID…"
                      className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                    />
                  </div>
                  <div className="relative">
                    <select
                      value={estadoFiltroAdmin}
                      onChange={(e) => setEstadoFiltroAdmin(e.target.value as EstadoFiltroCotizacion)}
                      className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                    >
                      {ESTADOS_FILTRO_COTIZACION.map((estado) => (
                        <option key={estado} value={estado}>
                          {estado === 'TODOS' ? 'Estado: Todos' : estado}
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
                        onChange={(e) => setOrdenPorAdmin(e.target.value as OrdenPorAdmin)}
                        className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                      >
                        <option value="recientes">Más recientes</option>
                        <option value="antiguos">Más antiguas</option>
                        <option value="mayor_valor">Mayor valor</option>
                        <option value="menor_valor">Menor valor</option>
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
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Fecha</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Cliente</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Servicio</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Valor</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Anticipo</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Saldo</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Vigencia</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Estado</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase text-right">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {datosPaginaAdmin.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-6 px-4 text-center font-code-sm text-code-sm text-on-surface-variant uppercase">
                          Ningún resultado coincide con estos filtros.
                        </td>
                      </tr>
                    )}
                    {datosPaginaAdmin.map((c) => {
                      const solicitud = solicitudesPorId.get(c.solicitud_id);
                      return (
                        <tr key={c.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                          <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                            {new Date(c.creado_en).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 font-body-md text-body-md text-on-surface">
                            {nombreClienteAdmin(solicitud?.cliente_id)}
                          </td>
                          <td className="py-3 px-4 font-body-md text-body-md text-on-surface">{solicitud?.servicio ?? '—'}</td>
                          <td className="py-3 px-4 font-body-md text-body-md text-on-surface">{c.total ?? c.valor}</td>
                          <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                            {c.estado_anticipo === 'NO_APLICA' || !c.anticipo_porcentaje
                              ? 'No aplica'
                              : `${c.anticipo_porcentaje}% · ${c.estado_anticipo}`}
                          </td>
                          <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                            {c.saldo_pendiente ? `${c.saldo_pendiente} · ${c.estado_saldo}` : '—'}
                          </td>
                          <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                            {c.fecha_vigencia ? new Date(c.fecha_vigencia).toLocaleDateString() : '—'}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex px-2.5 py-1 font-code-sm text-[10px] uppercase ${claseBadgeEstadoCotizacion(c.estado)}`}
                            >
                              {c.estado}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => abrirDetalle(c.id)}
                              className="inline-flex items-center px-3 py-1 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                            >
                              VER DETALLE
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
                {datosPaginaAdmin.map((c) => {
                  const solicitud = solicitudesPorId.get(c.solicitud_id);
                  return (
                    <div key={c.id} className="bg-surface sharp-border border-l-4 border-l-primary-container p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-body-md text-body-md text-on-surface font-medium">{solicitud?.servicio ?? '—'}</p>
                          <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-0.5">
                            {nombreClienteAdmin(solicitud?.cliente_id)}
                          </p>
                        </div>
                        <span
                          className={`inline-flex shrink-0 px-2.5 py-1 font-code-sm text-[10px] uppercase ${claseBadgeEstadoCotizacion(c.estado)}`}
                        >
                          {c.estado}
                        </span>
                      </div>

                      <dl className="grid grid-cols-2 gap-2 font-code-sm text-[11px]">
                        <div>
                          <dt className="text-on-surface-variant uppercase">Valor</dt>
                          <dd className="text-on-surface">{c.total ?? c.valor}</dd>
                        </div>
                        <div>
                          <dt className="text-on-surface-variant uppercase">Fecha</dt>
                          <dd className="text-on-surface">{new Date(c.creado_en).toLocaleDateString()}</dd>
                        </div>
                        <div>
                          <dt className="text-on-surface-variant uppercase">Anticipo</dt>
                          <dd className="text-on-surface">
                            {c.estado_anticipo === 'NO_APLICA' || !c.anticipo_porcentaje
                              ? 'No aplica'
                              : `${c.anticipo_porcentaje}% · ${c.estado_anticipo}`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-on-surface-variant uppercase">Saldo</dt>
                          <dd className="text-on-surface">{c.saldo_pendiente ? `${c.saldo_pendiente} · ${c.estado_saldo}` : '—'}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-on-surface-variant uppercase">Vigencia</dt>
                          <dd className="text-on-surface">
                            {c.fecha_vigencia ? new Date(c.fecha_vigencia).toLocaleDateString() : '—'}
                          </dd>
                        </div>
                      </dl>

                      <div className="flex items-center justify-end pt-1 border-t border-outline">
                        <button
                          type="button"
                          onClick={() => abrirDetalle(c.id)}
                          className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-outline text-on-surface hover:bg-primary-container hover:text-on-primary-container hover:border-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                        >
                          VER DETALLE
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* PAGINACIÓN */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-surface sharp-border p-4">
                <div className="flex items-center gap-3">
                  <span className="font-['Inter'] text-[13px] font-normal text-on-surface-variant">
                    Mostrando {ordenadasAdmin.length === 0 ? 0 : (paginaEfectivaAdmin - 1) * registrosPorPaginaAdmin + 1}–
                    {Math.min(paginaEfectivaAdmin * registrosPorPaginaAdmin, ordenadasAdmin.length)} de{' '}
                    {ordenadasAdmin.length} cotizaciones
                  </span>
                  <div className="relative">
                    <select
                      value={registrosPorPaginaAdmin}
                      onChange={(e) => setRegistrosPorPaginaAdmin(Number(e.target.value))}
                      className="appearance-none bg-background border border-outline pl-3 pr-11 py-1.5 text-on-surface font-['Inter'] text-[13px] font-normal focus:border-primary-container focus:outline-hidden cursor-pointer"
                    >
                      {REGISTROS_POR_PAGINA_OPCIONES_COTIZACION.map((n) => (
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
        </>
      )}
    </div>
  );
}
