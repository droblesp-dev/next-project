import { pool } from '../config/db.js';
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

// Bloque 3A: alta de evidencia en UNA transacción, consistente entre BD y disco.
//   1. BEGIN + bloqueo de la fila de la orden (FOR UPDATE): las subidas de una misma orden se
//      serializan, así que estado y límite por tipo se comprueban sobre datos que nadie más puede
//      cambiar hasta el COMMIT (antes: SELECT -> comprobar -> INSERT, y 12 subidas simultáneas
//      guardaron 9 fotos con un límite de 5).
//   2. Se comprueban estado y límite, se inserta la fila y SOLO ENTONCES se llama a
//      `guardarArchivo()` (escritura física, la aporta el controller).
//   3. Si la escritura falla (o cualquier paso posterior), ROLLBACK: no queda fila. Si el fallo es
//      posterior a escribir el archivo (p. ej. el COMMIT), la excepción llega al controller, que
//      elimina el archivo. Solo un corte del proceso entre escribir y confirmar podría dejar un
//      archivo sin fila (nunca una fila sin archivo).
export async function agregarEvidencia(
  ordenId: string,
  tipo: 'FOTO' | 'PDF',
  nombreArchivo: string,
  guardarArchivo: () => Promise<void>
): Promise<OrdenEvidencia> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orden = await ordenesRepo.findEstadoParaActualizar(client, ordenId);
    if (!orden) {
      throw new OrdenNoEncontradaError();
    }
    if (!ESTADOS_PERMITEN_EVIDENCIA.includes(orden.estado)) {
      throw new EstadoNoPermiteEvidenciaError();
    }

    const actuales = await evidenciasRepo.contarPorTipo(ordenId, tipo, client);
    if (actuales >= LIMITES_POR_TIPO[tipo]) {
      throw new LimiteEvidenciasError();
    }

    const evidencia = await evidenciasRepo.crear({ ordenId, tipo, nombreArchivo }, client);
    await guardarArchivo();
    await client.query('COMMIT');
    return evidencia;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // la conexión ya falló; se libera abajo
    }
    throw error;
  } finally {
    client.release();
  }
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
