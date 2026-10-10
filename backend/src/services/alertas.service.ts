import * as alertasRepo from '../repositories/alertas.repository.js';
import { findById as findOrdenById } from '../repositories/ordenes.repository.js';
import { esResponsableOAdmin } from '../middleware/ordenResponsable.middleware.js';
import type { Alerta } from '../repositories/alertas.repository.js';

export class AlertaNoEncontradaError extends Error {}
export class AlertaYaAtendidaError extends Error {}
// ALERTAS-02 (hallazgo H1 / decisión 5A): autorización horizontal para "atender".
export class SinAccesoAlertaError extends Error {}

export interface UsuarioAlerta {
  sub: string;
  rol: string;
}

// ALERTAS-02 (decisiones 1A/2B/3A): visibilidad derivada por rol, siempre desde
// alerta -> orden -> responsable (1A) o por tipo (2B) — sin ninguna columna de
// destinatario (4A). Pura lectura: ya no genera nada (ver generarAlertas, decisión 8A).
//   - ADMIN: todas, sin filtro.
//   - OPERATIVO: solo las de las órdenes de las que es responsable_id actual.
//   - COMERCIAL: solo tipo ENTREGA (VENCIDA/PROXIMA) — ver justificación en el informe: la
//     gestión de FICHA_TECNICA (generarla, revisarla) ya es exclusiva de ADMIN/OPERATIVO desde
//     E-01, por lo que no es "de su gestión"; ENTREGA sí lo es (reprogramar fecha, comunicar al
//     cliente son acciones de COMERCIAL/ADMIN).
export async function listarAlertas(usuario: UsuarioAlerta): Promise<Alerta[]> {
  if (usuario.rol === 'ADMIN') {
    return alertasRepo.listAll();
  }
  if (usuario.rol === 'OPERATIVO') {
    return alertasRepo.listPorResponsable(usuario.sub);
  }
  if (usuario.rol === 'COMERCIAL') {
    return alertasRepo.listPorTipos(['ENTREGA']);
  }
  // Defensa en profundidad: la ruta ya restringe a estos 3 roles.
  throw new SinAccesoAlertaError();
}

// ALERTAS-02 (decisión 8A): único punto que ejecuta la generación (INSERT/UPDATE). Separado de la
// consulta — GET /api/alertas (listarAlertas) ya no la invoca.
export async function generarAlertas(): Promise<void> {
  await alertasRepo.generarAlertasVencimiento();
}

// ALERTAS-02 (decisión 5A / hallazgo H1): ADMIN puede atender cualquier alerta; OPERATIVO solo si
// es el responsable_id actual de la orden de esa alerta (misma regla que E-01, reutilizada vía
// `esResponsableOAdmin` — no se duplica la lógica). Una orden sin responsable, o de otro
// OPERATIVO, deniega con SinAccesoAlertaError (403). COMERCIAL nunca llega aquí (ruta restringida).
export async function atenderAlerta(id: string, usuario: UsuarioAlerta): Promise<Alerta> {
  const actual = await alertasRepo.findById(id);
  if (!actual) {
    throw new AlertaNoEncontradaError();
  }

  // La FK orden_id es NOT NULL y sin ON DELETE (nunca se borra la orden referenciada); si por
  // cualquier motivo no se encuentra, se trata igual que una alerta inexistente (mismo error, sin
  // revelar detalles internos).
  const orden = await findOrdenById(actual.orden_id);
  if (!orden || !esResponsableOAdmin(usuario, orden)) {
    throw new SinAccesoAlertaError();
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
