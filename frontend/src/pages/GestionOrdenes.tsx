import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Eye } from 'lucide-react';
import { fetchAutenticado, SesionInvalidaError, type Usuario } from '../lib/authClient';
import { coincideCodigo } from '../lib/busqueda';
import { ayudaReferencia, referenciaOrigen } from '../lib/referenciasOrden';
import { useBusquedaServidor } from '../lib/busquedaServidor';
import type { Solicitud } from './BandejaSolicitudes';

export interface Orden {
  id: string;
  cotizacion_id: string;
  // Bloque 2B.1: solicitud de la orden (derivada en backend; abre la conversación de esa solicitud).
  solicitud_id?: string;
  // #11: números de origen que entrega el backend (null en registros anteriores a la numeración).
  solicitud_codigo?: string | null;
  cotizacion_codigo?: string | null;
  responsable_id: string | null;
  estado: string;
  codigo: string;
  descripcion: string | null;
  fecha_inicio: string | null;
  fecha_entrega: string | null;
  fecha_programada: string | null;
  fecha_finalizacion: string | null;
  fecha_cierre: string | null;
  observaciones: string | null;
  creado_en: string;
  actualizado_en: string;
  avance: number;
  entrega_confirmada_en: string | null;
  // V22: quién ejecutó cada hito (null = no registrado, p. ej. órdenes anteriores a V22).
  responsable_nombre?: string | null;
  estado_cambiado_por_nombre?: string | null;
  finalizada_por_nombre?: string | null;
  entrega_confirmada_por_nombre?: string | null;
  cerrada_por_nombre?: string | null;
}

// V22: ' · por <nombre>' junto a una fecha; si el hito ocurrió pero el autor no se registró, se dice sin inventarlo.
function textoAutor(nombre: string | null | undefined): string {
  return nombre ? ` · por ${nombre}` : ' · autor no registrado';
}

interface OrdenEvidencia {
  id: string;
  orden_id: string;
  tipo: string;
  nombre_archivo: string;
  creado_en: string;
}

// Solo los campos de saldo, necesarios para la sección "Cierre" de este
// componente — no se reutiliza la interfaz completa de GestionCotizaciones.
interface CotizacionSaldo {
  estado_saldo: string;
  saldo_pendiente: string | null;
}

// Vista ADMIN (autorización explícita — "AUTORIZACIÓN DE IMPLEMENTACIÓN —
// ÓRDENES ADMIN"): consulta/supervisión + asignar responsable únicamente.
// Reutiliza el `esAdmin` que este componente ya recibía (antes solo para
// "Asignar responsable") — no se agrega ninguna prop ni lógica de
// autenticación nueva; AreaPrivada.tsx no se modifica.

interface ClienteResumen {
  nombre: string;
  empresa: string | null;
}

// `anticipo_porcentaje`/`estado_anticipo` se agregan aquí (rediseño
// autorizado — "REDISEÑO UI ÓRDENES — ROL COMERCIAL"): ya venían en la
// respuesta real de /api/cotizaciones (fetch ya existente, sin endpoint
// nuevo) — solo faltaba conservarlos en este resumen local, necesarios
// para decidir qué cotizaciones son candidatas a crear una orden.
interface CotizacionResumen {
  id: string;
  // N.º legible de la cotización (COT-XXXXXX); null en cotizaciones anteriores a la numeración.
  codigo?: string | null;
  solicitud_id: string;
  estado: string;
  valor: string;
  total: string | null;
  anticipo_porcentaje: string | null;
  estado_anticipo: string | null;
  estado_saldo: string;
  saldo_pendiente: string | null;
}

type EstadoApoyo = 'cargando' | 'disponible' | 'error';

const ESTADOS_FILTRO_ORDEN = ['TODOS', 'PENDIENTE', 'EN_PROCESO', 'PAUSADA', 'FINALIZADA', 'CERRADA', 'CANCELADA'] as const;
type EstadoFiltroOrden = (typeof ESTADOS_FILTRO_ORDEN)[number];

type OrdenPorAdmin = 'recientes' | 'antiguos' | 'mayor_avance' | 'menor_avance';

const REGISTROS_POR_PAGINA_OPCIONES_ORDEN = [10, 25, 50] as const;

// Badges por estado real de orden — colores tomados exclusivamente de los
// tokens ya definidos en index.css, mismo criterio ya usado en
// BandejaSolicitudes.tsx / GestionCotizaciones.tsx.
const BADGE_ESTADO_ORDEN: Record<string, string> = {
  PENDIENTE: 'border border-outline text-on-surface-variant',
  EN_PROCESO: 'border border-primary-container text-primary-container bg-primary-container/10',
  PAUSADA: 'border border-outline-variant text-on-surface-variant bg-outline-variant/10',
  FINALIZADA: 'border border-primary-container bg-primary-container text-on-primary-container',
  CERRADA: 'border border-secondary-container text-secondary bg-secondary-container/30',
  CANCELADA: 'border border-error text-error bg-error-container/20',
};

function claseBadgeEstadoOrden(estado: string): string {
  return BADGE_ESTADO_ORDEN[estado] ?? 'border border-outline text-on-surface-variant';
}

function fechaEnRangoOrden(fechaIso: string, desde: string, hasta: string): boolean {
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

// `ordenes.fecha_entrega` es DATE (fecha de calendario, sin hora ni zona
// horaria real — V0__esquema_base.sql) — el driver `pg` la entrega como un
// string ISO con hora de medianoche local y sufijo "Z" (ej.
// "2026-10-06T05:00:00.000Z" para la fecha calendario 2026-10-06 en un
// servidor en UTC-5; mismo mecanismo ya documentado en
// DetalleSolicitud.tsx::formatearFechaSolo). Convertirla con `new Date(...)`
// y formatearla en el navegador arriesga mostrar el día anterior o
// siguiente si el huso horario del navegador no coincide con el del
// servidor — por eso se lee directamente el fragmento YYYY-MM-DD de la
// cadena, sin construir ningún objeto Date ni hacer ninguna conversión de
// huso horario. Devuelve null ante un valor ausente o no reconocible, para
// que cada vista use su propio texto de ausencia ya existente ('Sin
// definir' en el panel de detalle, '—' en tabla/tarjeta).
function formatearFechaEntrega(valor: string | null): string | null {
  if (!valor) return null;
  const coincidencia = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!coincidencia) return null;
  const [, anio, mes, dia] = coincidencia;
  // 1970-01-01 es la época Unix (dato nulo mal convertido), no una fecha de entrega real.
  if (anio === '1970' && mes === '01' && dia === '01') return null;
  return `${dia}/${mes}/${anio}`;
}

function KpiOrden({
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
        <p className="font-['JetBrains_Mono'] text-[10px] font-bold tracking-[0.02em] leading-[1.2] text-on-surface-variant uppercase mt-1 break-words">
          {etiqueta}
        </p>
      </div>
    </div>
  );
}

// Barra de progreso de solo lectura — mismo lenguaje visual que
// "Distribución de solicitudes" en BandejaSolicitudes.tsx, sin librería
// nueva.
function BarraProgreso({ valor }: { valor: number }) {
  const porcentaje = Math.max(0, Math.min(100, valor));
  return (
    <div className="w-full h-2 bg-surface-container-high">
      <div className="h-2 bg-primary-container" style={{ width: `${porcentaje}%` }} />
    </div>
  );
}

interface GestionOrdenesProps {
  token: string;
  esAdmin: boolean;
  // F-08: true para ADMIN/OPERATIVO (pueden cambiar estado), false para
  // COMERCIAL (solo lectura). Independiente de `esAdmin`, que sigue
  // controlando exclusivamente "Asignar responsable".
  puedeGestionar: boolean;
  // E-01: id del usuario en sesión. Solo guía de UX (mostrar/ocultar acciones operativas cuando la
  // orden no es suya); la autorización real la impone el backend (requireResponsableOrden).
  usuarioId: string;
  // Bloque MVP (ficha técnica), decisiones 1-3: ADMIN y COMERCIAL pueden
  // crear la orden; OPERATIVO no.
  puedeCrearOrden: boolean;
  // Bloque saldo/entrega/cierre: exclusivo ADMIN/COMERCIAL — controla la
  // sección "Cierre" (validar saldo se hace desde GestionCotizaciones,
  // confirmar entrega y cerrar se hacen desde aquí). OPERATIVO nunca ve
  // esta sección ni la información de saldo.
  puedeGestionarPago: boolean;
  // Cableado de navegación Alertas -> Órdenes (autorización explícita —
  // "IMPLEMENTACIÓN AUTORIZADA — ALERTAS ADMIN"). Cuando AreaPrivada.tsx
  // lo establece, se abre automáticamente el detalle de esa orden
  // reutilizando abrirDetalle() sin ningún cambio de lógica; se consume
  // una sola vez mediante onOrdenInicialConsumida.
  ordenIdSeleccionadaInicial?: string | null;
  onOrdenInicialConsumida?: () => void;
  // Bloque 2B: abre la comunicación técnica de la SOLICITUD asociada a la orden (misma conversación;
  // no existe chat de orden). El acceso y el modo los decide el backend al cargar los mensajes.
  onVerComunicacion?: (solicitudId: string) => void;
  onSesionInvalida: () => void;
}

interface FichaTecnica {
  id: string;
  orden_id: string;
  contenido: string;
  tiene_inconsistencia: boolean;
  generado_en: string;
  revisado_por: string | null;
  revisado_en: string | null;
}

// Guía de UX únicamente, debe coincidir con TRANSICIONES en
// backend/src/services/ordenes.service.ts. El backend sigue siendo la
// única autoridad real sobre qué transición se acepta.
// H-A (auditoría post-V9): CERRADA se retira de aquí — el backend ya no la
// admite por PATCH /:id/estado (bloque saldo/entrega/cierre). La única vía
// a CERRADA es el botón dedicado de la sección "Cierre" (ADMIN/COMERCIAL).
const TRANSICIONES: Record<string, string[]> = {
  PENDIENTE: ['EN_PROCESO'],
  EN_PROCESO: ['PAUSADA', 'FINALIZADA'],
  PAUSADA: ['EN_PROCESO'],
  FINALIZADA: [],
  CERRADA: [],
  CANCELADA: [],
};

// Bloque 3B: CANCELADA se retira de TRANSICIONES (mismo criterio que el backend) — ya no se alcanza
// por "Cambiar estado". La única vía es el botón dedicado "CANCELAR ORDEN" (ADMIN/COMERCIAL, exige
// motivo); OPERATIVO ya no puede cancelar ni su propia orden.
const ESTADOS_CANCELABLES = ['PENDIENTE', 'EN_PROCESO', 'PAUSADA'];
const ESTADOS_SIN_REPROGRAMACION = ['CERRADA', 'CANCELADA'];
// OPERATIVO-10 (corrige el hallazgo H1 de OPERATIVO-FINAL): mismos 3 estados terminales que ya
// bloquean el avance en el backend (`ESTADOS_AVANCE_BLOQUEADO`, ordenes.service.ts) y la subida de
// evidencia (`ESTADOS_PERMITEN_EVIDENCIA` los excluye). Antes, `puedeEjecutarOrden` solo miraba el
// responsable y nunca el estado, por lo que una orden CANCELADA/CERRADA (o FINALIZADA) del propio
// OPERATIVO seguía mostrando "ACTUALIZAR AVANCE"/"SUBIR EVIDENCIA"/"GENERAR FICHA TÉCNICA" con
// controles habilitados, aunque el backend ya rechazara la acción real (409).
const ESTADOS_EJECUCION_BLOQUEADA = ['FINALIZADA', 'CERRADA', 'CANCELADA'];

