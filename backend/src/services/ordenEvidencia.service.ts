import * as evidenciasRepo from '../repositories/ordenEvidencia.repository.js';
import * as ordenesRepo from '../repositories/ordenes.repository.js';
import type { OrdenEvidencia } from '../repositories/ordenEvidencia.repository.js';

export class OrdenNoEncontradaError extends Error {}
export class LimiteEvidenciasError extends Error {}
export class EvidenciaNoEncontradaError extends Error {}
export class EstadoNoPermiteEvidenciaError extends Error {}

// Máximos por tipo (decisión explícita del bloque). No exige ambos
// formatos — una sola FOTO, o un solo PDF, ya satisface el mínimo de 1
// evidencia total que exige cambiarEstadoOrden() para FINALIZADA.
const LIMITES_POR_TIPO: Record<string, number> = {
  FOTO: 5,
  PDF: 2,
};

// H-C (auditoría post-V9): solo se admite nueva evidencia mientras la
// orden está realmente en ejecución. Bloquea PENDIENTE (aún no empieza),
// FINALIZADA/CERRADA/CANCELADA (ya terminó su ciclo de trabajo).
const ESTADOS_PERMITEN_EVIDENCIA = ['EN_PROCESO', 'PAUSADA'];

export async function listarEvidencias(ordenId: string): Promise<OrdenEvidencia[]> {
  const orden = await ordenesRepo.findById(ordenId);
  if (!orden) {
    throw new OrdenNoEncontradaError();
  }
  return evidenciasRepo.listarPorOrden(ordenId);
}

// El límite se verifica ANTES de escribir el archivo a disco (ver
// ordenEvidencia.controller.ts) — si ya se alcanzó, no se toca el
// sistema de archivos en absoluto.
export async function agregarEvidencia(
  ordenId: string,
  tipo: 'FOTO' | 'PDF',
  nombreArchivo: string
): Promise<OrdenEvidencia> {
  const orden = await ordenesRepo.findById(ordenId);
  if (!orden) {
    throw new OrdenNoEncontradaError();
  }
  if (!ESTADOS_PERMITEN_EVIDENCIA.includes(orden.estado)) {
    throw new EstadoNoPermiteEvidenciaError();
  }

  const actuales = await evidenciasRepo.contarPorTipo(ordenId, tipo);
  if (actuales >= LIMITES_POR_TIPO[tipo]) {
    throw new LimiteEvidenciasError();
  }

  return evidenciasRepo.crear({ ordenId, tipo, nombreArchivo });
}

export async function contarEvidenciasTotal(ordenId: string): Promise<number> {
  return evidenciasRepo.contarTotal(ordenId);
}

// H-B (auditoría post-V9): resuelve la evidencia real a partir del
// registro de BD — el nombre de archivo nunca llega desde el cliente.
// Verifica explícitamente que la evidencia pertenezca a la orden indicada
// en la ruta (evita que el id de una evidencia de otra orden sirva para
// acceder a un archivo fuera de contexto).
export async function obtenerArchivoEvidencia(ordenId: string, evidenciaId: string): Promise<OrdenEvidencia> {
  const orden = await ordenesRepo.findById(ordenId);
  if (!orden) {
    throw new OrdenNoEncontradaError();
  }

  const evidencia = await evidenciasRepo.findById(evidenciaId);
  if (!evidencia || evidencia.orden_id !== ordenId) {
    throw new EvidenciaNoEncontradaError();
  }

  return evidencia;
}
