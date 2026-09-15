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

function Tarjeta({ titulo, valor }: { titulo: string; valor: number | string }) {
  return (
    <div className="bg-surface sharp-border p-6 border-l-4 border-l-primary-container">
      <p className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-2">{titulo}</p>
      <p className="font-headline-lg text-headline-lg-mobile font-black text-on-surface">{valor}</p>
    </div>
  );
}

function DistribucionEstados({ titulo, datos }: { titulo: string; datos: ConteoPorEstado[] }) {
  const total = datos.reduce((acc, d) => acc + d.total, 0);
  return (
    <div className="bg-surface sharp-border p-6">
      <p className="font-label-caps text-label-caps text-primary-container uppercase mb-4">{titulo}</p>
      {datos.length === 0 && (
        <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">Sin datos.</p>
      )}
      <div className="space-y-3">
        {datos.map((d) => {
          const porcentaje = total > 0 ? Math.round((d.total / total) * 100) : 0;
          return (
            <div key={d.estado}>
              <div className="flex justify-between font-code-sm text-code-sm text-on-surface uppercase mb-1">
                <span>{d.estado}</span>
                <span>{d.total}</span>
              </div>
              <div className="w-full h-2 bg-surface-container-high">
                <div className="h-2 bg-primary-container" style={{ width: `${porcentaje}%` }} />
              </div>
            </div>
          );
        })}
      </div>
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
    return <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">CARGANDO DASHBOARD...</p>;
  }

  if (error || !resumen) {
    return <p className="font-code-sm text-xs text-error uppercase">{error ?? 'No se pudo cargar el dashboard.'}</p>;
  }

  return (
    <div className="space-y-8">
      <p className="font-code-sm text-xs text-on-surface-variant uppercase">
        Los datos actuales son principalmente datos de prueba generados durante fases anteriores del proyecto — no
        representan operación productiva real.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Tarjeta titulo="Total solicitudes" valor={resumen.solicitudes.total} />
        <Tarjeta titulo="Total cotizaciones" valor={resumen.cotizaciones.total} />
        <Tarjeta titulo="Total órdenes" valor={resumen.ordenes.total} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DistribucionEstados titulo="Solicitudes por estado" datos={resumen.solicitudes.porEstado} />
        <DistribucionEstados titulo="Cotizaciones por estado" datos={resumen.cotizaciones.porEstado} />
      </div>

      <div className="bg-surface sharp-border p-6 border-l-4 border-l-primary-container">
        <p className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-2">
          Valor total de cotizaciones aceptadas
        </p>
        <p className="font-headline-lg text-headline-lg-mobile font-black text-on-surface">
          ${resumen.cotizaciones.valorTotalAceptadas.toFixed(2)}
        </p>
        <p className="font-code-sm text-[10px] text-on-surface-variant uppercase mt-2">
          Este valor representa cotizaciones aceptadas, no ingresos ni facturación.
        </p>
      </div>

      <DistribucionEstados titulo="Órdenes por estado" datos={resumen.ordenes.porEstado} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Tarjeta titulo="Alertas pendientes" valor={resumen.alertas.pendientes} />
        <Tarjeta titulo="Alertas atendidas" valor={resumen.alertas.atendidas} />
      </div>

      <DistribucionEstados titulo="Leads por clasificación" datos={resumen.leads.porClasificacion} />

      <div className="bg-surface sharp-border p-6">
        <p className="font-label-caps text-label-caps text-primary-container uppercase mb-4">
          Análisis IA — ejecuciones registradas
        </p>
        {resumen.analisisIa === null ? (
          <p className="font-code-sm text-code-sm text-on-surface-variant uppercase">
            [PENDIENTE] No existen ejecuciones registradas del módulo de IA.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="font-body-md text-body-md text-on-surface">
              {resumen.analisisIa.totalEjecuciones} ejecuciones registradas — {resumen.analisisIa.completadas} COMPLETADO
              / {resumen.analisisIa.conError} ERROR
            </p>
            <p className="font-body-md text-body-md text-on-surface">
              {resumen.analisisIa.revisadas} de {resumen.analisisIa.totalEjecuciones} revisadas por un comercial
            </p>
            <p className="font-code-sm text-[10px] text-on-surface-variant uppercase mt-2">{resumen.analisisIa.nota}</p>
          </div>
        )}
      </div>
    </div>
  );
}
