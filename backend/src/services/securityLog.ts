// Bitácora mínima de eventos de seguridad (OWASP A09). Una línea JSON por evento en
// stdout, para que el recolector de logs del despliegue la procese. Nunca recibe
// contraseñas, tokens ni códigos: solo el tipo de evento, la IP y datos no secretos.
export type EventoSeguridad =
  | 'LOGIN_OK'
  | 'LOGIN_FALLIDO'
  | 'LOGIN_BLOQUEADO'
  | 'PASSWORD_CAMBIADA'
  | 'PROMESA_NO_CAPTURADA'
  | 'CHAT_ACCESO_SOMBRA_DENEGADO'
  | 'CHAT_PARTICIPANTE_INCORPORADO'
  | 'CHAT_PARTICIPANTE_RETIRADO'
  | 'CHAT_HILO_RECLAMADO';

export function enmascararCorreo(email: string): string {
  const [local = '', dominio = ''] = email.trim().toLowerCase().split('@');
  if (!dominio) return '***';
  return `${local.slice(0, 2)}***@${dominio}`;
}

export function registrarEventoSeguridad(evento: EventoSeguridad, datos: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ tipo: 'SEGURIDAD', evento, fecha: new Date().toISOString(), ...datos }));
}
