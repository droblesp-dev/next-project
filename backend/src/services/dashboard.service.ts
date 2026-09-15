import * as dashboardRepo from '../repositories/dashboard.repository.js';
import type { ConteoPorEstado } from '../repositories/dashboard.repository.js';

export interface AnalisisIaKpi {
  totalEjecuciones: number;
  completadas: number;
  conError: number;
  revisadas: number;
  nota: string;
}

export interface DashboardResumen {
  solicitudes: { total: number; porEstado: ConteoPorEstado[] };
  cotizaciones: { total: number; porEstado: ConteoPorEstado[]; valorTotalAceptadas: number };
  ordenes: { total: number; porEstado: ConteoPorEstado[] };
  alertas: { pendientes: number; atendidas: number };
  leads: { porClasificacion: ConteoPorEstado[] };
  analisisIa: AnalisisIaKpi | null;
}

function sumar(conteos: ConteoPorEstado[]): number {
  return conteos.reduce((acc, c) => acc + c.total, 0);
}

// Construye la nota aclaratoria del KPI de IA dinámicamente a partir del
// dato real de solicitudes distintas involucradas — nunca un texto fijo.
function construirNotaAnalisisIa(totalEjecuciones: number, solicitudesDistintas: number): string {
  if (solicitudesDistintas === 1) {
    return totalEjecuciones === 1
      ? 'La ejecución registrada corresponde a una única solicitud.'
      : `Las ${totalEjecuciones} ejecuciones corresponden a una única solicitud.`;
  }
  return `Las ${totalEjecuciones} ejecuciones corresponden a ${solicitudesDistintas} solicitudes distintas.`;
}

export async function obtenerResumen(): Promise<DashboardResumen> {
  const [solicitudesPorEstado, cotizacionesPorEstado, valorAceptadas, ordenesPorEstado, alertas, leadsPorClasificacion, analisisIa] =
    await Promise.all([
      dashboardRepo.solicitudesPorEstado(),
      dashboardRepo.cotizacionesPorEstado(),
      dashboardRepo.valorTotalCotizacionesAceptadas(),
      dashboardRepo.ordenesPorEstado(),
      dashboardRepo.alertasPendientesYAtendidas(),
      dashboardRepo.leadsPorClasificacion(),
      dashboardRepo.resumenAnalisisIa(),
    ]);

  // Regla explícita de Fase 12: si no hay ejecuciones reales registradas,
  // el KPI no puede calcularse objetivamente y se omite (no se muestra un
  // "0 ejecuciones" que sugiera un indicador activo sin evidencia real).
  const analisisIaKpi: AnalisisIaKpi | null =
    analisisIa.totalEjecuciones === 0
      ? null
      : {
          totalEjecuciones: analisisIa.totalEjecuciones,
          completadas: analisisIa.completadas,
          conError: analisisIa.conError,
          revisadas: analisisIa.revisadas,
          nota: construirNotaAnalisisIa(analisisIa.totalEjecuciones, analisisIa.solicitudesDistintas),
        };

  return {
    solicitudes: { total: sumar(solicitudesPorEstado), porEstado: solicitudesPorEstado },
    cotizaciones: {
      total: sumar(cotizacionesPorEstado),
      porEstado: cotizacionesPorEstado,
      valorTotalAceptadas: valorAceptadas,
    },
    ordenes: { total: sumar(ordenesPorEstado), porEstado: ordenesPorEstado },
    alertas,
    leads: { porClasificacion: leadsPorClasificacion },
    analisisIa: analisisIaKpi,
  };
}
