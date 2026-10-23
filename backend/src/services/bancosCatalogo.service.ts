import * as bancosCatalogoRepo from '../repositories/bancosCatalogo.repository.js';
import type { BancoCatalogo } from '../repositories/bancosCatalogo.repository.js';

// PC-2026-01, Fase 1 ("Incorporar tipos de entidad financiera"): catálogo
// único para bancos y cooperativas de ahorro y crédito — misma tabla,
// mismo repositorio/servicio/controlador (V16). `TIPO_ENTIDAD_POR_DEFECTO`
// conserva el comportamiento de siempre cuando no se especifica tipo.
export const TIPOS_ENTIDAD_VALIDOS = ['BANCO', 'COOPERATIVA'] as const;
export type TipoEntidad = (typeof TIPOS_ENTIDAD_VALIDOS)[number];
const TIPO_ENTIDAD_POR_DEFECTO: TipoEntidad = 'BANCO';

export class TipoEntidadInvalidoError extends Error {}

// Nunca se confía en que el CHECK de PostgreSQL sea la única barrera
// (regla del proyecto: el backend valida, PostgreSQL garantiza integridad
// como red de seguridad final). `undefined`/vacío se resuelve al tipo por
// defecto (BANCO) — cualquier otro valor que no sea uno de los permitidos
// se rechaza explícitamente.
export function validarTipoEntidad(tipo: unknown): TipoEntidad {
  if (tipo === undefined || tipo === null || tipo === '') {
    return TIPO_ENTIDAD_POR_DEFECTO;
  }
  if (typeof tipo !== 'string' || !TIPOS_ENTIDAD_VALIDOS.includes(tipo as TipoEntidad)) {
    throw new TipoEntidadInvalidoError(`tipo debe ser uno de: ${TIPOS_ENTIDAD_VALIDOS.join(', ')}`);
  }
  return tipo as TipoEntidad;
}

// PC-2026-01 (Fase B — catálogo de bancos de Ecuador).

// Estrategia de deduplicación (regla 6 del catálogo): igualdad léxica
// exacta tras recortar espacios, pasar a minúsculas y colapsar espacios
// repetidos — no intenta resolver sinónimos/abreviaturas distintas del
// mismo banco. Exportada para que el script de siembra
// (scripts/seed-bancos-catalogo.ts) use exactamente el mismo criterio.
export function normalizarNombreBanco(nombre: string): string {
  return nombre.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function listarBancosCatalogo(): Promise<BancoCatalogo[]> {
  return bancosCatalogoRepo.listAll();
}
