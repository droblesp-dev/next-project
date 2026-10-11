import { useEffect, useState } from 'react';
import { fetchAutenticado, SesionInvalidaError } from '../lib/authClient';

interface ConteoPorEstado {
  estado: string;
  total: number;
}

interface AnalisisIaKpi {
  totalEjecuciones: number;
  completadas: number;
  conError: number;
  revisadas: number;
  nota: string;
}

interface DashboardResumen {
  solicitudes: { total: number; porEstado: ConteoPorEstado[] };
  cotizaciones: { total: number; porEstado: ConteoPorEstado[]; valorTotalAceptadas: number };
  ordenes: { total: number; porEstado: ConteoPorEstado[] };
  alertas: { pendientes: number; atendidas: number };
  leads: { porClasificacion: ConteoPorEstado[] };
  analisisIa: AnalisisIaKpi | null;
}

interface GestionDashboardProps {
  token: string;
  onSesionInvalida: () => void;
}

// Mejora frontend controlada — autorización explícita ("DASHBOARD ADMIN —
// MEJORA FRONTEND CONTROLADA"): mismo lenguaje visual ya usado en
// Solicitudes/Cotizaciones/Órdenes/Alertas/Leads/Usuarios ADMIN. Ningún
// cálculo, consulta SQL, dato ni endpoint cambia — solo presentación.
function KpiDashboard({
  icono,
  valor,
  etiqueta,
  claseIcono,
  claseBorde,
}: {
  icono: string;
  valor: number | string;
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
        <p className="font-['Inter'] text-[12px] font-semibold text-on-surface-variant uppercase mt-1">{etiqueta}</p>
      </div>
    </div>
  );
}

// Badges por estado real — mapa unificado con los mismos colores ya
// usados en BandejaSolicitudes.tsx / GestionCotizaciones.tsx /
// GestionOrdenes.tsx / GestionLeads.tsx (solo tokens ya definidos en
// index.css). CANCELADA es compartido por Solicitudes/Cotizaciones/
// Órdenes con el mismo significado, sin ambigüedad porque cada gráfico
// recibe los estados de un único módulo a la vez.
const BADGE_ESTADO_DASHBOARD: Record<string, string> = {
  // Solicitudes
  NUEVA: 'border border-primary-container text-primary-container bg-primary-container/10',
  EN_REVISION: 'border border-outline-variant text-on-surface-variant bg-outline-variant/10',
  COTIZADA: 'border border-primary-container bg-primary-container text-on-primary-container',
  CANCELADA: 'border border-error text-error bg-error-container/20',
  // Cotizaciones
  BORRADOR: 'border border-outline text-on-surface-variant',
  ENVIADA: 'border border-primary-container text-primary-container bg-primary-container/10',
  ACEPTADA: 'border border-primary-container bg-primary-container text-on-primary-container',
  RECHAZADA: 'border border-error text-error bg-error-container/20',
  VENCIDA: 'border border-outline-variant text-on-surface-variant bg-outline-variant/10',
  // Órdenes
  PENDIENTE: 'border border-outline text-on-surface-variant',
  EN_PROCESO: 'border border-primary-container text-primary-container bg-primary-container/10',
  PAUSADA: 'border border-outline-variant text-on-surface-variant bg-outline-variant/10',
  FINALIZADA: 'border border-primary-container bg-primary-container text-on-primary-container',
  CERRADA: 'border border-secondary-container text-secondary bg-secondary-container/30',
  // Leads (clasificación)
  FRIO: 'border border-outline-variant text-on-surface-variant bg-outline-variant/10',
  TIBIO: 'border border-primary-container text-primary-container bg-primary-container/10',
  CALIENTE: 'border border-primary-container bg-primary-container text-on-primary-container',
  CONVERTIDO: 'border border-secondary-container text-secondary bg-secondary-container/30',
  RECURRENTE: 'border border-primary-container bg-primary-fixed-dim text-on-primary-container',
};

function claseBadgeEstadoDashboard(estado: string): string {
  return BADGE_ESTADO_DASHBOARD[estado] ?? 'border border-outline text-on-surface-variant';
}

// Un decimal de precisión (p. ej. 3.8%, 81.7%), no entero redondeado.
function calcularPorcentaje(valor: number, total: number): number {
  return total > 0 ? Math.round((valor / total) * 1000) / 10 : 0;
}