export default function GestionOrdenes({
  token,
  esAdmin,
  puedeGestionar,
  usuarioId,
  puedeCrearOrden,
  puedeGestionarPago,
  ordenIdSeleccionadaInicial,
  onOrdenInicialConsumida,
  onVerComunicacion,
  onSesionInvalida,
}: GestionOrdenesProps) {
  const [ordenes, setOrdenes] = useState<Orden[] | null>(null);
  const [loadingLista, setLoadingLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  // Rediseño UI (autorización explícita — "REDISEÑO UI ÓRDENES — ROL
  // COMERCIAL"): sección "NUEVA ORDEN" colapsable, y selector de
  // cotización amigable (cliente/servicio/descripción) en vez del UUID
  // plano como único punto de interacción — reutiliza cotizacionesPorId ya
  // cargado, ningún endpoint nuevo.
  const [mostrandoFormularioCrearOrden, setMostrandoFormularioCrearOrden] = useState(false);
  const [busquedaCotizacionNueva, setBusquedaCotizacionNueva] = useState('');
  const idsCotizacionNueva = useBusquedaServidor('cotizaciones', busquedaCotizacionNueva, token, onSesionInvalida);
  const [mostrandoBuscadorCotizacion, setMostrandoBuscadorCotizacion] = useState(false);

  const [cotizacionIdNueva, setCotizacionIdNueva] = useState('');
  const [descripcionNueva, setDescripcionNueva] = useState('');
  const [fechaEntregaNueva, setFechaEntregaNueva] = useState('');
  const [creando, setCreando] = useState(false);
  const [mensajeCrear, setMensajeCrear] = useState<string | null>(null);

  const [ordenSeleccionada, setOrdenSeleccionada] = useState<Orden | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [mensajeCambio, setMensajeCambio] = useState<string | null>(null);

  const [responsables, setResponsables] = useState<Usuario[] | null>(null);
  const [responsableElegido, setResponsableElegido] = useState('');
  const [asignando, setAsignando] = useState(false);
  const [mensajeResponsable, setMensajeResponsable] = useState<string | null>(null);

  const [ficha, setFicha] = useState<FichaTecnica | null>(null);
  const [loadingFicha, setLoadingFicha] = useState(false);
  const [errorFicha, setErrorFicha] = useState<string | null>(null);
  const [generandoFicha, setGenerandoFicha] = useState(false);
  const [mensajeGenerarFicha, setMensajeGenerarFicha] = useState<string | null>(null);

  const [observacionFinal, setObservacionFinal] = useState('');

  const [avanceInput, setAvanceInput] = useState(0);
  const [actualizandoAvance, setActualizandoAvance] = useState(false);
  const [mensajeAvance, setMensajeAvance] = useState<string | null>(null);

  const [evidencias, setEvidencias] = useState<OrdenEvidencia[] | null>(null);
  const [errorEvidencias, setErrorEvidencias] = useState<string | null>(null);
  const [archivoEvidencia, setArchivoEvidencia] = useState<File | null>(null);
  const [subiendoEvidencia, setSubiendoEvidencia] = useState(false);
  const [mensajeEvidencia, setMensajeEvidencia] = useState<string | null>(null);

  const [cotizacionSaldo, setCotizacionSaldo] = useState<CotizacionSaldo | null>(null);
  const [confirmandoEntrega, setConfirmandoEntrega] = useState(false);
  const [mensajeEntrega, setMensajeEntrega] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [mensajeCerrar, setMensajeCerrar] = useState<string | null>(null);
  // Bloque 3B: cancelación con motivo obligatorio.
  const [mostrandoCancelar, setMostrandoCancelar] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [mensajeCancelar, setMensajeCancelar] = useState<string | null>(null);
  // Bloque 3B: reprogramación de la fecha PROGRAMADA de entrega (fecha_entrega) — distinta de la
  // fecha REAL (entrega_confirmada_en), que solo cambia al confirmar la entrega.
  const [fechaEntregaReprogramada, setFechaEntregaReprogramada] = useState('');
  const [reprogramando, setReprogramando] = useState(false);
  const [mensajeReprogramar, setMensajeReprogramar] = useState<string | null>(null);

  // Vista ADMIN — solo lectura/supervisión + asignar responsable. Estados
  // independientes de los de arriba (exclusivos del flujo COMERCIAL/
  // OPERATIVO, sin ningún cambio).
  const [cotizacionesPorId, setCotizacionesPorId] = useState<Map<string, CotizacionResumen>>(new Map());
  const [solicitudesPorId, setSolicitudesPorId] = useState<Map<string, Solicitud>>(new Map());
  const [clientesPorId, setClientesPorId] = useState<Map<string, ClienteResumen>>(new Map());
  const [usuariosPorId, setUsuariosPorId] = useState<Map<string, string>>(new Map());
  const [estadoApoyo, setEstadoApoyo] = useState<EstadoApoyo>('cargando');

  const [busquedaAdmin, setBusquedaAdmin] = useState('');
  // Búsqueda parcial resuelta en la BD (ids de todas las coincidencias); mientras llega, filtro local.
  const idsServidor = useBusquedaServidor('ordenes', busquedaAdmin, token, onSesionInvalida);
  const [estadoFiltroAdmin, setEstadoFiltroAdmin] = useState<EstadoFiltroOrden>('TODOS');
  const [fechaDesdeAdmin, setFechaDesdeAdmin] = useState('');
  const [fechaHastaAdmin, setFechaHastaAdmin] = useState('');
  const [ordenPorAdmin, setOrdenPorAdmin] = useState<OrdenPorAdmin>('recientes');
  const [paginaActualAdmin, setPaginaActualAdmin] = useState(1);
  const [registrosPorPaginaAdmin, setRegistrosPorPaginaAdmin] = useState<number>(10);

  async function cargar() {
    setLoadingLista(true);
    setErrorLista(null);

    try {
      const response = await fetchAutenticado('/api/ordenes', token);

      if (response.status === 403) {
        setErrorLista('No autorizado para consultar órdenes.');
        return;
      }
      if (!response.ok) {
        setErrorLista('No se pudo cargar el listado de órdenes.');
        return;
      }

      const data = (await response.json()) as { ordenes: Orden[] };
      setOrdenes(data.ordenes);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorLista('No se pudo cargar el listado de órdenes.');
    } finally {
      setLoadingLista(false);
    }
  }

  // Lista de candidatos a responsable (solo ADMIN la necesita): reutiliza
  // GET /api/usuarios, ya existente desde Fase 3.2/6, filtrando en el
  // cliente a OPERATIVO activos únicamente para la UX del selector. La
  // validación real (rol OPERATIVO + activo) la hace igualmente el backend
  // al asignar.
  async function cargarResponsables() {
    try {
      const response = await fetchAutenticado('/api/usuarios', token);
      if (!response.ok) return;
      const data = (await response.json()) as { usuarios: Usuario[] };
      setResponsables(data.usuarios.filter((u) => u.rol === 'OPERATIVO' && u.activo));
      // Vista ADMIN: mismo listado ya solicitado, indexado además por
      // id -> nombre para resolver `responsable_id` en bandeja/detalle sin
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
      cargarResponsables();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, esAdmin]);

  // Cableado de navegación Alertas -> Órdenes: si AreaPrivada.tsx indica
  // una orden a preseleccionar, se abre su detalle reutilizando
  // abrirDetalle() (sin ningún cambio en esa función) y se avisa que ya
  // se consumió, para no reabrirla en cada render.
  useEffect(() => {
    if (ordenIdSeleccionadaInicial) {
      abrirDetalle(ordenIdSeleccionadaInicial);
      onOrdenInicialConsumida?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordenIdSeleccionadaInicial]);

  // Carga de apoyo (cotizaciones + solicitudes + clientes) para resolver
  // cliente/servicio/cotización por cruce — antes exclusiva de la vista
  // ADMIN, ahora también alimenta la bandeja/detalle de COMERCIAL
  // (rediseño autorizado — "REDISEÑO UI ÓRDENES — ROL COMERCIAL"): mismos
  // 3 endpoints ya existentes, ninguno nuevo — COMERCIAL ya tenía acceso
  // real a los 3 (confirmado en la auditoría previa). `cargarResponsables`
  // (más abajo) sigue siendo exclusiva de ADMIN a propósito: COMERCIAL no
  // tiene acceso a /api/usuarios (403 real, confirmado en la auditoría) y
  // no se abre ese permiso aquí.
  //
  // OPERATIVO-10 (corrige el hallazgo H2 de OPERATIVO-FINAL): OPERATIVO no
  // necesita /api/cotizaciones ni /api/clientes para ejecutar sus propias
  // órdenes (mismo criterio ya aplicado en DetalleSolicitud.tsx en
  // OPERATIVO-09.1 — `puedeConsultarCliente`), así que deja de solicitarlos.
  // Sí sigue consultando /api/solicitudes: es el mismo respaldo que ya usa
  // `bloqueComunicacionTecnica` cuando `orden.solicitud_id` no viene en el
  // DTO. ADMIN y COMERCIAL conservan exactamente el comportamiento actual.
  const puedeConsultarApoyoComercial = esAdmin || puedeGestionarPago;
  useEffect(() => {
    let cancelado = false;

    async function cargarApoyo() {
      setEstadoApoyo('cargando');
      try {
        if (!puedeConsultarApoyoComercial) {
          const respSolicitudes = await fetchAutenticado('/api/solicitudes', token);
          if (!respSolicitudes.ok) {
            if (!cancelado) setEstadoApoyo('error');
            return;
          }
          const dataSolicitudes = (await respSolicitudes.json()) as { solicitudes: Solicitud[] };
          if (!cancelado) {
            const mapaSolicitudes = new Map<string, Solicitud>();
            dataSolicitudes.solicitudes.forEach((s) => mapaSolicitudes.set(s.id, s));
            setSolicitudesPorId(mapaSolicitudes);
            setCotizacionesPorId(new Map());
            setClientesPorId(new Map());
            setEstadoApoyo('disponible');
          }
          return;
        }

        const [respCotizaciones, respSolicitudes, respClientes] = await Promise.all([
          fetchAutenticado('/api/cotizaciones', token),
          fetchAutenticado('/api/solicitudes', token),
          fetchAutenticado('/api/clientes', token),
        ]);

        if (!respCotizaciones.ok || !respSolicitudes.ok || !respClientes.ok) {
          if (!cancelado) setEstadoApoyo('error');
          return;
        }

        const dataCotizaciones = (await respCotizaciones.json()) as { cotizaciones: CotizacionResumen[] };
        const dataSolicitudes = (await respSolicitudes.json()) as { solicitudes: Solicitud[] };
        const dataClientes = (await respClientes.json()) as {
          clientes: { id: string; nombre: string; empresa: string | null }[];
        };

        if (!cancelado) {
          const mapaCotizaciones = new Map<string, CotizacionResumen>();
          dataCotizaciones.cotizaciones.forEach((c) => mapaCotizaciones.set(c.id, c));
          const mapaSolicitudes = new Map<string, Solicitud>();
          dataSolicitudes.solicitudes.forEach((s) => mapaSolicitudes.set(s.id, s));
          const mapaClientes = new Map<string, ClienteResumen>();
          dataClientes.clientes.forEach((c) => mapaClientes.set(c.id, { nombre: c.nombre, empresa: c.empresa }));
          setCotizacionesPorId(mapaCotizaciones);
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
  }, [token, onSesionInvalida, puedeConsultarApoyoComercial]);

  function datosClienteServicio(cotizacionId: string): { cliente: string; servicio: string; solicitud: Solicitud | null } {
    if (estadoApoyo === 'cargando') return { cliente: 'Cargando…', servicio: 'Cargando…', solicitud: null };
    if (estadoApoyo === 'error') return { cliente: '—', servicio: '—', solicitud: null };
    const cotizacion = cotizacionesPorId.get(cotizacionId);
    if (!cotizacion) return { cliente: '—', servicio: '—', solicitud: null };
    const solicitud = solicitudesPorId.get(cotizacion.solicitud_id) ?? null;
    if (!solicitud) return { cliente: '—', servicio: '—', solicitud: null };
    const cliente = clientesPorId.get(solicitud.cliente_id);
    const nombreCliente = cliente ? (cliente.empresa?.trim() ? cliente.empresa : cliente.nombre) : '—';
    return { cliente: nombreCliente, servicio: solicitud.servicio, solicitud };
  }

  function nombreResponsableAdmin(responsableId: string | null): string {
    if (!responsableId) return 'Sin asignar';
    if (estadoApoyo === 'cargando') return 'Cargando…';
    return usuariosPorId.get(responsableId) ?? '—';
  }

  // COMERCIAL/OPERATIVO no tienen acceso a /api/usuarios (403 real,
  // confirmado en la auditoría — "AUDITORÍA REAL DE ÓRDENES — ROL
  // COMERCIAL") — nunca se inventa un nombre para ellos. ADMIN sí puede
  // resolverlo (usuariosPorId ya viene de cargarResponsables, exclusivo de
  // ADMIN) y sigue usando nombreResponsableAdmin() sin cambios. Este
  // helper es exclusivamente para las vistas COMERCIAL/OPERATIVO nuevas.
  function responsableMostrable(responsableId: string | null, nombre?: string | null): string {
    if (!responsableId) return 'Sin asignar';
    return nombre || 'Responsable asignado';
  }

  const kpisAdmin = useMemo(() => {
    const base = { total: 0, PENDIENTE: 0, EN_PROCESO: 0, PAUSADA: 0, FINALIZADA: 0, CERRADA: 0, CANCELADA: 0 };
    if (!ordenes) return base;
    base.total = ordenes.length;
    for (const o of ordenes) {
      if (o.estado in base) {
        (base as Record<string, number>)[o.estado] += 1;
      }
    }
    return base;
  }, [ordenes]);

  const filtradasAdmin = useMemo(() => {
    if (!ordenes) return [];
    const termino = busquedaAdmin.trim().toLowerCase();

    return ordenes.filter((o) => {
      if (estadoFiltroAdmin !== 'TODOS' && o.estado !== estadoFiltroAdmin) return false;
      if (!fechaEnRangoOrden(o.creado_en, fechaDesdeAdmin, fechaHastaAdmin)) return false;

      if (termino && idsServidor) {
        if (!idsServidor.has(o.id)) return false;
      } else if (termino) {
        const { cliente, servicio, solicitud } = datosClienteServicio(o.cotizacion_id);
        const responsable = nombreResponsableAdmin(o.responsable_id);
        const coincide =
          o.codigo.toLowerCase().includes(termino) ||
          coincideCodigo(termino, o.codigo) ||
          coincideCodigo(termino, solicitud?.codigo) ||
          coincideCodigo(termino, cotizacionesPorId.get(o.cotizacion_id)?.codigo) ||
          cliente.toLowerCase().includes(termino) ||
          servicio.toLowerCase().includes(termino) ||
          responsable.toLowerCase().includes(termino);
        if (!coincide) return false;
      }

      return true;
    });
  }, [
    ordenes,
    busquedaAdmin,
    idsServidor,
    estadoFiltroAdmin,
    fechaDesdeAdmin,
    fechaHastaAdmin,
    cotizacionesPorId,
    solicitudesPorId,
    clientesPorId,
    usuariosPorId,
    estadoApoyo,
  ]);

  const ordenadasAdmin = useMemo(() => {
    const copia = [...filtradasAdmin];
    copia.sort((a, b) => {
      if (ordenPorAdmin === 'mayor_avance' || ordenPorAdmin === 'menor_avance') {
        const diferencia = a.avance - b.avance;
        return ordenPorAdmin === 'mayor_avance' ? -diferencia : diferencia;
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

  // Cotizaciones candidatas a crear una orden — misma precondición real
  // que ya exige crearOrden() en el backend (ACEPTADA + anticipo NO_APLICA
  // o VALIDADO), aquí solo como guía de UX; el backend sigue siendo la
  // única autoridad. Se excluyen además las que ya tienen una orden
  // existente (índice único por cotizacion_id) usando la lista de órdenes
  // ya cargada — evita ofrecer una cotización que el backend rechazaría
  // con "Ya existe una orden para esta cotización.".
  const cotizacionesConOrden = useMemo(() => {
    const set = new Set<string>();
    (ordenes ?? []).forEach((o) => set.add(o.cotizacion_id));
    return set;
  }, [ordenes]);

  const cotizacionesElegibles = useMemo(() => {
    const termino = busquedaCotizacionNueva.trim().toLowerCase();
    const todas: CotizacionResumen[] = Array.from(cotizacionesPorId.values());
    return todas
      .filter((c) => c.estado === 'ACEPTADA')
      .filter((c) => c.estado_anticipo === 'NO_APLICA' || c.estado_anticipo === 'VALIDADO')
      .filter((c) => !cotizacionesConOrden.has(c.id))
      .filter((c) => {
        if (!termino) return true;
        if (idsCotizacionNueva) return idsCotizacionNueva.has(c.id);
        const solicitud = solicitudesPorId.get(c.solicitud_id) ?? null;
        const cliente = solicitud && estadoApoyo === 'disponible' ? clientesPorId.get(solicitud.cliente_id) : null;
        return (
          c.id.toLowerCase().includes(termino) ||
          coincideCodigo(termino, c.codigo) ||
          coincideCodigo(termino, solicitud?.codigo) ||
          (solicitud?.servicio.toLowerCase().includes(termino) ?? false) ||
          (solicitud?.descripcion.toLowerCase().includes(termino) ?? false) ||
          (cliente?.nombre.toLowerCase().includes(termino) ?? false) ||
          (cliente?.empresa ? cliente.empresa.toLowerCase().includes(termino) : false)
        );
      });
  }, [cotizacionesPorId, solicitudesPorId, clientesPorId, estadoApoyo, cotizacionesConOrden, busquedaCotizacionNueva, idsCotizacionNueva]);

  const cotizacionSeleccionadaNueva = cotizacionIdNueva ? cotizacionesPorId.get(cotizacionIdNueva) ?? null : null;

  function handleSeleccionarCotizacionNueva(id: string) {
    setCotizacionIdNueva(id);
    setMostrandoBuscadorCotizacion(false);
    setBusquedaCotizacionNueva('');
  }

  async function handleCrear(e: FormEvent) {
    e.preventDefault();
    setMensajeCrear(null);
    setCreando(true);

    try {
      const response = await fetchAutenticado('/api/ordenes', token, {
        method: 'POST',
        body: JSON.stringify({
          cotizacion_id: cotizacionIdNueva.trim(),
          descripcion: descripcionNueva.trim() || undefined,
          fecha_entrega: fechaEntregaNueva || undefined,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeCrear(data?.message || 'No se pudo crear la orden.');
        return;
      }

      setMensajeCrear(`Orden creada correctamente (${data.orden.codigo}).`);
      setCotizacionIdNueva('');
      setDescripcionNueva('');
      setFechaEntregaNueva('');
      setMostrandoFormularioCrearOrden(false);
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeCrear('No se pudo crear la orden.');
    } finally {
      setCreando(false);
    }
  }

  async function abrirDetalle(id: string) {
    setMensajeCambio(null);
    setMensajeResponsable(null);
    setMensajeAvance(null);
    setMensajeEvidencia(null);
    setMensajeEntrega(null);
    setMensajeCerrar(null);
    setObservacionFinal('');
    setCotizacionSaldo(null);
    setMostrandoCancelar(false);
    setMotivoCancelacion('');
    setMensajeCancelar(null);
    setMensajeReprogramar(null);
    try {
      const response = await fetchAutenticado(`/api/ordenes/${id}`, token);
      if (!response.ok) return;
      const data = (await response.json()) as { orden: Orden };
      setOrdenSeleccionada(data.orden);
      setResponsableElegido(data.orden.responsable_id ?? '');
      setAvanceInput(data.orden.avance);
      setFechaEntregaReprogramada(data.orden.fecha_entrega ?? '');
      await cargarFicha(id);
      await cargarEvidencias(id);
      if (puedeGestionarPago) {
        await cargarCotizacionSaldo(data.orden.cotizacion_id);
      }
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  // Bloque saldo/entrega/cierre: solo se consulta si el usuario puede
  // gestionar pago (ADMIN/COMERCIAL) — OPERATIVO no tiene acceso al router
  // de cotizaciones en absoluto (403), así que ni siquiera se intenta.
  async function cargarCotizacionSaldo(cotizacionId: string) {
    try {
      const response = await fetchAutenticado(`/api/cotizaciones/${cotizacionId}`, token);
      if (!response.ok) return;
      const data = (await response.json()) as { cotizacion: CotizacionSaldo };
      setCotizacionSaldo(data.cotizacion);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
      }
    }
  }

  async function cargarEvidencias(ordenId: string) {
    setErrorEvidencias(null);
    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenId}/evidencias`, token);
      // OPERATIVO-09.1 (corrige H2 de OPERATIVO-09): un 403 significa específicamente que este
      // usuario no está autorizado para esta orden (OPERATIVO-03) — se distingue del resto de
      // errores no-OK con el mismo criterio ya usado en ChatTecnico.tsx. Ningún otro código (404,
      // 500, etc.) cambia de tratamiento.
      if (response.status === 403) {
        setErrorEvidencias('No tienes autorización para acceder a esta información.');
        return;
      }
      if (!response.ok) {
        setErrorEvidencias('No se pudo cargar la lista de evidencias.');
        return;
      }
      const data = (await response.json()) as { evidencias: OrdenEvidencia[] };
      setEvidencias(data.evidencias);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorEvidencias('No se pudo cargar la lista de evidencias.');
    }
  }

  // H-B (auditoría post-V9): descarga autenticada como blob y la abre en
  // una pestaña nueva — no se puede usar un <a href> plano porque el
  // endpoint exige el header Authorization.
  async function handleVerEvidencia(evidenciaId: string) {
    if (!ordenSeleccionada) return;
    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/evidencias/${evidenciaId}`, token);
      if (!response.ok) {
        setMensajeEvidencia('No se pudo abrir la evidencia.');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeEvidencia('No se pudo abrir la evidencia.');
    }
  }

  // Bloque MVP (ficha técnica). Un 404 es un caso normal (todavía no se
  // generó, ej. porque la generación automática falló) — no es un error a
  // mostrar, es la señal de que corresponde ofrecer "GENERAR FICHA
  // TÉCNICA".
  async function cargarFicha(ordenId: string) {
    setLoadingFicha(true);
    setErrorFicha(null);
    setMensajeGenerarFicha(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenId}/ficha-tecnica`, token);

      if (response.status === 404) {
        setFicha(null);
        return;
      }
      // OPERATIVO-09.1 (corrige H2 de OPERATIVO-09): mismo criterio que en cargarEvidencias — un
      // 403 se distingue explícitamente (OPERATIVO ajeno o sin responsable, OPERATIVO-05); el 404
      // de arriba (sin ficha generada todavía) no se toca.
      if (response.status === 403) {
        setErrorFicha('No tienes autorización para acceder a esta información.');
        return;
      }
      if (!response.ok) {
        setErrorFicha('No se pudo cargar la ficha técnica.');
        return;
      }

      const data = (await response.json()) as { ficha: FichaTecnica };
      setFicha(data.ficha);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setErrorFicha('No se pudo cargar la ficha técnica.');
    } finally {
      setLoadingFicha(false);
    }
  }

  async function handleGenerarFicha() {
    if (!ordenSeleccionada) return;
    setGenerandoFicha(true);
    setMensajeGenerarFicha(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/ficha-tecnica`, token, {
        method: 'POST',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeGenerarFicha(data?.message || 'No se pudo generar la ficha técnica.');
        return;
      }

      setFicha(data.ficha as FichaTecnica);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeGenerarFicha('No se pudo generar la ficha técnica.');
    } finally {
      setGenerandoFicha(false);
    }
  }

  async function handleCambiarEstado(nuevoEstado: string) {
    if (!ordenSeleccionada) return;
    setCambiando(true);
    setMensajeCambio(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/estado`, token, {
        method: 'PATCH',
        body: JSON.stringify({
          estado: nuevoEstado,
          ...(nuevoEstado === 'FINALIZADA' && observacionFinal.trim()
            ? { observaciones: observacionFinal.trim() }
            : {}),
        }),
      });

      const data = await response.json().catch(() => null);

      if (response.status === 409) {
        // abrirDetalle limpia los mensajes: el aviso del conflicto se muestra DESPUÉS de recargar el detalle
        await abrirDetalle(ordenSeleccionada.id);
        setMensajeCambio(data?.message || 'Conflicto al cambiar el estado.');
        await cargar();
        return;
      }
      if (!response.ok) {
        setMensajeCambio(data?.message || 'No se pudo cambiar el estado.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
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

  async function handleAsignarResponsable(e: FormEvent) {
    e.preventDefault();
    if (!ordenSeleccionada || !responsableElegido) return;
    setAsignando(true);
    setMensajeResponsable(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/responsable`, token, {
        method: 'PATCH',
        body: JSON.stringify({ responsable_id: responsableElegido }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeResponsable(data?.message || 'No se pudo asignar el responsable.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
      setMensajeResponsable('Responsable asignado correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeResponsable('No se pudo asignar el responsable.');
    } finally {
      setAsignando(false);
    }
  }

  // Endpoint separado del cambio de estado (decisión del bloque).
  async function handleActualizarAvance() {
    if (!ordenSeleccionada) return;
    setActualizandoAvance(true);
    setMensajeAvance(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/avance`, token, {
        method: 'PATCH',
        body: JSON.stringify({ avance: avanceInput }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeAvance(data?.message || 'No se pudo actualizar el avance.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
      setMensajeAvance('Avance actualizado correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeAvance('No se pudo actualizar el avance.');
    } finally {
      setActualizandoAvance(false);
    }
  }

  async function handleSubirEvidencia(e: FormEvent) {
    e.preventDefault();
    if (!ordenSeleccionada || !archivoEvidencia) return;
    setSubiendoEvidencia(true);
    setMensajeEvidencia(null);

    try {
      const formData = new FormData();
      formData.append('archivo', archivoEvidencia);

      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/evidencias`, token, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeEvidencia(data?.message || 'No se pudo subir la evidencia.');
        return;
      }

      setMensajeEvidencia('Evidencia subida correctamente.');
      setArchivoEvidencia(null);
      await cargarEvidencias(ordenSeleccionada.id);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeEvidencia('No se pudo subir la evidencia.');
    } finally {
      setSubiendoEvidencia(false);
    }
  }

  async function handleConfirmarEntrega() {
    if (!ordenSeleccionada) return;
    setConfirmandoEntrega(true);
    setMensajeEntrega(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/entrega`, token, {
        method: 'PATCH',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeEntrega(data?.message || 'No se pudo confirmar la entrega.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
      setMensajeEntrega('Entrega confirmada correctamente.');
      // un «No se puede cerrar…» anterior ya no aplica una vez confirmada la entrega
      setMensajeCerrar(null);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeEntrega('No se pudo confirmar la entrega.');
    } finally {
      setConfirmandoEntrega(false);
    }
  }

  // Única vía a CERRADA (el endpoint genérico de estado ya no la admite).
  async function handleCerrarOrden() {
    if (!ordenSeleccionada) return;
    setCerrando(true);
    setMensajeCerrar(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/cerrar`, token, {
        method: 'PATCH',
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeCerrar(data?.message || 'No se pudo cerrar la orden.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
      setMensajeCerrar('Orden cerrada correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeCerrar('No se pudo cerrar la orden.');
    } finally {
      setCerrando(false);
    }
  }

  // Bloque 3B: cancelación con motivo obligatorio; única vía a CANCELADA. Exclusivo ADMIN/COMERCIAL
  // (backend); el backend sigue siendo la autoridad — este formulario solo evita un viaje al
  // servidor con un motivo vacío o excesivo.
  async function handleCancelarOrden(e: FormEvent) {
    e.preventDefault();
    if (!ordenSeleccionada || !motivoCancelacion.trim()) return;
    setCancelando(true);
    setMensajeCancelar(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/cancelar`, token, {
        method: 'PATCH',
        body: JSON.stringify({ motivo: motivoCancelacion.trim() }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeCancelar(data?.message || 'No se pudo cancelar la orden.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
      setMostrandoCancelar(false);
      setMotivoCancelacion('');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeCancelar('No se pudo cancelar la orden.');
    } finally {
      setCancelando(false);
    }
  }

  // Bloque 3B: reprograma la fecha PROGRAMADA de entrega (fecha_entrega). Nunca marca la orden como
  // entregada ni toca entrega_confirmada_en (fecha REAL, gestionada por handleConfirmarEntrega).
  async function handleReprogramarFechaEntrega(e: FormEvent) {
    e.preventDefault();
    if (!ordenSeleccionada || !fechaEntregaReprogramada) return;
    setReprogramando(true);
    setMensajeReprogramar(null);

    try {
      const response = await fetchAutenticado(`/api/ordenes/${ordenSeleccionada.id}/fecha-entrega`, token, {
        method: 'PATCH',
        body: JSON.stringify({ fecha_entrega: fechaEntregaReprogramada }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setMensajeReprogramar(data?.message || 'No se pudo reprogramar la fecha de entrega.');
        return;
      }

      setOrdenSeleccionada(data.orden as Orden);
      setMensajeReprogramar('Fecha de entrega reprogramada correctamente.');
      await cargar();
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setMensajeReprogramar('No se pudo reprogramar la fecha de entrega.');
    } finally {
      setReprogramando(false);
    }
  }

  // Bloque 3B: solo se ofrece mientras la orden admite cancelación (PENDIENTE/EN_PROCESO/PAUSADA);
  // el backend es quien realmente decide (409 si el estado cambió mientras tanto).
  function bloqueCancelarOrden(orden: Orden) {
    if (!ESTADOS_CANCELABLES.includes(orden.estado)) {
      return null;
    }
    return (
      <div className="border-t border-outline pt-4">
        <p className="font-label-caps text-[10px] text-error uppercase mb-3">Cancelar orden</p>
        {!mostrandoCancelar ? (
          <button
            type="button"
            onClick={() => setMostrandoCancelar(true)}
            className="inline-flex items-center px-4 py-2 border border-error text-error hover:bg-error-container/20 transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
          >
            CANCELAR ORDEN
          </button>
        ) : (
          <form className="space-y-2" onSubmit={handleCancelarOrden}>
            <textarea
              value={motivoCancelacion}
              onChange={(e) => setMotivoCancelacion(e.target.value)}
              required
              rows={2}
              maxLength={2000}
              placeholder="Motivo de la cancelación (obligatorio)"
              className="w-full bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-error transition-colors font-body-md outline-none"
            />
            <p
              className={`font-code-sm text-[10px] text-right ${
                motivoCancelacion.length >= 2000 ? 'text-error' : 'text-on-surface-variant'
              }`}
            >
              {motivoCancelacion.length} / 2000
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={cancelando || !motivoCancelacion.trim()}
                className="inline-flex items-center px-4 py-2 border border-error text-error hover:bg-error-container/20 transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
              >
                {cancelando ? 'CANCELANDO...' : 'CONFIRMAR CANCELACIÓN'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMostrandoCancelar(false);
                  setMotivoCancelacion('');
                }}
                className="inline-flex items-center px-4 py-2 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
              >
                VOLVER
              </button>
            </div>
          </form>
        )}
        {mensajeCancelar && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase mt-3">{mensajeCancelar}</p>}
      </div>
    );
  }

  // Bloque 3B: no se ofrece sobre una orden CERRADA/CANCELADA ni una vez que la entrega real ya fue
  // confirmada (reprogramar no tiene sentido después de eso; el backend lo rechaza igual con 409).
  function bloqueReprogramarFecha(orden: Orden) {
    if (ESTADOS_SIN_REPROGRAMACION.includes(orden.estado) || orden.entrega_confirmada_en) {
      return null;
    }
    return (
      <div className="border-t border-outline pt-4">
        <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">
          Reprogramar fecha de entrega
        </p>
        <form className="flex flex-wrap items-end gap-3" onSubmit={handleReprogramarFechaEntrega}>
          <input
            type="date"
            value={fechaEntregaReprogramada}
            onChange={(e) => setFechaEntregaReprogramada(e.target.value)}
            className="bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none"
          />
          <button
            type="submit"
            disabled={reprogramando || !fechaEntregaReprogramada}
            className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
          >
            {reprogramando ? 'GUARDANDO...' : 'REPROGRAMAR'}
          </button>
        </form>
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-2">
          Reprogramar no marca la orden como entregada; la fecha real se registra al confirmar la entrega.
        </p>
        {mensajeReprogramar && (
          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-2">{mensajeReprogramar}</p>
        )}
      </div>
    );
  }

  // Bloque 2B: acceso a la comunicación técnica de la solicitud desde el detalle de la orden. La
  // solicitud se resuelve con los datos de apoyo ya cargados (orden -> cotización -> solicitud). Si no
  // se puede determinar (p. ej. OPERATIVO no accede a cotizaciones), no se inventa ninguna conversación.
  function bloqueComunicacionTecnica(orden: Orden) {
    // solicitud_id viene en el DTO de la orden (también para OPERATIVO); los datos de apoyo solo son respaldo.
    const solicitudId = orden.solicitud_id ?? datosClienteServicio(orden.cotizacion_id).solicitud?.id ?? null;
    return (
      <div className="border-t border-outline pt-4">
        <p className="font-label-caps text-[10px] text-primary-container uppercase mb-3">Comunicación técnica</p>
        {solicitudId && onVerComunicacion ? (
          <>
            <button
              type="button"
              onClick={() => onVerComunicacion(solicitudId)}
              className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
            >
              <span className="material-symbols-outlined mr-2 text-[18px]">forum</span>
              VER COMUNICACIÓN TÉCNICA
            </button>
            <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-2">
              Es la misma conversación de la solicitud de esta orden.
            </p>
          </>
        ) : (
          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
            {estadoApoyo === 'cargando'
              ? 'Cargando…'
              : 'Comunicación técnica no disponible desde esta vista: no se pudo determinar la solicitud asociada.'}
          </p>
        )}
      </div>
    );
  }

  // Vista ADMIN — detalle exclusivamente de consulta + asignar
  // responsable. Ningún bloque de ejecución (avance, evidencias, cambiar
  // estado, generar ficha, entrega, cierre) se renderiza aquí; el bloque
  // existente más abajo (idéntico al de siempre) solo se alcanza cuando
  // esAdmin es false.
  if (ordenSeleccionada && esAdmin) {
    const { cliente, servicio, solicitud } = datosClienteServicio(ordenSeleccionada.cotizacion_id);
    const cotizacion = cotizacionesPorId.get(ordenSeleccionada.cotizacion_id) ?? null;

    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setOrdenSeleccionada(null);
            setMensajeResponsable(null);
          }}
          className="min-h-11 -mt-2.5 mb-3.5 inline-flex items-center font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL LISTADO
        </button>

        <div className="bg-surface sharp-border p-6 space-y-5">
          <div className="flex flex-wrap justify-between items-start gap-x-4 gap-y-3 border-b border-outline pb-4">
            <div className="min-w-0 flex-1 basis-52">
              <h3 className="font-headline-md text-headline-md text-on-surface uppercase wrap-anywhere">{ordenSeleccionada.codigo}</h3>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mt-1">
                {cliente} — {servicio}
              </p>
            </div>
            <span className={`inline-flex shrink-0 whitespace-nowrap px-3 py-1 font-code-sm text-xs uppercase ${claseBadgeEstadoOrden(ordenSeleccionada.estado)}`}>
              {ordenSeleccionada.estado.replace(/_/g, ' ')}
            </span>
          </div>

          <div>
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Información general</p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-code-sm text-code-sm">
              {solicitud && (
                <div className="sm:col-span-2">
                  <dt className="text-on-surface-variant uppercase">Descripción de la solicitud</dt>
                  <dd className="text-on-surface">{solicitud.descripcion}</dd>
                </div>
              )}
              {ordenSeleccionada.descripcion && (
                <div className="sm:col-span-2">
                  <dt className="text-on-surface-variant uppercase">Descripción de la orden</dt>
                  <dd className="text-on-surface">{ordenSeleccionada.descripcion}</dd>
                </div>
              )}
              <div>
                <dt className="text-on-surface-variant uppercase">Cotización relacionada</dt>
                <dd className="text-on-surface">
                  {cotizacion ? `${cotizacion.estado.replace(/_/g, ' ')} · ${cotizacion.total ?? cotizacion.valor}` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Responsable</dt>
                <dd className="text-on-surface">{nombreResponsableAdmin(ordenSeleccionada.responsable_id)}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Creada</dt>
                <dd className="text-on-surface">{new Date(ordenSeleccionada.creado_en).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Fecha programada</dt>
                <dd className="text-on-surface">
                  {ordenSeleccionada.fecha_programada ? new Date(ordenSeleccionada.fecha_programada).toLocaleString() : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Fecha de entrega</dt>
                <dd className="text-on-surface">{formatearFechaEntrega(ordenSeleccionada.fecha_entrega) ?? 'Sin definir'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Finalizada</dt>
                <dd className="text-on-surface">
                  {ordenSeleccionada.fecha_finalizacion
                    ? new Date(ordenSeleccionada.fecha_finalizacion).toLocaleString() +
                      textoAutor(ordenSeleccionada.finalizada_por_nombre)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Cerrada</dt>
                <dd className="text-on-surface">
                  {ordenSeleccionada.fecha_cierre
                    ? new Date(ordenSeleccionada.fecha_cierre).toLocaleString() + textoAutor(ordenSeleccionada.cerrada_por_nombre)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Último cambio de estado</dt>
                <dd className="text-on-surface">{ordenSeleccionada.estado_cambiado_por_nombre ?? 'No registrado'}</dd>
              </div>
            </dl>
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Progreso</p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <BarraProgreso valor={ordenSeleccionada.avance} />
              </div>
              <span className="font-code-sm text-code-sm text-on-surface shrink-0">{ordenSeleccionada.avance}%</span>
            </div>
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Ficha técnica</p>
            {loadingFicha && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO FICHA...</p>
            )}
            {!loadingFicha && errorFicha && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorFicha}</p>}
            {!loadingFicha && !errorFicha && ficha && (
              <div className="space-y-3">
                {ficha.tiene_inconsistencia && (
                  <p className="font-['Inter'] text-[13px] font-normal text-error uppercase border border-error px-3 py-2">
                    NexIA detectó una inconsistencia — revise el contenido y la alerta generada.
                  </p>
                )}
                <pre className="font-code-sm text-xs text-on-surface whitespace-pre-wrap bg-background border border-outline p-4">
                  {ficha.contenido}
                </pre>
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                  Generada el {new Date(ficha.generado_en).toLocaleString()}
                </p>
              </div>
            )}
            {!loadingFicha && !errorFicha && !ficha && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Ficha técnica aún no disponible.</p>
            )}
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Evidencias</p>
            {errorEvidencias && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase mb-2">{errorEvidencias}</p>}
            {evidencias && evidencias.length > 0 && (
              <ul className="space-y-1">
                {evidencias.map((ev) => (
                  <li
                    key={ev.id}
                    className="flex items-center justify-between gap-3 font-code-sm text-xs text-on-surface-variant uppercase"
                  >
                    <span>
                      {ev.tipo} — {ev.nombre_archivo} ({new Date(ev.creado_en).toLocaleString()})
                    </span>
                    <button
                      type="button"
                      onClick={() => handleVerEvidencia(ev.id)}
                      className="shrink-0 inline-flex items-center px-2 py-1 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                    >
                      VER
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {evidencias && evidencias.length === 0 && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Sin evidencias registradas todavía.</p>
            )}
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Saldo / Entrega</p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 font-code-sm text-code-sm wrap-anywhere">
              <div>
                <dt className="text-on-surface-variant uppercase">Estado del saldo</dt>
                <dd className="text-on-surface">{cotizacion?.estado_saldo ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">{cotizacion?.estado_saldo === 'VALIDADO' ? 'Saldo cobrado' : 'Saldo pendiente'}</dt>
                <dd className="text-on-surface">{cotizacion?.saldo_pendiente ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Entrega confirmada</dt>
                <dd className="text-on-surface">
                  {ordenSeleccionada.entrega_confirmada_en
                    ? new Date(ordenSeleccionada.entrega_confirmada_en).toLocaleString() +
                      textoAutor(ordenSeleccionada.entrega_confirmada_por_nombre)
                    : 'No confirmada'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">assignment_ind</span>
              RESPONSABLE — ASIGNACIÓN ADMINISTRATIVA
            </p>
            <form className="flex flex-wrap items-end gap-3" onSubmit={handleAsignarResponsable}>
              <select
                value={responsableElegido}
                onChange={(e) => setResponsableElegido(e.target.value)}
                className="bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none cursor-pointer"
              >
                <option value="">Seleccione un OPERATIVO activo</option>
                {(responsables ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
              <button
                disabled={asignando || !responsableElegido}
                type="submit"
                className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
              >
                {asignando ? 'ASIGNANDO...' : 'ASIGNAR'}
              </button>
            </form>
            {responsables !== null && responsables.length === 0 && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-2">
                No hay usuarios OPERATIVO activos disponibles.
              </p>
            )}
            {mensajeResponsable && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-3">{mensajeResponsable}</p>
            )}
          </div>

          {bloqueCancelarOrden(ordenSeleccionada)}
          {bloqueReprogramarFecha(ordenSeleccionada)}

          {bloqueComunicacionTecnica(ordenSeleccionada)}
        </div>
      </div>
    );
  }

  if (ordenSeleccionada) {
    // E-01: las acciones operativas solo se ofrecen al OPERATIVO responsable de esta orden.
    const puedeEjecutarOrden =
      puedeGestionar &&
      ordenSeleccionada.responsable_id === usuarioId &&
      !ESTADOS_EJECUCION_BLOQUEADA.includes(ordenSeleccionada.estado);
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setOrdenSeleccionada(null);
            setMensajeCambio(null);
            setMensajeResponsable(null);
          }}
          className="min-h-11 -mt-2.5 mb-3.5 inline-flex items-center font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined mr-1 text-[18px]">arrow_back</span>
          VOLVER AL LISTADO
        </button>

        <div className="bg-surface sharp-border p-6 space-y-5">
          {/* A. CABECERA — cliente/servicio resueltos vía datosClienteServicio()
              (mismo patrón ya usado por la vista ADMIN, ahora también
              disponible para COMERCIAL/OPERATIVO desde que cargarApoyo()
              ya no está limitado a esAdmin). Nunca inventa datos: si aún no
              hay apoyo disponible, muestra un estado honesto. */}
          <div className="flex flex-wrap justify-between items-start gap-x-4 gap-y-3 border-b border-outline pb-4">
            <div className="min-w-0 flex-1 basis-52">
              <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase mb-1">
                {ordenSeleccionada.codigo}
              </h3>
              <p className="font-headline-md text-headline-md text-on-surface uppercase wrap-anywhere">
                {datosClienteServicio(ordenSeleccionada.cotizacion_id).cliente}
              </p>
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mt-1 wrap-anywhere">
                {datosClienteServicio(ordenSeleccionada.cotizacion_id).servicio}
              </p>
            </div>
            <span
              className={`inline-flex px-3 py-1 font-code-sm text-xs uppercase ${claseBadgeEstadoOrden(ordenSeleccionada.estado)}`}
            >
              {ordenSeleccionada.estado.replace(/_/g, ' ')}
            </span>
          </div>

          {/* B. INFORMACIÓN GENERAL */}
          <div>
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Información general</p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 font-code-sm text-code-sm wrap-anywhere">
              <div>
                <dt className="text-on-surface-variant uppercase">Cliente</dt>
                <dd className="text-on-surface">{datosClienteServicio(ordenSeleccionada.cotizacion_id).cliente}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Servicio</dt>
                <dd className="text-on-surface">{datosClienteServicio(ordenSeleccionada.cotizacion_id).servicio}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Solicitud</dt>
                {/* Corrección visual (autorización explícita — "CORRECCIÓN
                    FINAL — ÓRDENES COMERCIAL", punto 3): dato humano
                    (descripción real de la solicitud, ya resuelta vía
                    /api/solicitudes) como información principal — el UUID
                    nunca es el dato mostrado aquí, solo queda como
                    identificador técnico secundario más abajo. */}
                <dd className="text-on-surface">
                  {datosClienteServicio(ordenSeleccionada.cotizacion_id).solicitud?.descripcion ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Fecha de entrega</dt>
                <dd className="text-on-surface">{formatearFechaEntrega(ordenSeleccionada.fecha_entrega) ?? 'Sin definir'}</dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Fecha de finalización</dt>
                <dd className="text-on-surface">
                  {ordenSeleccionada.fecha_finalizacion
                    ? new Date(ordenSeleccionada.fecha_finalizacion).toLocaleString() +
                      textoAutor(ordenSeleccionada.finalizada_por_nombre)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-on-surface-variant uppercase">Fecha de cierre</dt>
                <dd className="text-on-surface">
                  {ordenSeleccionada.fecha_cierre
                    ? new Date(ordenSeleccionada.fecha_cierre).toLocaleString() + textoAutor(ordenSeleccionada.cerrada_por_nombre)
                    : '—'}
                </dd>
              </div>
            </dl>
            {/* Corrección visual (autorización explícita — "AJUSTE UI —
                OCULTAR IDENTIFICADORES TÉCNICOS EN DETALLE DE ORDEN"): los
                identificadores técnicos (cotizacion_id / solicitud_id) ya
                no se muestran en esta vista — el usuario Comercial trabaja
                con información de negocio (Cliente/Servicio/Solicitud, ya
                mostrados arriba), nunca con UUID. Los IDs siguen existiendo
                intactos en `ordenSeleccionada`/backend/BD, simplemente no
                se renderizan aquí. */}
            {ordenSeleccionada.descripcion && (
              <div className="mt-3">
                <p className="font-code-sm text-[10px] text-on-surface-variant uppercase mb-1">Descripción de la orden</p>
                <p className="font-body-md text-body-md text-on-surface">{ordenSeleccionada.descripcion}</p>
              </div>
            )}
          </div>

          {/* D. RESPONSABLE — solo lectura para COMERCIAL/OPERATIVO en este
              bloque (asignar es exclusivo de ADMIN, en su propio detalle).
              Nunca se inventa un nombre: COMERCIAL/OPERATIVO no tienen
              acceso a /api/usuarios (403 real, confirmado en la auditoría) —
              se muestra únicamente "Sin asignar" o un identificador técnico
              corto. */}
          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Responsable</p>
            <p className="font-body-md text-body-md text-on-surface">
              {responsableMostrable(ordenSeleccionada.responsable_id, ordenSeleccionada.responsable_nombre)}
            </p>
          </div>

          {/* C. PROGRESO — solo lectura para COMERCIAL (puedeGestionar
              false); OPERATIVO conserva el control editable existente, sin
              ningún cambio de lógica. */}
          {!puedeEjecutarOrden && (
            <div className="border-t border-outline pt-4">
              <p className="font-label-caps text-[10px] text-primary-container uppercase mb-2">Progreso</p>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <BarraProgreso valor={ordenSeleccionada.avance} />
                </div>
                <span className="font-code-sm text-sm text-on-surface font-bold shrink-0">
                  {ordenSeleccionada.avance}%
                </span>
              </div>
            </div>
          )}

          {puedeEjecutarOrden && (
            <div className="border-t border-outline pt-4">
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Avance</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                    Avance (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={avanceInput}
                    onChange={(e) => setAvanceInput(Number(e.target.value))}
                    className="w-24 bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={actualizandoAvance}
                  onClick={handleActualizarAvance}
                  className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {actualizandoAvance ? 'ACTUALIZANDO...' : 'ACTUALIZAR AVANCE'}
                </button>
              </div>
              {mensajeAvance && (
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-3">{mensajeAvance}</p>
              )}
            </div>
          )}

          {/* F. EVIDENCIAS — solo lectura para COMERCIAL (corrección
              explícita del hallazgo de la auditoría: el backend ya permite
              GET /:id/evidencias a COMERCIAL, pero la UI las ocultaba por
              completo). Nunca se reutiliza el formulario de subida, que
              sigue siendo exclusivo de OPERATIVO (bloque `puedeGestionar`
              de abajo, sin cambios). */}
          {!puedeEjecutarOrden && (
            <div className="border-t border-outline pt-4">
              <p className="font-label-caps text-[10px] text-primary-container uppercase mb-3">Evidencias</p>
              {errorEvidencias && <p className="font-code-sm text-xs text-error uppercase mb-2">{errorEvidencias}</p>}
              {evidencias && evidencias.length === 0 && (
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                  Sin evidencias registradas todavía.
                </p>
              )}
              {evidencias && evidencias.length > 0 && (
                <ul className="space-y-1">
                  {evidencias.map((ev) => (
                    <li
                      key={ev.id}
                      className="flex items-center justify-between gap-3 font-code-sm text-xs text-on-surface-variant uppercase"
                    >
                      <span>
                        {ev.tipo} — {ev.nombre_archivo} ({new Date(ev.creado_en).toLocaleString()})
                      </span>
                      <button
                        type="button"
                        onClick={() => handleVerEvidencia(ev.id)}
                        className="shrink-0 inline-flex items-center px-2 py-1 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                      >
                        VER
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {puedeEjecutarOrden && (
            <div className="border-t border-outline pt-4">
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Evidencias</p>

              {errorEvidencias && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase mb-2">{errorEvidencias}</p>}

              {evidencias && evidencias.length > 0 && (
                <ul className="mb-3 space-y-1">
                  {evidencias.map((ev) => (
                    <li key={ev.id} className="flex items-center justify-between gap-3 font-code-sm text-xs text-on-surface-variant uppercase">
                      <span>
                        {ev.tipo} — {ev.nombre_archivo} ({new Date(ev.creado_en).toLocaleString()})
                      </span>
                      <button
                        type="button"
                        onClick={() => handleVerEvidencia(ev.id)}
                        className="shrink-0 inline-flex items-center px-2 py-1 border border-outline text-on-surface hover:bg-surface-container-high transition-colors font-['Inter'] text-[14px] font-semibold cursor-pointer"
                      >
                        VER
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {evidencias && evidencias.length === 0 && (
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mb-3">
                  Sin evidencias registradas todavía.
                </p>
              )}

              <form className="flex flex-wrap items-end gap-3" onSubmit={handleSubirEvidencia}>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={(e) => setArchivoEvidencia(e.target.files?.[0] ?? null)}
                  className="font-code-sm text-code-sm text-on-surface-variant"
                />
                <button
                  disabled={subiendoEvidencia || !archivoEvidencia}
                  type="submit"
                  className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {subiendoEvidencia ? 'SUBIENDO...' : 'SUBIR EVIDENCIA'}
                </button>
              </form>
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-2">
                Máximo 5 fotos y 2 PDF por orden. No se requieren ambos formatos.
              </p>
              {mensajeEvidencia && (
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-3">{mensajeEvidencia}</p>
              )}
            </div>
          )}

          {puedeEjecutarOrden && (
            <div className="border-t border-outline pt-4">
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Cambiar estado</p>
              {(TRANSICIONES[ordenSeleccionada.estado] ?? []).includes('FINALIZADA') && (
                <div className="mb-3">
                  <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                    Observación final (requerida para finalizar)
                  </label>
                  <textarea
                    value={observacionFinal}
                    onChange={(e) => setObservacionFinal(e.target.value)}
                    className="w-full bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                    rows={2}
                    maxLength={2000}
                  />
                  <p
                    className={`font-code-sm text-[10px] text-right mt-1 ${
                      observacionFinal.length >= 2000 ? 'text-error' : 'text-on-surface-variant'
                    }`}
                  >
                    {observacionFinal.length} / 2000
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                {(TRANSICIONES[ordenSeleccionada.estado] ?? []).map((destino) => (
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
                {(TRANSICIONES[ordenSeleccionada.estado] ?? []).length === 0 && (
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

          {puedeGestionarPago && bloqueCancelarOrden(ordenSeleccionada)}
          {puedeGestionarPago && bloqueReprogramarFecha(ordenSeleccionada)}

          {esAdmin && (
            <div className="border-t border-outline pt-4">
              <p className="font-code-sm text-code-sm text-on-surface-variant uppercase mb-3">Asignar responsable</p>
              <form className="flex flex-wrap items-end gap-3" onSubmit={handleAsignarResponsable}>
                <select
                  value={responsableElegido}
                  onChange={(e) => setResponsableElegido(e.target.value)}
                  className="bg-background border border-outline text-on-surface px-2 py-2 focus:ring-0 focus:border-primary-container transition-colors font-code-sm text-code-sm outline-none cursor-pointer"
                >
                  <option value="">Seleccione un OPERATIVO activo</option>
                  {(responsables ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                    </option>
                  ))}
                </select>
                <button
                  disabled={asignando || !responsableElegido}
                  type="submit"
                  className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {asignando ? 'ASIGNANDO...' : 'ASIGNAR'}
                </button>
              </form>
              {responsables !== null && responsables.length === 0 && (
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-2">
                  No hay usuarios OPERATIVO activos disponibles.
                </p>
              )}
              {mensajeResponsable && (
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-3">{mensajeResponsable}</p>
              )}
            </div>
          )}

          <div className="border-t border-outline pt-4">
            <p className="font-label-caps text-[10px] text-primary-container uppercase mb-3">Ficha técnica</p>

            {loadingFicha && (
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO FICHA...</p>
            )}
            {!loadingFicha && errorFicha && (
              <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorFicha}</p>
            )}

            {!loadingFicha && !errorFicha && ficha && (
              <div className="space-y-3">
                {ficha.tiene_inconsistencia && (
                  <p className="font-['Inter'] text-[13px] font-normal text-error uppercase border border-error px-3 py-2">
                    NexIA detectó una inconsistencia — revise el contenido y la alerta generada.
                  </p>
                )}
                <pre className="font-code-sm text-xs text-on-surface whitespace-pre-wrap bg-background border border-outline p-4">
                  {ficha.contenido}
                </pre>
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                  Generada el {new Date(ficha.generado_en).toLocaleString()}
                </p>
              </div>
            )}

            {!loadingFicha && !errorFicha && !ficha && (
              <div className="space-y-3">
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                  Sin ficha técnica generada todavía.
                </p>
                {puedeEjecutarOrden && (
                  <>
                    <button
                      type="button"
                      disabled={generandoFicha}
                      onClick={handleGenerarFicha}
                      className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {generandoFicha ? 'GENERANDO...' : 'GENERAR FICHA TÉCNICA'}
                    </button>
                    {mensajeGenerarFicha && (
                      <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{mensajeGenerarFicha}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {bloqueComunicacionTecnica(ordenSeleccionada)}

          {puedeGestionarPago && (ordenSeleccionada.estado === 'FINALIZADA' || ordenSeleccionada.estado === 'CERRADA') && (
            <div className="border-t border-outline pt-4 space-y-3">
              <p className="font-label-caps text-[10px] text-primary-container uppercase mb-3">Cierre</p>

              <dl className="grid grid-cols-2 gap-4 font-code-sm text-code-sm">
                <div>
                  <dt className="text-on-surface-variant uppercase">Estado del saldo</dt>
                  <dd className="text-on-surface">{cotizacionSaldo?.estado_saldo ?? 'Cargando...'}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">{cotizacionSaldo?.estado_saldo === 'VALIDADO' ? 'Saldo cobrado' : 'Saldo pendiente'}</dt>
                  <dd className="text-on-surface">{cotizacionSaldo?.saldo_pendiente ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-on-surface-variant uppercase">Entrega confirmada</dt>
                  <dd className="text-on-surface">
                    {ordenSeleccionada.entrega_confirmada_en
                      ? new Date(ordenSeleccionada.entrega_confirmada_en).toLocaleString() +
                        textoAutor(ordenSeleccionada.entrega_confirmada_por_nombre)
                      : 'No confirmada'}
                  </dd>
                </div>
              </dl>

              {ordenSeleccionada.estado === 'FINALIZADA' && (
                <div className="flex flex-wrap gap-3">
                  {!ordenSeleccionada.entrega_confirmada_en && (
                    <button
                      type="button"
                      disabled={confirmandoEntrega}
                      onClick={handleConfirmarEntrega}
                      className="inline-flex items-center px-4 py-2 border border-primary-container text-primary-container hover:bg-primary-container hover:text-on-primary-container transition-colors font-['Inter'] text-[14px] font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      {confirmandoEntrega ? 'CONFIRMANDO...' : 'CONFIRMAR ENTREGA'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={cerrando}
                    onClick={handleCerrarOrden}
                    className="inline-flex items-center px-4 py-2 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {cerrando ? 'CERRANDO...' : 'CERRAR ORDEN'}
                  </button>
                </div>
              )}

              {mensajeEntrega && <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">{mensajeEntrega}</p>}
              {mensajeCerrar && <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">{mensajeCerrar}</p>}
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                El saldo se valida/rechaza desde el módulo de Cotizaciones.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Vista ADMIN — bandeja de solo supervisión (la asignación de
  // responsable vive en el detalle, no aquí). Sin "NUEVA ORDEN", sin
  // ninguna acción de ejecución. El listado que sigue después de este
  // bloque (formulario "NUEVA ORDEN" + tabla simple) es exclusivo de
  // COMERCIAL/OPERATIVO y no se modifica.
  if (esAdmin) {
    return (
      <div className="space-y-8">
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase max-w-2xl">
          Vista de supervisión: solo consulta. Crear, ejecutar o cerrar órdenes es responsabilidad de Comercial y
          Operativo.
        </p>

        {loadingLista && (
          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO ÓRDENES...</p>
        )}
        {!loadingLista && errorLista && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorLista}</p>}
        {!loadingLista && !errorLista && ordenes && ordenes.length === 0 && (
          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">NO HAY ÓRDENES REGISTRADAS.</p>
        )}

        {!loadingLista && !errorLista && ordenes && ordenes.length > 0 && (
          <>
            {/* KPI */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
              <KpiOrden
                icono="inventory_2"
                valor={kpisAdmin.total}
                etiqueta="Total"
                claseIcono="bg-surface-container-high text-on-surface"
                claseBorde="border-l-outline"
              />
              <KpiOrden
                icono="schedule"
                valor={kpisAdmin.PENDIENTE}
                etiqueta="Pendiente"
                claseIcono="bg-surface-container-high text-on-surface-variant"
                claseBorde="border-l-outline"
              />
              <KpiOrden
                icono="sync"
                valor={kpisAdmin.EN_PROCESO}
                etiqueta="En proceso"
                claseIcono="bg-primary-container/20 text-primary-container"
                claseBorde="border-l-primary-container"
              />
              <KpiOrden
                icono="pause_circle"
                valor={kpisAdmin.PAUSADA}
                etiqueta="Pausada"
                claseIcono="bg-outline-variant/30 text-on-surface-variant"
                claseBorde="border-l-outline-variant"
              />
              <KpiOrden
                icono="check_circle"
                valor={kpisAdmin.FINALIZADA}
                etiqueta="Finalizada"
                claseIcono="bg-primary-container text-on-primary-container"
                claseBorde="border-l-primary-container"
              />
              <KpiOrden
                icono="lock"
                valor={kpisAdmin.CERRADA}
                etiqueta="Cerrada"
                claseIcono="bg-secondary-container/40 text-secondary"
                claseBorde="border-l-secondary-container"
              />
              <KpiOrden
                icono="cancel"
                valor={kpisAdmin.CANCELADA}
                etiqueta="Cancelada"
                claseIcono="bg-error-container/40 text-error"
                claseBorde="border-l-error"
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
                    placeholder="Buscar por código de orden, n.º de solicitud o cotización, cliente, servicio o responsable…"
                    className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                  />
                </div>
                <div className="relative">
                  <select
                    value={estadoFiltroAdmin}
                    onChange={(e) => setEstadoFiltroAdmin(e.target.value as EstadoFiltroOrden)}
                    className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    {ESTADOS_FILTRO_ORDEN.map((estado) => (
                      <option key={estado} value={estado}>
                        {estado === 'TODOS' ? 'Estado: Todos' : estado.replace(/_/g, ' ')}
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
                      onChange={(e) => setOrdenPorAdmin(e.target.value as OrdenPorAdmin)}
                      className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                    >
                      <option value="recientes">Más recientes</option>
                      <option value="antiguos">Más antiguas</option>
                      <option value="mayor_avance">Mayor avance</option>
                      <option value="menor_avance">Menor avance</option>
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
            <div className="hidden xl:block overflow-x-auto bg-surface sharp-border">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline">
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Código</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Solicitud</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Cotización</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Cliente</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Servicio</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Responsable</th>
                    <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Avance</th>
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
                      <td colSpan={10} className="py-6 px-4 text-center font-code-sm text-code-sm text-on-surface-variant uppercase">
                        Ningún resultado coincide con estos filtros.
                      </td>
                    </tr>
                  )}
                  {datosPaginaAdmin.map((o) => {
                    const { cliente, servicio } = datosClienteServicio(o.cotizacion_id);
                    return (
                      <tr key={o.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface">{o.codigo}</td>
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant whitespace-nowrap" title={ayudaReferencia(o.solicitud_codigo)}>{referenciaOrigen(o.solicitud_codigo)}</td>
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant whitespace-nowrap" title={ayudaReferencia(o.cotizacion_codigo)}>{referenciaOrigen(o.cotizacion_codigo)}</td>
                        <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface">{cliente}</td>
                        <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface break-words">{servicio}</td>
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                          {nombreResponsableAdmin(o.responsable_id)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 w-28">
                            <div className="flex-1">
                              <BarraProgreso valor={o.avance} />
                            </div>
                            <span className="font-code-sm text-[10px] text-on-surface-variant shrink-0">{o.avance}%</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex whitespace-nowrap px-2.5 py-1 font-code-sm text-[11px]! leading-tight uppercase ${claseBadgeEstadoOrden(o.estado)}`}
                          >
                            {o.estado.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                          {new Date(o.creado_en).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => abrirDetalle(o.id)}
                            aria-label="Ver detalle de la orden"
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
            <div className="xl:hidden space-y-3">
              {datosPaginaAdmin.length === 0 && (
                <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase text-center py-6">
                  Ningún resultado coincide con estos filtros.
                </p>
              )}
              {datosPaginaAdmin.map((o) => {
                const { cliente, servicio } = datosClienteServicio(o.cotizacion_id);
                return (
                  <div key={o.id} className="bg-surface sharp-border border-l-4 border-l-primary-container p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="font-body-md text-body-md text-on-surface font-medium wrap-anywhere">{o.codigo}</p>
                        <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-0.5 wrap-anywhere">
                          {cliente} — {servicio}
                        </p>
                      </div>
                      <span
                        className={`inline-flex shrink-0 whitespace-nowrap px-2.5 py-1 font-code-sm text-[11px]! leading-tight uppercase ${claseBadgeEstadoOrden(o.estado)}`}
                      >
                        {o.estado.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <BarraProgreso valor={o.avance} />
                      </div>
                      <span className="font-code-sm text-[11px] text-on-surface-variant shrink-0">{o.avance}%</span>
                    </div>

                    <dl className="grid grid-cols-2 gap-2 font-code-sm text-[11px] wrap-anywhere">
                      <div>
                        <dt className="text-on-surface-variant uppercase">Solicitud</dt>
                        <dd className="text-on-surface" title={ayudaReferencia(o.solicitud_codigo)}>{referenciaOrigen(o.solicitud_codigo)}</dd>
                      </div>
                      <div>
                        <dt className="text-on-surface-variant uppercase">Cotización</dt>
                        <dd className="text-on-surface" title={ayudaReferencia(o.cotizacion_codigo)}>{referenciaOrigen(o.cotizacion_codigo)}</dd>
                      </div>
                      <div>
                        <dt className="text-on-surface-variant uppercase">Responsable</dt>
                        <dd className="text-on-surface">{nombreResponsableAdmin(o.responsable_id)}</dd>
                      </div>
                      <div>
                        <dt className="text-on-surface-variant uppercase">Fecha</dt>
                        <dd className="text-on-surface">{new Date(o.creado_en).toLocaleDateString()}</dd>
                      </div>
                    </dl>

                    <div className="flex items-center justify-end pt-1 border-t border-outline">
                      <button
                        type="button"
                        onClick={() => abrirDetalle(o.id)}
                        aria-label="Ver detalle de la orden"
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
                  {ordenadasAdmin.length} órdenes
                </span>
                <div className="relative">
                  <select
                    value={registrosPorPaginaAdmin}
                    onChange={(e) => setRegistrosPorPaginaAdmin(Number(e.target.value))}
                    className="appearance-none bg-background border border-outline pl-3 pr-11 py-1.5 text-on-surface font-['Inter'] text-[13px] font-normal focus:border-primary-container focus:outline-hidden cursor-pointer"
                  >
                    {REGISTROS_POR_PAGINA_OPCIONES_ORDEN.map((n) => (
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
      {/* Corrección visual (autorización explícita — "CORRECCIÓN FINAL —
          ÓRDENES COMERCIAL", punto 2): AreaPrivada.tsx ya renderiza
          "GESTIÓN" + "GESTIÓN DE ÓRDENES" como cabecera de la sección — no
          se repite ese título aquí, solo el subtítulo descriptivo. */}
      <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
        Administra y supervisa el ciclo comercial de las órdenes.
      </p>

      {loadingLista && (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO ÓRDENES...</p>
      )}
      {!loadingLista && errorLista && <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{errorLista}</p>}

      {!loadingLista && !errorLista && (
        <>
          {/* KPI — mismo componente/lógica ya usados en la vista ADMIN
              (kpisAdmin), reutilizados aquí sin duplicar. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
            <KpiOrden
              icono="inventory_2"
              valor={kpisAdmin.total}
              etiqueta="Total"
              claseIcono="bg-surface-container-high text-on-surface"
              claseBorde="border-l-outline"
            />
            <KpiOrden
              icono="hourglass_empty"
              valor={kpisAdmin.PENDIENTE}
              etiqueta="Pendientes"
              claseIcono="bg-surface-container-high text-on-surface-variant"
              claseBorde="border-l-outline"
            />
            <KpiOrden
              icono="engineering"
              valor={kpisAdmin.EN_PROCESO}
              etiqueta="En proceso"
              claseIcono="bg-primary-container/20 text-primary-container"
              claseBorde="border-l-primary-container"
            />
            <KpiOrden
              icono="pause_circle"
              valor={kpisAdmin.PAUSADA}
              etiqueta="Pausadas"
              claseIcono="bg-outline-variant/30 text-on-surface-variant"
              claseBorde="border-l-outline-variant"
            />
            <KpiOrden
              icono="check_circle"
              valor={kpisAdmin.FINALIZADA}
              etiqueta="Finalizadas"
              claseIcono="bg-primary-container text-on-primary-container"
              claseBorde="border-l-primary-container"
            />
            <KpiOrden
              icono="task_alt"
              valor={kpisAdmin.CERRADA}
              etiqueta="Cerradas"
              claseIcono="bg-secondary-container/40 text-secondary"
              claseBorde="border-l-secondary-container"
            />
            <KpiOrden
              icono="cancel"
              valor={kpisAdmin.CANCELADA}
              etiqueta="Canceladas"
              claseIcono="bg-error-container/40 text-error"
              claseBorde="border-l-error"
            />
          </div>

          {/* NUEVA ORDEN — sección compacta y colapsable (rediseño
              autorizado — "REDISEÑO UI ÓRDENES — ROL COMERCIAL"): cerrada
              por defecto. Mismo endpoint/payload/validaciones de siempre
              (POST /api/ordenes); ninguna regla de negocio se mueve al
              frontend. */}
          {puedeCrearOrden && (
            <div className="bg-surface sharp-border p-6">
              <button
                type="button"
                onClick={() => setMostrandoFormularioCrearOrden((v) => !v)}
                className="w-full min-h-11 -my-2.5 flex items-center justify-between cursor-pointer"
              >
                <h3 className="font-label-caps text-label-caps text-primary-container tracking-widest uppercase">
                  + NUEVA ORDEN
                </h3>
                <span className="material-symbols-outlined text-primary-container text-[20px]">
                  {mostrandoFormularioCrearOrden ? 'expand_less' : 'expand_more'}
                </span>
              </button>

              {mostrandoFormularioCrearOrden && (
                <div className="mt-4 space-y-4">
                  <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                    Seleccione una cotización aceptada para crear una nueva orden.
                  </p>

                  {/* Selector de cotización amigable — cliente/servicio/
                      descripción en vez del UUID plano como único punto de
                      interacción. Datos resueltos de /api/cotizaciones +
                      /api/solicitudes + /api/clientes (ya cargados más
                      arriba); si no hay datos de apoyo disponibles, se
                      ofrece el UUID como respaldo técnico, nunca un
                      cliente/servicio inventado. El backend sigue siendo la
                      única autoridad: esta lista es solo una guía de UX. */}
                  <div>
                    <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                      Buscar cotización
                    </label>

                    {cotizacionSeleccionadaNueva && !mostrandoBuscadorCotizacion ? (
                      <div className="bg-background border border-primary-container p-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-label-caps text-[10px] text-primary-container uppercase">
                            Cotización seleccionada
                          </p>
                          <button
                            type="button"
                            onClick={() => setMostrandoBuscadorCotizacion(true)}
                            className="shrink-0 font-['Inter'] text-[14px] font-semibold text-on-surface-variant hover:text-on-surface uppercase underline cursor-pointer"
                          >
                            Cambiar
                          </button>
                        </div>
                        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-code-sm text-[11px]">
                          <div>
                            <dt className="text-on-surface-variant uppercase">Cliente</dt>
                            <dd className="text-on-surface">
                              {datosClienteServicio(cotizacionSeleccionadaNueva.id).cliente}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-on-surface-variant uppercase">Servicio</dt>
                            <dd className="text-on-surface">
                              {datosClienteServicio(cotizacionSeleccionadaNueva.id).servicio}
                            </dd>
                          </div>
                          <div className="col-span-2 sm:col-span-1">
                            <dt className="text-on-surface-variant uppercase">Descripción</dt>
                            <dd className="text-on-surface line-clamp-2">
                              {datosClienteServicio(cotizacionSeleccionadaNueva.id).solicitud?.descripcion ?? '—'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-on-surface-variant uppercase">Total</dt>
                            <dd className="text-on-surface">{cotizacionSeleccionadaNueva.total ?? cotizacionSeleccionadaNueva.valor}</dd>
                          </div>
                          <div>
                            <dt className="text-on-surface-variant uppercase">Anticipo</dt>
                            <dd className="text-on-surface">
                              {cotizacionSeleccionadaNueva.estado_anticipo === 'NO_APLICA'
                                ? 'No aplica'
                                : `${cotizacionSeleccionadaNueva.anticipo_porcentaje ?? '—'}% · ${cotizacionSeleccionadaNueva.estado_anticipo ?? '—'}`}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-on-surface-variant uppercase">Saldo</dt>
                            <dd className="text-on-surface">
                              {cotizacionSeleccionadaNueva.saldo_pendiente
                                ? `${cotizacionSeleccionadaNueva.saldo_pendiente} · ${cotizacionSeleccionadaNueva.estado_saldo}`
                                : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-on-surface-variant uppercase">Estado</dt>
                            <dd className="text-on-surface">{cotizacionSeleccionadaNueva.estado.replace(/_/g, ' ')}</dd>
                          </div>
                        </dl>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="relative">
                          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">
                            search
                          </span>
                          <input
                            type="text"
                            value={busquedaCotizacionNueva}
                            onChange={(e) => setBusquedaCotizacionNueva(e.target.value)}
                            placeholder="Buscar cotización por n.º, cliente, servicio o descripción…"
                            className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                          />
                        </div>
                        <div className="max-h-56 overflow-y-auto border border-outline divide-y divide-outline">
                          {estadoApoyo === 'cargando' && (
                            <p className="p-3 font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                              Cargando cotizaciones…
                            </p>
                          )}
                          {estadoApoyo === 'error' && (
                            <p className="p-3 font-['Inter'] text-[13px] font-normal text-error uppercase">
                              No se pudieron cargar las cotizaciones.
                            </p>
                          )}
                          {estadoApoyo === 'disponible' && cotizacionesElegibles.length === 0 && (
                            <p className="p-3 font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
                              Ninguna cotización ACEPTADA disponible coincide (ya con anticipo resuelto y sin orden
                              existente).
                            </p>
                          )}
                          {estadoApoyo === 'disponible' &&
                            cotizacionesElegibles.slice(0, 20).map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => handleSeleccionarCotizacionNueva(c.id)}
                                className="w-full text-left p-3 hover:bg-surface-container-high transition-colors cursor-pointer"
                              >
                                <p className="font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface">
                                  {datosClienteServicio(c.id).cliente} — {datosClienteServicio(c.id).servicio}
                                </p>
                                <p className="font-code-sm text-[11px] text-on-surface-variant mt-0.5 line-clamp-1">
                                  Total {c.total ?? c.valor}
                                </p>
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <form className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end" onSubmit={handleCrear}>
                    <div>
                      <label className="block font-code-sm text-code-sm text-on-surface-variant uppercase mb-2">
                        Fecha de entrega (opcional)
                      </label>
                      <input
                        value={fechaEntregaNueva}
                        onChange={(e) => setFechaEntregaNueva(e.target.value)}
                        className="w-full bg-background border-0 border-b border-outline text-on-surface px-0 py-2 focus:ring-0 focus:border-primary-container transition-colors font-body-md outline-none"
                        type="date"
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
                      <button
                        disabled={creando || !cotizacionIdNueva.trim()}
                        type="submit"
                        className="inline-flex items-center justify-center px-6 py-3 bg-primary-container text-on-primary-container font-['Inter'] text-[14px] font-semibold hover:bg-primary-fixed-dim transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {creando ? 'CREANDO...' : 'CREAR ORDEN'}
                      </button>
                    </div>
                    {mensajeCrear && (
                      <p className="md:col-span-3 font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">{mensajeCrear}</p>
                    )}
                  </form>
                </div>
              )}
            </div>
          )}

          {!ordenes || ordenes.length === 0 ? (
            <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">NO HAY ÓRDENES REGISTRADAS.</p>
          ) : (
            <>
              {/* FILTROS — mismo patrón/lógica ya usados en la vista ADMIN
                  (filtradasAdmin/ordenadasAdmin/etc.), reutilizados aquí. */}
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
                      placeholder="Buscar por código de orden, n.º de solicitud o cotización, cliente o servicio…"
                      className="w-full bg-background border border-outline pl-10 pr-3 py-2.5 text-on-surface text-sm focus:border-primary-container focus:outline-hidden font-body-md"
                    />
                  </div>
                  <div className="relative">
                    <select
                      value={estadoFiltroAdmin}
                      onChange={(e) => setEstadoFiltroAdmin(e.target.value as EstadoFiltroOrden)}
                      className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                    >
                      {ESTADOS_FILTRO_ORDEN.map((estado) => (
                        <option key={estado} value={estado}>
                          {estado === 'TODOS' ? 'Estado: Todos' : estado.replace(/_/g, ' ')}
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
                        onChange={(e) => setOrdenPorAdmin(e.target.value as OrdenPorAdmin)}
                        className="w-full appearance-none bg-background border border-outline pl-4 pr-10 py-2.5 text-on-surface text-sm font-code-sm uppercase focus:border-primary-container focus:outline-hidden cursor-pointer"
                      >
                        <option value="recientes">Más recientes</option>
                        <option value="antiguos">Más antiguas</option>
                        <option value="mayor_avance">Mayor avance</option>
                        <option value="menor_avance">Menor avance</option>
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
              <div className="hidden xl:block overflow-x-auto bg-surface sharp-border">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-outline">
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Código</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Solicitud</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Cotización</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Cliente</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Servicio</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Estado</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Avance</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">
                        Fecha de entrega
                      </th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase">Creada</th>
                      <th className="py-3 px-4 font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase text-right">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {datosPaginaAdmin.length === 0 && (
                      <tr>
                        <td colSpan={10} className="py-6 px-4 text-center font-code-sm text-code-sm text-on-surface-variant uppercase">
                          Ningún resultado coincide con estos filtros.
                        </td>
                      </tr>
                    )}
                    {datosPaginaAdmin.map((o) => {
                      const { cliente, servicio } = datosClienteServicio(o.cotizacion_id);
                      return (
                        <tr key={o.id} className="border-b border-outline hover:bg-surface-container-high transition-colors">
                          <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface">{o.codigo}</td>
                          <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant whitespace-nowrap" title={ayudaReferencia(o.solicitud_codigo)}>{referenciaOrigen(o.solicitud_codigo)}</td>
                          <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant whitespace-nowrap" title={ayudaReferencia(o.cotizacion_codigo)}>{referenciaOrigen(o.cotizacion_codigo)}</td>
                          <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface">{cliente}</td>
                          <td className="py-3 px-4 font-['Inter'] text-[14px] font-normal leading-[20px] text-on-surface break-words">{servicio}</td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex whitespace-nowrap px-2.5 py-1 font-code-sm text-[11px]! leading-tight uppercase ${claseBadgeEstadoOrden(o.estado)}`}
                            >
                              {o.estado.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 w-28">
                              <div className="flex-1">
                                <BarraProgreso valor={o.avance} />
                              </div>
                              <span className="font-code-sm text-[11px] text-on-surface-variant shrink-0">{o.avance}%</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                            {formatearFechaEntrega(o.fecha_entrega) ?? '—'}
                          </td>
                          <td className="py-3 px-4 font-code-sm text-code-sm text-on-surface-variant">
                            {new Date(o.creado_en).toLocaleDateString()}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => abrirDetalle(o.id)}
                              aria-label="Ver detalle de la orden"
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
              <div className="xl:hidden space-y-3">
                {datosPaginaAdmin.length === 0 && (
                  <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase text-center py-6">
                    Ningún resultado coincide con estos filtros.
                  </p>
                )}
                {datosPaginaAdmin.map((o) => {
                  const { cliente, servicio } = datosClienteServicio(o.cotizacion_id);
                  return (
                    <div key={o.id} className="bg-surface sharp-border border-l-4 border-l-primary-container p-4 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                        <div className="min-w-0 flex-1 basis-40">
                          <p className="font-body-md text-body-md text-on-surface font-medium wrap-anywhere">{o.codigo}</p>
                          <p className="font-code-sm text-[11px] text-on-surface-variant uppercase mt-0.5 wrap-anywhere">
                            {cliente} — {servicio}
                          </p>
                        </div>
                        <span
                          className={`inline-flex shrink-0 whitespace-nowrap px-2.5 py-1 font-code-sm text-[11px]! leading-tight uppercase ${claseBadgeEstadoOrden(o.estado)}`}
                        >
                          {o.estado.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <BarraProgreso valor={o.avance} />
                        </div>
                        <span className="font-code-sm text-[11px] text-on-surface-variant shrink-0">{o.avance}%</span>
                      </div>

                      <dl className="grid grid-cols-2 gap-2 font-code-sm text-[11px] wrap-anywhere">
                        <div>
                          <dt className="text-on-surface-variant uppercase">Solicitud</dt>
                          <dd className="text-on-surface" title={ayudaReferencia(o.solicitud_codigo)}>{referenciaOrigen(o.solicitud_codigo)}</dd>
                        </div>
                        <div>
                          <dt className="text-on-surface-variant uppercase">Cotización</dt>
                          <dd className="text-on-surface" title={ayudaReferencia(o.cotizacion_codigo)}>{referenciaOrigen(o.cotizacion_codigo)}</dd>
                        </div>
                        <div>
                          <dt className="text-on-surface-variant uppercase">Fecha de entrega</dt>
                          <dd className="text-on-surface">{formatearFechaEntrega(o.fecha_entrega) ?? '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-on-surface-variant uppercase">Creada</dt>
                          <dd className="text-on-surface">{new Date(o.creado_en).toLocaleDateString()}</dd>
                        </div>
                      </dl>

                      <div className="flex items-center justify-end pt-1 border-t border-outline">
                        <button
                          type="button"
                          onClick={() => abrirDetalle(o.id)}
                          aria-label="Ver detalle de la orden"
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
                    {ordenadasAdmin.length} órdenes
                  </span>
                  <div className="relative">
                    <select
                      value={registrosPorPaginaAdmin}
                      onChange={(e) => setRegistrosPorPaginaAdmin(Number(e.target.value))}
                      className="appearance-none bg-background border border-outline pl-3 pr-11 py-1.5 text-on-surface font-['Inter'] text-[13px] font-normal focus:border-primary-container focus:outline-hidden cursor-pointer"
                    >
                      {REGISTROS_POR_PAGINA_OPCIONES_ORDEN.map((n) => (
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
