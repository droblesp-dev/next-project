// Aviso de arranque cuando el backend queda configurado para enviar correos REALES por Brevo (clave y remitente
// definidos y sandbox desactivado). No cambia ningún comportamiento: solo hace visible el riesgo para quien
// levanta el servidor, p. ej. durante pruebas manuales con datos ficticios. Nunca imprime la clave.
export function advertenciaCorreoReal(cfg: {
  brevoApiKey: string;
  nextProjectEmail: string;
  brevoSandbox: boolean;
}): string | null {
  if (!cfg.brevoApiKey || !cfg.nextProjectEmail || cfg.brevoSandbox) return null;
  return (
    '[EMAIL] ATENCIÓN: el envío de correos REALES está activo (BREVO_API_KEY configurada y BREVO_SANDBOX distinto de "true"). ' +
    'Las acciones que notifican al cliente enviarán correo de verdad. Para pruebas use BREVO_SANDBOX=true o deje BREVO_API_KEY vacía.'
  );
}