// Formato monetario localizado (punto de miles, coma decimal), igual al
// usado anteriormente en el dashboard. No modifica valorTotalAceptadas — solo
// cambia cómo se presenta el mismo número.
function formatearMoneda(valor: number): string {
  return new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor);
}

// Color de punto/porcentaje coordinado con el mismo significado semántico ya
// usado en BADGE_ESTADO_DASHBOARD (rojo = cancelado/rechazado, dorado sólido
// = estado positivo/final, gris-neutro = intermedio/archivado). No se
// introduce ningún color nuevo (p. ej. verde) porque no existe ese token en
// frontend/src/index.css — usar un color no definido violaría la regla de no
// inventar y de reutilizar únicamente los tokens de diseño existentes.
const COLOR_PUNTO_ESTADO: Record<string, string> = {
  CANCELADA: 'var(--color-error)',
  RECHAZADA: 'var(--color-error)',
  ACEPTADA: 'var(--color-primary-container)',
  COTIZADA: 'var(--color-primary-container)',
  ENVIADA: 'var(--color-primary-fixed-dim)',
  EN_REVISION: 'var(--color-on-surface-variant)',
  BORRADOR: 'var(--color-on-surface-variant)',
  VENCIDA: 'var(--color-on-surface-variant)',
  NUEVA: 'var(--color-primary-fixed-dim)',
};

function colorPuntoEstado(estado: string): string {
  return COLOR_PUNTO_ESTADO[estado] ?? 'var(--color-primary-container)';
}

// [REQUIERE VALIDACIÓN] El orden real que devuelve el backend es alfabético
// (`ORDER BY estado` en dashboard.repository.ts, verificado por curl), NO el
// orden solicitado aquí. Como el backend no puede modificarse en esta tarea,
// se aplica un reordenamiento fijo del lado del frontend — una secuencia
// explícita por nombre de estado, NO un `sort` dinámico por cantidad (eso es
// justamente lo que la instrucción pide evitar, porque cambiaría de orden
// solo si los valores cambian). Ningún estado se descarta: uno no listado
// aquí se muestra igual, al final, ordenado alfabéticamente como respaldo.
const ORDEN_SOLICITUDES = ['CANCELADA', 'COTIZADA', 'EN_REVISION', 'NUEVA'];
const ORDEN_COTIZACIONES = ['ACEPTADA', 'ENVIADA', 'BORRADOR', 'RECHAZADA', 'VENCIDA', 'CANCELADA'];

