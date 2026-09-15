import * as alertasRepo from '../repositories/alertas.repository.js';
import type { Alerta } from '../repositories/alertas.repository.js';

export class AlertaNoEncontradaError extends Error {}
export class AlertaYaAtendidaError extends Error {}

// Genera (si corresponde) y devuelve el listado real de alertas. La
// generación es idempotente: volver a llamar esta función no duplica
// alertas ya existentes (lo garantiza el índice único de PostgreSQL).
export async function listarAlertas(): Promise<Alerta[]> {
  await alertasRepo.generarAlertasVencimiento();
  return alertasRepo.listAll();
}

export async function atenderAlerta(id: string): Promise<Alerta> {
  const actual = await alertasRepo.findById(id);
  if (!actual) {
    throw new AlertaNoEncontradaError();
  }
  if (actual.estado === 'ATENDIDA') {
    throw new AlertaYaAtendidaError();
  }

  const actualizada = await alertasRepo.marcarAtendida(id);
  if (!actualizada) {
    throw new AlertaNoEncontradaError();
  }
  return actualizada;
}
