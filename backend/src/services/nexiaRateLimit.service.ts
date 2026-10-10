// Bloque 2A: límite de invocaciones a NexIA por usuario autenticado.
//
// IMPORTANTE (alcance): es un límite EN MEMORIA DEL PROCESO, de ventana
// deslizante. Es por instancia/proceso — NO es un rate limit distribuido: se
// reinicia al reiniciar el backend y, con varias instancias, cada una llevaría
// su propio conteo. Es suficiente para el alcance actual (un único proceso
// Node, sin balanceo). La identidad es el id del usuario del JWT, nunca la IP.
// Solo cuenta invocaciones a NexIA; los mensajes normales no pasan por aquí.
export const NEXIA_MAX_INVOCACIONES = 20;
export const NEXIA_VENTANA_MS = 60_000;

export class LimiteNexiaError extends Error {
  constructor(public readonly reintentarEnSegundos: number) {
    super('Se alcanzó el límite de invocaciones de NexIA.');
  }
}

const invocacionesPorUsuario = new Map<string, number[]>();

// Registra una invocación si el usuario no superó el límite; si lo superó,
// lanza LimiteNexiaError sin registrar nada. Debe llamarse solo cuando la
// invocación ya pasó todas las comprobaciones de autorización.
export function consumirInvocacionNexia(usuarioId: string, ahora: number = Date.now()): void {
  const desde = ahora - NEXIA_VENTANA_MS;
  const vigentes = (invocacionesPorUsuario.get(usuarioId) ?? []).filter((t) => t > desde);

  if (vigentes.length >= NEXIA_MAX_INVOCACIONES) {
    invocacionesPorUsuario.set(usuarioId, vigentes);
    const espera = Math.ceil((vigentes[0] + NEXIA_VENTANA_MS - ahora) / 1000);
    throw new LimiteNexiaError(Math.max(espera, 1));
  }

  vigentes.push(ahora);
  invocacionesPorUsuario.set(usuarioId, vigentes);

  // Limpieza oportunista de usuarios inactivos para que el mapa no crezca sin límite.
  if (invocacionesPorUsuario.size > 1000) {
    for (const [id, marcas] of invocacionesPorUsuario) {
      if (marcas.every((t) => t <= desde)) invocacionesPorUsuario.delete(id);
    }
  }
}

// ---------------------------------------------------------------------
// FORMULARIO-01: variante pública/anónima, para el asistente "Ayúdame con
// IA" del formulario de cotización (visitantes sin sesión — nunca hay un
// `usuarioId` de JWT). Mapa completamente separado del de arriba (nunca se
// mezclan claves de usuario autenticado con direcciones IP).
//
// NEXIA-UX-04 (autorización explícita — "APROBADO — IMPLEMENTAR NEXIA-UX-04"):
// este límite protege EXCLUSIVAMENTE el consumo real de Gemini, nunca el uso
// del asistente en general — asistenteFormulario.service.ts::consultarAsistente()
// solo lo consulta inmediatamente antes de intentar la llamada a Gemini; si no
// hay cupo, cae al respaldo determinístico (MODO ESTÁNDAR) sin propagar ningún
// error al visitante. MODO ESTÁNDAR no usa este limitador ni ningún otro — no
// consume cuota de Gemini, por lo que no tiene límite funcional propio (decisión
// explícita de este bloque).
// ---------------------------------------------------------------------
export const NEXIA_PUBLICO_MAX_INVOCACIONES = 10;
export const NEXIA_PUBLICO_VENTANA_MS = 10 * 60_000;

const invocacionesPorIp = new Map<string, number[]>();

export function consumirInvocacionNexiaPublica(ip: string, ahora: number = Date.now()): void {
  const desde = ahora - NEXIA_PUBLICO_VENTANA_MS;
  const vigentes = (invocacionesPorIp.get(ip) ?? []).filter((t) => t > desde);

  if (vigentes.length >= NEXIA_PUBLICO_MAX_INVOCACIONES) {
    invocacionesPorIp.set(ip, vigentes);
    const espera = Math.ceil((vigentes[0] + NEXIA_PUBLICO_VENTANA_MS - ahora) / 1000);
    throw new LimiteNexiaError(Math.max(espera, 1));
  }

  vigentes.push(ahora);
  invocacionesPorIp.set(ip, vigentes);

  if (invocacionesPorIp.size > 5000) {
    for (const [id, marcas] of invocacionesPorIp) {
      if (marcas.every((t) => t <= desde)) invocacionesPorIp.delete(id);
    }
  }
}