function ordenarPorSecuencia(datos: ConteoPorEstado[], secuencia: string[]): ConteoPorEstado[] {
  return [...datos].sort((a, b) => {
    const ia = secuencia.indexOf(a.estado);
    const ib = secuencia.indexOf(b.estado);
    if (ia === -1 && ib === -1) return a.estado.localeCompare(b.estado);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

// Visualización categórica compacta de barras horizontales — decisión
// explícita ("DASHBOARD ADMIN 2.4") de abandonar el gráfico de curvas/área/
// puntos: estos datos son estados (categorías), no una serie temporal.
// Mismo cálculo (`calcularPorcentaje`) y mismo orden real que devuelve el
// backend; el ancho de cada barra es proporcional al porcentaje real del
// estado respecto al total. Barras delgadas y redondeadas, color coordinado
// con la misma paleta semántica de `COLOR_PUNTO_ESTADO`/`BADGE_ESTADO_DASHBOARD`.
// La cantidad tiene mayor jerarquía visual (texto más grande/negrita) que el
// porcentaje (texto pequeño/atenuado).
function BarrasEstados({ titulo, datos }: { titulo: string; datos: ConteoPorEstado[] }) {
  const total = datos.reduce((acc, d) => acc + d.total, 0);

  return (
    <div className="bg-surface sharp-border p-6 h-full">
      <p className="font-label-caps text-label-caps text-primary-container uppercase mb-4">{titulo}</p>
      {datos.length === 0 ? (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Sin datos.</p>
      ) : (
        <div className="space-y-2.5">
          {datos.map((d) => {
            const porcentaje = calcularPorcentaje(d.total, total);
            return (
              <div key={d.estado} className="flex items-center gap-3">
                <span className="font-code-sm text-[10px] text-on-surface-variant uppercase w-28 shrink-0 truncate">
                  {d.estado}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${porcentaje}%`, backgroundColor: colorPuntoEstado(d.estado) }}
                  />
                </div>
                <span className="font-code-sm text-sm font-bold text-on-surface w-8 text-right shrink-0">
                  {d.total}
                </span>
                <span className="font-code-sm text-[10px] text-on-surface-variant w-12 text-right shrink-0">
                  {porcentaje.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Fila horizontal compacta de bloques por estado — usada para Órdenes.
// Mismo cálculo (total, porcentaje) que el resto del dashboard; solo cambia
// la disposición a una fila completa de bloques en vez de barras apiladas.
function FilaEstadosCompacta({ titulo, datos }: { titulo: string; datos: ConteoPorEstado[] }) {
  const total = datos.reduce((acc, d) => acc + d.total, 0);

  return (
    <div className="bg-surface sharp-border p-6">
      <p className="font-label-caps text-label-caps text-primary-container uppercase mb-4">{titulo}</p>
      {datos.length === 0 ? (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Sin datos.</p>
      ) : (
        <div className="flex flex-wrap lg:flex-nowrap justify-center gap-4">
          {datos.map((d) => {
            const porcentaje = calcularPorcentaje(d.total, total);
            return (
              <div
                key={d.estado}
                className="w-[calc(50%-0.5rem)] sm:w-44 lg:w-48 border border-outline p-4 flex flex-col gap-2.5 justify-center"
              >
                <span
                  className={`inline-flex self-start px-2 py-0.5 font-code-sm text-[10px] uppercase ${claseBadgeEstadoDashboard(d.estado)}`}
                >
                  {d.estado}
                </span>
                <p className="font-headline-lg text-headline-lg-mobile font-black text-on-surface leading-none">{d.total}</p>
                <p className="font-code-sm text-xs text-on-surface-variant">{porcentaje.toFixed(1)}%</p>
                <div className="w-full h-2 bg-surface-container-high">
                  <div className="h-2 bg-primary-container" style={{ width: `${porcentaje}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Bloques compactos por clasificación — usados para Leads, en fila lado a
// lado con Análisis IA. Mismo cálculo que el resto del dashboard.
function BloquesCompactos({ titulo, datos }: { titulo: string; datos: ConteoPorEstado[] }) {
  const total = datos.reduce((acc, d) => acc + d.total, 0);

  return (
    <div className="bg-surface sharp-border p-6 h-full">
      <p className="font-label-caps text-label-caps text-primary-container uppercase mb-4">{titulo}</p>
      {datos.length === 0 ? (
        <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">Sin datos.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {datos.map((d) => {
            const porcentaje = calcularPorcentaje(d.total, total);
            return (
              <div key={d.estado} className="border border-outline p-2 text-center">
                <span
                  className={`inline-flex px-1.5 py-0.5 font-code-sm text-[9px] uppercase ${claseBadgeEstadoDashboard(d.estado)}`}
                >
                  {d.estado}
                </span>
                <p className="font-headline-md text-lg font-black text-on-surface leading-none mt-1">{d.total}</p>
                <p className="font-code-sm text-[10px] text-on-surface-variant">{porcentaje.toFixed(1)}%</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function GestionDashboard({ token, onSesionInvalida }: GestionDashboardProps) {
  const [resumen, setResumen] = useState<DashboardResumen | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchAutenticado('/api/dashboard', token);

      if (response.status === 403) {
        setError('No autorizado para consultar el dashboard.');
        return;
      }
      if (!response.ok) {
        setError('No se pudo cargar el dashboard.');
        return;
      }

      const data = (await response.json()) as { resumen: DashboardResumen };
      setResumen(data.resumen);
    } catch (err) {
      if (err instanceof SesionInvalidaError) {
        onSesionInvalida();
        return;
      }
      setError('No se pudo cargar el dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (loading) {
    return <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">CARGANDO DASHBOARD...</p>;
  }

  if (error || !resumen) {
    return <p className="font-['Inter'] text-[13px] font-normal text-error uppercase">{error ?? 'No se pudo cargar el dashboard.'}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Advertencia de datos de prueba — texto sin ningún cambio */}
      <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
        Los datos actuales son principalmente datos de prueba generados durante fases anteriores del proyecto — no
        representan operación productiva real.
      </p>

      {/* KPI — totales */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiDashboard
          icono="assignment"
          valor={resumen.solicitudes.total}
          etiqueta="Total solicitudes"
          claseIcono="bg-surface-container-high text-on-surface"
          claseBorde="border-l-outline"
        />
        <KpiDashboard
          icono="request_quote"
          valor={resumen.cotizaciones.total}
          etiqueta="Total cotizaciones"
          claseIcono="bg-primary-container/20 text-primary-container"
          claseBorde="border-l-primary-container"
        />
        <KpiDashboard
          icono="inventory_2"
          valor={resumen.ordenes.total}
          etiqueta="Total órdenes"
          claseIcono="bg-primary-container/20 text-primary-container"
          claseBorde="border-l-primary-container"
        />
      </div>

      {/* Solicitudes / Cotizaciones por estado — gráfico de línea + área +
          puntos (no barras), mismos datos y porcentajes ya calculados. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BarrasEstados
          titulo="Solicitudes por estado"
          datos={ordenarPorSecuencia(resumen.solicitudes.porEstado, ORDEN_SOLICITUDES)}
        />
        <BarrasEstados
          titulo="Cotizaciones por estado"
          datos={ordenarPorSecuencia(resumen.cotizaciones.porEstado, ORDEN_COTIZACIONES)}
        />
      </div>

      {/* Valor total de cotizaciones aceptadas + Alertas en una fila de dos
          columnas. Texto y cálculo sin cambios; sin botones ni acción de
          atender (eso permanece exclusivo de COMERCIAL/OPERATIVO). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface sharp-border p-6 border-l-4 border-l-primary-container h-full">
          <div className="flex items-center gap-2 mb-2">
            <span className="material-symbols-outlined text-primary-container text-[22px]">payments</span>
            <p className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              Valor total de cotizaciones aceptadas (sin IVA)
            </p>
          </div>
          <p className="font-headline-lg text-headline-lg-mobile font-black text-on-surface">
            ${formatearMoneda(resumen.cotizaciones.valorTotalAceptadas)}
          </p>
          <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-2">
            Este valor representa cotizaciones aceptadas, no ingresos ni facturación.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KpiDashboard
            icono="schedule"
            valor={resumen.alertas.pendientes}
            etiqueta="Alertas pendientes"
            claseIcono="bg-primary-container/20 text-primary-container"
            claseBorde="border-l-primary-container"
          />
          <KpiDashboard
            icono="check_circle"
            valor={resumen.alertas.atendidas}
            etiqueta="Alertas atendidas"
            claseIcono="bg-primary-container text-on-primary-container"
            claseBorde="border-l-primary-container"
          />
        </div>
      </div>

      {/* Órdenes por estado — fila horizontal completa de bloques
          compactos, mismos datos y porcentajes. */}
      <FilaEstadosCompacta titulo="Órdenes por estado" datos={resumen.ordenes.porEstado} />

      {/* Leads por clasificación + Análisis IA lado a lado, mismos datos. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BloquesCompactos titulo="Leads por clasificación" datos={resumen.leads.porClasificacion} />

        <div className="bg-surface sharp-border p-6 h-full">
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-primary-container text-[22px]">psychology</span>
            <p className="font-label-caps text-label-caps text-primary-container uppercase">
              Análisis IA — ejecuciones registradas
            </p>
          </div>
          {resumen.analisisIa === null ? (
            <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase">
              [PENDIENTE] No existen ejecuciones registradas del módulo de IA.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-body-md text-body-md text-on-surface">
                  {resumen.analisisIa.totalEjecuciones} ejecuciones registradas
                </span>
                <span className="inline-flex px-2.5 py-1 font-code-sm text-[10px] uppercase border border-primary-container bg-primary-container text-on-primary-container">
                  {resumen.analisisIa.completadas} COMPLETADO
                </span>
                <span className="inline-flex px-2.5 py-1 font-code-sm text-[10px] uppercase border border-error text-error bg-error-container/20">
                  {resumen.analisisIa.conError} ERROR
                </span>
              </div>
              <p className="font-body-md text-body-md text-on-surface">
                {resumen.analisisIa.revisadas} de {resumen.analisisIa.totalEjecuciones} revisadas
              </p>
              <p className="font-['Inter'] text-[13px] font-normal text-on-surface-variant uppercase mt-2">
                {resumen.analisisIa.nota}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
