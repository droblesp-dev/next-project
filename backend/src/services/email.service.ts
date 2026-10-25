import { env } from '../config/env.js';

// SOLICITUD-RECUPERACION-01B (autorización explícita): correo transaccional
// de confirmación de solicitud vía Brevo Transactional Email API — HTTP
// directo con `fetch` nativo (Node 24), sin SDK ni dependencia nueva
// (verificado antes de implementar: backend/package.json no tiene cliente
// HTTP externo ni SDK de ningún proveedor de correo).
// Referencia: https://developers.brevo.com/docs/send-a-transactional-email
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const BREVO_TIMEOUT_MS = 8000;

export type ResultadoEnvioCorreo =
  | { estado: 'sent'; messageId?: string }
  | { estado: 'failed'; error: string }
  | { estado: 'skipped'; motivo: string };

export interface ConfirmacionSolicitudInput {
  destinatarioEmail: string;
  destinatarioNombre: string;
  solicitudCodigo: string;
}

// Nunca se registra un correo completo en logs (CLAUDE.md §13) —
// "carlos.perez@gmail.com" -> "c***z@gmail.com".
function enmascararEmail(email: string): string {
  const [usuario, dominio] = email.split('@');
  if (!usuario || !dominio) return '***';
  if (usuario.length <= 2) return `${usuario[0] ?? '*'}***@${dominio}`;
  return `${usuario[0]}***${usuario[usuario.length - 1]}@${dominio}`;
}

function escaparHtml(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mismo patrón ya centralizado en frontend/src/lib/config.ts
// (SOLICITUD-RECUPERACION-01A) — número oficial, nunca el teléfono que el
// cliente ingresó en el formulario (decisión explícita del bloque).
function construirEnlaceWhatsApp(mensaje: string): string {
  return `https://wa.me/${env.nextProjectWhatsapp}?text=${encodeURIComponent(mensaje)}`;
}

// Contenido mínimo exacto pedido por el bloque — HTML sencillo (sin
// plantilla compleja) + texto plano equivalente. Nunca incluye contraseñas,
// tokens, precios ni datos de otros clientes.
function construirContenidoCorreo(input: ConfirmacionSolicitudInput): { asunto: string; html: string; texto: string } {
  const mensajeWhatsApp = `Hola, quiero continuar con mi solicitud ${input.solicitudCodigo} de ${env.nextProjectName}.`;
  const enlaceWhatsApp = construirEnlaceWhatsApp(mensajeWhatsApp);
  const asunto = `${env.nextProjectName} — Solicitud ${input.solicitudCodigo} recibida`;

  const texto = [
    `Hola ${input.destinatarioNombre}.`,
    '',
    `Hemos recibido correctamente tu solicitud en ${env.nextProjectName}.`,
    '',
    'Número de solicitud:',
    input.solicitudCodigo,
    '',
    'Guarda este número. Te permitirá identificar tu solicitud cuando te comuniques con nuestro equipo.',
    '',
    'Después de registrar tu solicitud puedes continuar por WhatsApp para que nuestro equipo revise tu requerimiento:',
    enlaceWhatsApp,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;padding:32px 24px;border-radius:4px;">
      <p style="margin:0 0 16px;">Hola ${escaparHtml(input.destinatarioNombre)}.</p>
      <p style="margin:0 0 16px;">Hemos recibido correctamente tu solicitud en ${escaparHtml(env.nextProjectName)}.</p>
      <p style="margin:0 0 4px;">Número de solicitud:</p>
      <p style="margin:0 0 16px;font-size:20px;font-weight:bold;letter-spacing:1px;">${escaparHtml(input.solicitudCodigo)}</p>
      <p style="margin:0 0 16px;">Guarda este número. Te permitirá identificar tu solicitud cuando te comuniques con nuestro equipo.</p>
      <p style="margin:0 0 24px;">Después de registrar tu solicitud puedes continuar por WhatsApp para que nuestro equipo revise tu requerimiento.</p>
      <p style="text-align:center;margin:0;">
        <a href="${enlaceWhatsApp}" style="display:inline-block;background:#d4a017;color:#1a1a1a;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:bold;">CONTINUAR POR WHATSAPP</a>
      </p>
    </div>
  </body>
</html>`;

  return { asunto, html, texto };
}

// Fase 1 (autorización explícita — "Implementación Fase 1: envío
// automático de cotizaciones por correo"): correo de aviso del enlace
// público de una cotización, EXCLUYENDO deliberadamente el código de 6
// dígitos (esta interfaz no tiene ningún campo para él — el código lo
// entrega el asesor comercial por separado). Función completamente
// independiente de enviarConfirmacionSolicitud()/construirContenidoCorreo()
// — no comparte código con ella para no arriesgar su comportamiento ya
// aprobado.
export interface EnlaceCotizacionInput {
  destinatarioEmail: string;
  destinatarioNombre: string;
  // Identificador legible de la solicitud (SOL-XXXXXX), si existe — nunca
  // el UUID interno. `null` en el caso (no esperado, pero no asumido) de
  // una solicitud histórica sin código asignado.
  solicitudCodigo: string | null;
  // COT-XXXXXX; NULL en cotizaciones históricas sin código.
  cotizacionCodigo: string | null;
  token: string;
}

// URL pública del frontend: FRONTEND_URL si está definida; si no, el primer origen de
// CORS_ORIGINS (que debe ser el del frontend, no el del backend). Misma ruta que ya interpreta el frontend
// (GestionCotizaciones.tsx::urlPublicaCotizacion -> `/cotizacion/publica/:token`),
// ninguna ruta nueva.
function construirUrlPublicaCotizacion(token: string): string {
  const origen = env.frontendUrl || (env.corsOrigins[0] ?? '');
  return `${origen}/cotizacion/publica/${encodeURIComponent(token)}`;
}

// Referencia legible para asunto y texto: el código de la cotización (COT-XXXXXX); las históricas
// sin código usan el número de solicitud.
function construirReferenciaCotizacion(ref: {
  cotizacionCodigo: string | null;
  solicitudCodigo: string | null;
}): string {
  if (ref.cotizacionCodigo) return ` — Cotización ${ref.cotizacionCodigo}`;
  if (ref.solicitudCodigo) return ` — Solicitud ${ref.solicitudCodigo}`;
  return '';
}

function construirContenidoCorreoCotizacion(
  input: EnlaceCotizacionInput
): { asunto: string; html: string; texto: string } {
  const url = construirUrlPublicaCotizacion(input.token);
  const referencia = construirReferenciaCotizacion(input);
  const asunto = `${env.nextProjectName} — Tu cotización ya está disponible${referencia}`;
  // Autorización explícita ("A. Incluir WhatsApp en el correo de cotización
  // disponible"): mismo mensaje genérico ya usado en los correos de
  // recuperación — nunca el código de acceso ni ningún token.
  const enlaceWhatsApp = construirEnlaceWhatsApp(construirMensajeWhatsAppAyudaCotizacion(input));

  const texto = [
    `Hola ${input.destinatarioNombre}.`,
    '',
    `Tu cotización de ${env.nextProjectName} ya está disponible para que la revises${referencia}.`,
    '',
    'Accede aquí:',
    url,
    '',
    'Para completar el acceso necesitarás el código de seguridad de 6 dígitos que tu asesor comercial te compartirá por separado.',
    '',
    '¿Necesitas ayuda? Contáctanos por WhatsApp:',
    enlaceWhatsApp,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;padding:32px 24px;border-radius:4px;">
      <p style="margin:0 0 16px;">Hola ${escaparHtml(input.destinatarioNombre)}.</p>
      <p style="margin:0 0 24px;">Tu cotización de ${escaparHtml(env.nextProjectName)} ya está disponible para que la revises${escaparHtml(referencia)}.</p>
      <p style="text-align:center;margin:0 0 24px;">
        <a href="${url}" style="display:inline-block;background:#d4a017;color:#1a1a1a;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:bold;">VER MI COTIZACIÓN</a>
      </p>
      <p style="margin:0 0 24px;">Para completar el acceso necesitarás el código de seguridad de 6 dígitos que tu asesor comercial te compartirá por separado.</p>
      <p style="text-align:center;margin:0;">
        <a href="${enlaceWhatsApp}" style="display:inline-block;background:#d4a017;color:#1a1a1a;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:bold;">¿NECESITAS AYUDA? ESCRÍBENOS POR WHATSAPP</a>
      </p>
    </div>
  </body>
</html>`;

  return { asunto, html, texto };
}

// Se llama SIEMPRE DESPUÉS de que generarEnlaceCotizacion() ya completó
// con éxito (ver cotizaciones.controller.ts::generarEnlaceController) —
// nunca antes, nunca dentro de ninguna transacción ni operación de
// PostgreSQL. SIEMPRE resuelve (nunca rechaza/lanza) — mismo criterio que
// enviarConfirmacionSolicitud(): un fallo de Brevo nunca debe invalidar un
// enlace ya generado. Un solo intento, sin reintentos automáticos (evita
// duplicar envíos) — si se invoca de nuevo (p. ej. al regenerar el
// enlace), es una llamada nueva e independiente con el token vigente, no
// un reintento de esta.
export async function enviarEnlaceCotizacion(input: EnlaceCotizacionInput): Promise<ResultadoEnvioCorreo> {
  if (!env.brevoApiKey || !env.nextProjectEmail) {
    const motivo =
      !env.brevoApiKey && !env.nextProjectEmail
        ? 'BREVO_API_KEY y NEXT_PROJECT_EMAIL no configurados'
        : !env.brevoApiKey
          ? 'BREVO_API_KEY no configurado'
          : 'NEXT_PROJECT_EMAIL no configurado';
    console.log(`[EMAIL] Enlace de cotización generado correctamente, pero el envío está desactivado (${motivo}).`);
    return { estado: 'skipped', motivo };
  }

  const { asunto, html, texto } = construirContenidoCorreoCotizacion(input);
  const destinoEnmascarado = enmascararEmail(input.destinatarioEmail);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);
  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': env.brevoApiKey,
        ...(env.brevoSandbox ? { 'X-Sib-Sandbox': 'drop' } : {}),
      },
      body: JSON.stringify({
        sender: { name: env.nextProjectName, email: env.nextProjectEmail },
        to: [{ email: input.destinatarioEmail, name: input.destinatarioNombre }],
        subject: asunto,
        htmlContent: html,
        textContent: texto,
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as { messageId?: unknown; message?: unknown } | null;

    if (!response.ok) {
      const errorResumen = typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`;
      console.log(
        `[EMAIL] Enlace de cotización generado correctamente, pero falló su envío (destino=${destinoEnmascarado}): ${errorResumen}`
      );
      return { estado: 'failed', error: errorResumen };
    }

    const messageId = typeof data?.messageId === 'string' ? data.messageId : undefined;
    console.log(
      `[EMAIL] Enlace de cotización enviado correctamente (destino=${destinoEnmascarado}).${messageId ? ` messageId=${messageId}` : ''}`
    );
    return { estado: 'sent', messageId };
  } catch (error) {
    const esTimeout = error instanceof Error && error.name === 'AbortError';
    const errorResumen = esTimeout ? 'timeout' : error instanceof Error ? error.message : 'error desconocido';
    console.log(
      `[EMAIL] Enlace de cotización generado correctamente, pero falló su envío (destino=${destinoEnmascarado}): ${errorResumen}`
    );
    return { estado: 'failed', error: errorResumen };
  } finally {
    clearTimeout(timeoutId);
  }
}

// =======================================================================
// Recuperación del código de acceso — "Implementación Fase 1: Recuperación
// segura del código de cotización" (autorización explícita). Dos
// funciones completamente independientes entre sí y de las dos de arriba
// — contenido distinto, nunca comparten plantilla. Ninguna de las dos
// imprime jamás el código/OTP en texto plano en ningún log — solo el
// email enmascarado y el resultado (éxito/fallo), igual que el resto de
// este archivo.
// =======================================================================

export interface CodigoTemporalCotizacionInput {
  destinatarioEmail: string;
  destinatarioNombre: string;
  solicitudCodigo: string | null;
  // COT-XXXXXX; NULL en cotizaciones históricas sin código.
  cotizacionCodigo: string | null;
  // Código temporal de verificación (OTP) de 6 dígitos — NUNCA el código
  // de acceso real de la cotización. Esta función nunca debe usarse para
  // enviar ese otro código (ver enviarCodigoAccesoRegenerado, abajo).
  otp: string;
}

// Aclaración funcional (autorización explícita): la recuperación asistida
// se realiza EXCLUSIVAMENTE mediante el botón de WhatsApp ya existente —
// se reutiliza `construirEnlaceWhatsApp()` (mismo número oficial ya
// configurado, sin inventar ninguno) con un mensaje predefinido genérico,
// que nunca incluye el OTP, el código de acceso ni ningún token.
// Se identifica la cotización por su código propio (COT-XXXXXX), distinto del número de solicitud;
// las históricas sin código caen al número de solicitud. Son identificadores legibles, no secretos
// (nunca se incluye el código de acceso, el OTP ni el token).
function construirMensajeWhatsAppAyudaCotizacion(ref: {
  cotizacionCodigo: string | null;
  solicitudCodigo: string | null;
}): string {
  const base = 'Hola, necesito ayuda con el acceso a mi cotización';
  if (ref.cotizacionCodigo) return `${base} ${ref.cotizacionCodigo}.`;
  if (ref.solicitudCodigo) return `${base} de la solicitud ${ref.solicitudCodigo}.`;
  return `${base}.`;
}

function construirContenidoCorreoOtp(
  input: CodigoTemporalCotizacionInput
): { asunto: string; html: string; texto: string } {
  const referencia = construirReferenciaCotizacion(input);
  const asunto = `${env.nextProjectName} — Código temporal de verificación${referencia}`;
  const enlaceWhatsApp = construirEnlaceWhatsApp(construirMensajeWhatsAppAyudaCotizacion(input));

  const texto = [
    `Hola ${input.destinatarioNombre}.`,
    '',
    `Recibimos una solicitud para recuperar el acceso a tu cotización de ${env.nextProjectName}${referencia}.`,
    '',
    'Usa este código temporal para verificar tu correo (válido por 10 minutos, un solo uso):',
    input.otp,
    '',
    'Si tú no solicitaste esto, puedes ignorar este mensaje con confianza: nadie podrá acceder sin este código.',
    '',
    '¿Necesitas ayuda? Contáctanos por WhatsApp:',
    enlaceWhatsApp,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;padding:32px 24px;border-radius:4px;">
      <p style="margin:0 0 16px;">Hola ${escaparHtml(input.destinatarioNombre)}.</p>
      <p style="margin:0 0 16px;">Recibimos una solicitud para recuperar el acceso a tu cotización de ${escaparHtml(env.nextProjectName)}${escaparHtml(referencia)}.</p>
      <p style="margin:0 0 4px;">Código temporal (válido 10 minutos, un solo uso):</p>
      <p style="margin:0 0 16px;font-size:24px;font-weight:bold;letter-spacing:2px;">${escaparHtml(input.otp)}</p>
      <p style="margin:0 0 24px;">Si tú no solicitaste esto, puedes ignorar este mensaje con confianza.</p>
      <p style="text-align:center;margin:0;">
        <a href="${enlaceWhatsApp}" style="display:inline-block;background:#d4a017;color:#1a1a1a;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:bold;">¿NECESITAS AYUDA? ESCRÍBENOS POR WHATSAPP</a>
      </p>
    </div>
  </body>
</html>`;

  return { asunto, html, texto };
}

// Se llama desde cotizaciones.service.ts::solicitarRecuperacionCodigo(),
// ANTES de persistir el OTP en memoria (el llamador solo lo persiste si
// esta función resuelve 'sent' — ver esa función para el orden exacto).
// SIEMPRE resuelve, nunca lanza — mismo criterio que el resto de este
// archivo.
export async function enviarCodigoTemporalCotizacion(
  input: CodigoTemporalCotizacionInput
): Promise<ResultadoEnvioCorreo> {
  if (!env.brevoApiKey || !env.nextProjectEmail) {
    const motivo =
      !env.brevoApiKey && !env.nextProjectEmail
        ? 'BREVO_API_KEY y NEXT_PROJECT_EMAIL no configurados'
        : !env.brevoApiKey
          ? 'BREVO_API_KEY no configurado'
          : 'NEXT_PROJECT_EMAIL no configurado';
    console.log(`[EMAIL] Código temporal de recuperación: envío desactivado (${motivo}).`);
    return { estado: 'skipped', motivo };
  }

  const { asunto, html, texto } = construirContenidoCorreoOtp(input);
  const destinoEnmascarado = enmascararEmail(input.destinatarioEmail);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);
  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': env.brevoApiKey,
        ...(env.brevoSandbox ? { 'X-Sib-Sandbox': 'drop' } : {}),
      },
      body: JSON.stringify({
        sender: { name: env.nextProjectName, email: env.nextProjectEmail },
        to: [{ email: input.destinatarioEmail, name: input.destinatarioNombre }],
        subject: asunto,
        htmlContent: html,
        textContent: texto,
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as { messageId?: unknown; message?: unknown } | null;

    if (!response.ok) {
      const errorResumen = typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`;
      console.log(`[EMAIL] Código temporal de recuperación: falló su envío (destino=${destinoEnmascarado}): ${errorResumen}`);
      return { estado: 'failed', error: errorResumen };
    }

    const messageId = typeof data?.messageId === 'string' ? data.messageId : undefined;
    console.log(
      `[EMAIL] Código temporal de recuperación enviado correctamente (destino=${destinoEnmascarado}).${messageId ? ` messageId=${messageId}` : ''}`
    );
    return { estado: 'sent', messageId };
  } catch (error) {
    const esTimeout = error instanceof Error && error.name === 'AbortError';
    const errorResumen = esTimeout ? 'timeout' : error instanceof Error ? error.message : 'error desconocido';
    console.log(`[EMAIL] Código temporal de recuperación: falló su envío (destino=${destinoEnmascarado}): ${errorResumen}`);
    return { estado: 'failed', error: errorResumen };
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface CodigoAccesoRegeneradoInput {
  destinatarioEmail: string;
  destinatarioNombre: string;
  solicitudCodigo: string | null;
  // COT-XXXXXX; NULL en cotizaciones históricas sin código.
  cotizacionCodigo: string | null;
  // Código de acceso REAL regenerado (6 dígitos) — NUNCA el OTP temporal.
  codigo: string;
}

function construirContenidoCorreoCodigoRegenerado(
  input: CodigoAccesoRegeneradoInput
): { asunto: string; html: string; texto: string } {
  const referencia = construirReferenciaCotizacion(input);
  const asunto = `${env.nextProjectName} — Tu nuevo código de acceso${referencia}`;
  const enlaceWhatsApp = construirEnlaceWhatsApp(construirMensajeWhatsAppAyudaCotizacion(input));

  const texto = [
    `Hola ${input.destinatarioNombre}.`,
    '',
    `Verificamos correctamente tu correo y generamos un nuevo código de acceso para tu cotización de ${env.nextProjectName}${referencia}.`,
    '',
    'Tu nuevo código de acceso (reemplaza al anterior):',
    input.codigo,
    '',
    'Úsalo junto con el mismo enlace que ya tienes para continuar con tu cotización.',
    '',
    '¿Necesitas ayuda? Contáctanos por WhatsApp:',
    enlaceWhatsApp,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;padding:32px 24px;border-radius:4px;">
      <p style="margin:0 0 16px;">Hola ${escaparHtml(input.destinatarioNombre)}.</p>
      <p style="margin:0 0 16px;">Verificamos correctamente tu correo y generamos un nuevo código de acceso para tu cotización de ${escaparHtml(env.nextProjectName)}${escaparHtml(referencia)}.</p>
      <p style="margin:0 0 4px;">Tu nuevo código de acceso (reemplaza al anterior):</p>
      <p style="margin:0 0 16px;font-size:24px;font-weight:bold;letter-spacing:2px;">${escaparHtml(input.codigo)}</p>
      <p style="margin:0 0 24px;">Úsalo junto con el mismo enlace que ya tienes para continuar con tu cotización.</p>
      <p style="text-align:center;margin:0;">
        <a href="${enlaceWhatsApp}" style="display:inline-block;background:#d4a017;color:#1a1a1a;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:bold;">¿NECESITAS AYUDA? ESCRÍBENOS POR WHATSAPP</a>
      </p>
    </div>
  </body>
</html>`;

  return { asunto, html, texto };
}

// Se llama desde cotizaciones.service.ts::verificarRecuperacionCodigo(),
// DESPUÉS de confirmar el OTP y ANTES de persistir el nuevo hash en
// PostgreSQL (el llamador solo llama a guardarCodigoAcceso() si esta
// función resuelve 'sent' — ver esa función para el orden exacto, pensado
// para nunca dejar al cliente sin ningún código funcional). SIEMPRE
// resuelve, nunca lanza.
export async function enviarCodigoAccesoRegenerado(
  input: CodigoAccesoRegeneradoInput
): Promise<ResultadoEnvioCorreo> {
  if (!env.brevoApiKey || !env.nextProjectEmail) {
    const motivo =
      !env.brevoApiKey && !env.nextProjectEmail
        ? 'BREVO_API_KEY y NEXT_PROJECT_EMAIL no configurados'
        : !env.brevoApiKey
          ? 'BREVO_API_KEY no configurado'
          : 'NEXT_PROJECT_EMAIL no configurado';
    console.log(`[EMAIL] Código de acceso regenerado: envío desactivado (${motivo}).`);
    return { estado: 'skipped', motivo };
  }

  const { asunto, html, texto } = construirContenidoCorreoCodigoRegenerado(input);
  const destinoEnmascarado = enmascararEmail(input.destinatarioEmail);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);
  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': env.brevoApiKey,
        ...(env.brevoSandbox ? { 'X-Sib-Sandbox': 'drop' } : {}),
      },
      body: JSON.stringify({
        sender: { name: env.nextProjectName, email: env.nextProjectEmail },
        to: [{ email: input.destinatarioEmail, name: input.destinatarioNombre }],
        subject: asunto,
        htmlContent: html,
        textContent: texto,
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as { messageId?: unknown; message?: unknown } | null;

    if (!response.ok) {
      const errorResumen = typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`;
      console.log(`[EMAIL] Código de acceso regenerado: falló su envío (destino=${destinoEnmascarado}): ${errorResumen}`);
      return { estado: 'failed', error: errorResumen };
    }

    const messageId = typeof data?.messageId === 'string' ? data.messageId : undefined;
    console.log(
      `[EMAIL] Código de acceso regenerado enviado correctamente (destino=${destinoEnmascarado}).${messageId ? ` messageId=${messageId}` : ''}`
    );
    return { estado: 'sent', messageId };
  } catch (error) {
    const esTimeout = error instanceof Error && error.name === 'AbortError';
    const errorResumen = esTimeout ? 'timeout' : error instanceof Error ? error.message : 'error desconocido';
    console.log(`[EMAIL] Código de acceso regenerado: falló su envío (destino=${destinoEnmascarado}): ${errorResumen}`);
    return { estado: 'failed', error: errorResumen };
  } finally {
    clearTimeout(timeoutId);
  }
}

// SOLICITUD-RECUPERACION-01B (autorización explícita): se llama SIEMPRE
// DESPUÉS del COMMIT real de crearSolicitud() (ver solicitudes.controller.ts)
// — nunca dentro de la transacción de PostgreSQL. Esta función SIEMPRE
// resuelve (nunca rechaza/lanza): cualquier fallo de Brevo, de red o de
// configuración se captura internamente y se traduce a un resultado
// tipado — el llamador nunca necesita un try/catch para que la respuesta
// 201 de la solicitud quede a salvo de un fallo de correo.
export async function enviarConfirmacionSolicitud(input: ConfirmacionSolicitudInput): Promise<ResultadoEnvioCorreo> {
  if (!env.brevoApiKey || !env.nextProjectEmail) {
    const motivo =
      !env.brevoApiKey && !env.nextProjectEmail
        ? 'BREVO_API_KEY y NEXT_PROJECT_EMAIL no configurados'
        : !env.brevoApiKey
          ? 'BREVO_API_KEY no configurado'
          : 'NEXT_PROJECT_EMAIL no configurado';
    console.log(
      `[EMAIL] Solicitud ${input.solicitudCodigo} registrada correctamente, pero el envío de confirmación está desactivado (${motivo}).`
    );
    return { estado: 'skipped', motivo };
  }

  const { asunto, html, texto } = construirContenidoCorreo(input);
  const destinoEnmascarado = enmascararEmail(input.destinatarioEmail);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);
  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': env.brevoApiKey,
        // Mecanismo oficial de sandbox de Brevo — ver BREVO_SANDBOX en
        // config/env.ts: solo presente cuando se pide explícitamente validar
        // la integración sin entregar el correo real.
        ...(env.brevoSandbox ? { 'X-Sib-Sandbox': 'drop' } : {}),
      },
      body: JSON.stringify({
        sender: { name: env.nextProjectName, email: env.nextProjectEmail },
        to: [{ email: input.destinatarioEmail, name: input.destinatarioNombre }],
        subject: asunto,
        htmlContent: html,
        textContent: texto,
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as { messageId?: unknown; message?: unknown } | null;

    if (!response.ok) {
      const errorResumen = typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`;
      console.log(
        `[EMAIL] Solicitud ${input.solicitudCodigo} registrada correctamente, pero falló el envío de confirmación (destino=${destinoEnmascarado}): ${errorResumen}`
      );
      return { estado: 'failed', error: errorResumen };
    }

    const messageId = typeof data?.messageId === 'string' ? data.messageId : undefined;
    console.log(
      `[EMAIL] Solicitud ${input.solicitudCodigo} enviada correctamente (destino=${destinoEnmascarado}).${messageId ? ` messageId=${messageId}` : ''}`
    );
    return { estado: 'sent', messageId };
  } catch (error) {
    const esTimeout = error instanceof Error && error.name === 'AbortError';
    const errorResumen = esTimeout ? 'timeout' : error instanceof Error ? error.message : 'error desconocido';
    console.log(
      `[EMAIL] Solicitud ${input.solicitudCodigo} registrada correctamente, pero falló el envío de confirmación (destino=${destinoEnmascarado}): ${errorResumen}`
    );
    return { estado: 'failed', error: errorResumen };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Fase 2C (cambio de contraseña): aviso al usuario de que su contraseña fue cambiada. NO incluye
// ninguna contraseña, token ni enlace. SIEMPRE resuelve (nunca lanza): si Brevo falla o no está
// configurado, el cambio de contraseña ya realizado no se revierte.
export interface AvisoCambioPasswordInput {
  destinatarioNombre: string;
  destinatarioEmail: string;
}

export async function enviarAvisoCambioPassword(input: AvisoCambioPasswordInput): Promise<ResultadoEnvioCorreo> {
  if (!env.brevoApiKey || !env.nextProjectEmail) {
    const motivo =
      !env.brevoApiKey && !env.nextProjectEmail
        ? 'BREVO_API_KEY y NEXT_PROJECT_EMAIL no configurados'
        : !env.brevoApiKey
          ? 'BREVO_API_KEY no configurado'
          : 'NEXT_PROJECT_EMAIL no configurado';
    console.log(`[EMAIL] Aviso de cambio de contraseña: envío desactivado (${motivo}).`);
    return { estado: 'skipped', motivo };
  }

  const asunto = `Tu contraseña de ${env.nextProjectName} fue cambiada`;
  const texto = [
    `Hola ${input.destinatarioNombre}.`,
    '',
    `La contraseña de tu cuenta en ${env.nextProjectName} acaba de ser cambiada y las demás sesiones abiertas se cerraron.`,
    'Si fuiste tú, no necesitas hacer nada.',
    'Si no reconoces este cambio, avisa de inmediato a un administrador de NextProject.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;padding:32px 24px;border-radius:4px;">
      <p style="margin:0 0 16px;">Hola ${escaparHtml(input.destinatarioNombre)}.</p>
      <p style="margin:0 0 16px;">La contraseña de tu cuenta en ${escaparHtml(env.nextProjectName)} acaba de ser cambiada y las demás sesiones abiertas se cerraron.</p>
      <p style="margin:0 0 16px;">Si fuiste tú, no necesitas hacer nada.</p>
      <p style="margin:0;"><strong>Si no reconoces este cambio, avisa de inmediato a un administrador de NextProject.</strong></p>
    </div>
  </body>
</html>`;
  const destinoEnmascarado = enmascararEmail(input.destinatarioEmail);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);
  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': env.brevoApiKey,
        ...(env.brevoSandbox ? { 'X-Sib-Sandbox': 'drop' } : {}),
      },
      body: JSON.stringify({
        sender: { name: env.nextProjectName, email: env.nextProjectEmail },
        to: [{ email: input.destinatarioEmail, name: input.destinatarioNombre }],
        subject: asunto,
        htmlContent: html,
        textContent: texto,
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as { messageId?: unknown; message?: unknown } | null;

    if (!response.ok) {
      const errorResumen = typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`;
      console.log(`[EMAIL] Aviso de cambio de contraseña: falló su envío (destino=${destinoEnmascarado}): ${errorResumen}`);
      return { estado: 'failed', error: errorResumen };
    }

    const messageId = typeof data?.messageId === 'string' ? data.messageId : undefined;
    console.log(`[EMAIL] Aviso de cambio de contraseña enviado (destino=${destinoEnmascarado}).`);
    return { estado: 'sent', messageId };
  } catch (error) {
    const esTimeout = error instanceof Error && error.name === 'AbortError';
    const errorResumen = esTimeout ? 'timeout' : error instanceof Error ? error.message : 'error desconocido';
    console.log(`[EMAIL] Aviso de cambio de contraseña: falló su envío (destino=${destinoEnmascarado}): ${errorResumen}`);
    return { estado: 'failed', error: errorResumen };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------
// Avisos de pago al cliente (anticipo / saldo): comprobante rechazado y pago confirmado.
// Se envían DESPUÉS de que el cambio de estado ya quedó confirmado en la BD; un fallo de envío nunca
// revierte ese estado (ver cotizaciones.controller.ts::notificarCliente). Nunca incluyen el código de
// acceso, el OTP, el token ni importes.
// ---------------------------------------------------------------------

export type TipoPagoAviso = 'ANTICIPO' | 'SALDO';

interface AvisoPagoBase {
  destinatarioEmail: string;
  destinatarioNombre: string;
  solicitudCodigo: string | null;
  cotizacionCodigo: string | null;
  tipoPago: TipoPagoAviso;
}

export interface ComprobanteRechazadoInput extends AvisoPagoBase {
  motivo: string;
  detalle: string | null;
}

export type PagoConfirmadoInput = AvisoPagoBase;

const ETIQUETA_PAGO: Record<TipoPagoAviso, string> = { ANTICIPO: 'anticipo', SALDO: 'saldo' };

// Catálogo cerrado de motivos de rechazo (transferenciasPago.service.ts::MOTIVOS_RECHAZO).
const TEXTO_MOTIVO_RECHAZO: Record<string, string> = {
  COMPROBANTE_INCORRECTO: 'El comprobante no corresponde a este pago.',
  IMPORTE_INCORRECTO: 'El importe del comprobante no coincide con el valor a pagar.',
  COMPROBANTE_ILEGIBLE: 'El comprobante no se puede leer con claridad.',
};

export function textoMotivoRechazo(motivo: string, detalle: string | null): string {
  if (motivo === 'OTRO') return detalle?.trim() || 'Otro motivo; contacta a tu asesor para más detalle.';
  return TEXTO_MOTIVO_RECHAZO[motivo] ?? 'El comprobante no pudo ser aceptado.';
}

interface ContenidoCorreo {
  asunto: string;
  html: string;
  texto: string;
}

function referenciaAviso(input: AvisoPagoBase): { referencia: string; cotizacionDe: string } {
  const referencia = construirReferenciaCotizacion(input);
  const codigo = input.cotizacionCodigo ?? input.solicitudCodigo;
  return { referencia, cotizacionDe: codigo ? ` ${codigo}` : '' };
}

function construirContenidoComprobanteRechazado(input: ComprobanteRechazadoInput): ContenidoCorreo {
  const { referencia, cotizacionDe } = referenciaAviso(input);
  const pago = ETIQUETA_PAGO[input.tipoPago];
  const motivo = textoMotivoRechazo(input.motivo, input.detalle);
  const enlaceWhatsApp = construirEnlaceWhatsApp(construirMensajeWhatsAppAyudaCotizacion(input));
  const asunto = `${env.nextProjectName} — Revisa tu comprobante de ${pago}${referencia}`;

  const texto = [
    `Hola ${input.destinatarioNombre}.`,
    '',
    `No pudimos aceptar el comprobante de tu ${pago} de la cotización${cotizacionDe}.`,
    '',
    'Motivo:',
    motivo,
    '',
    'Para corregirlo, ingresa de nuevo a tu enlace de cotización con el código de seguridad de 6 dígitos y vuelve a subir un comprobante correcto en la sección de ' + pago + '.',
    '',
    '¿Necesitas ayuda? Contáctanos por WhatsApp:',
    enlaceWhatsApp,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;padding:32px 24px;border-radius:4px;">
      <p style="margin:0 0 16px;">Hola ${escaparHtml(input.destinatarioNombre)}.</p>
      <p style="margin:0 0 16px;">No pudimos aceptar el comprobante de tu ${pago} de la cotización${escaparHtml(cotizacionDe)}.</p>
      <p style="margin:0 0 4px;">Motivo:</p>
      <p style="margin:0 0 16px;font-weight:bold;">${escaparHtml(motivo)}</p>
      <p style="margin:0 0 24px;">Para corregirlo, ingresa de nuevo a tu enlace de cotización con el código de seguridad de 6 dígitos y vuelve a subir un comprobante correcto en la sección de ${pago}.</p>
      <p style="text-align:center;margin:0;">
        <a href="${enlaceWhatsApp}" style="display:inline-block;background:#d4a017;color:#1a1a1a;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:bold;">¿NECESITAS AYUDA? ESCRÍBENOS POR WHATSAPP</a>
      </p>
    </div>
  </body>
</html>`;

  return { asunto, html, texto };
}

function construirContenidoPagoConfirmado(input: PagoConfirmadoInput): ContenidoCorreo {
  const { referencia, cotizacionDe } = referenciaAviso(input);
  const pago = ETIQUETA_PAGO[input.tipoPago];
  const enlaceWhatsApp = construirEnlaceWhatsApp(construirMensajeWhatsAppAyudaCotizacion(input));
  const asunto = `${env.nextProjectName} — Confirmamos tu ${pago}${referencia}`;

  const texto = [
    `Hola ${input.destinatarioNombre}.`,
    '',
    `Confirmamos que el pago de tu ${pago} de la cotización${cotizacionDe} ya fue acreditado en nuestra cuenta.`,
    '',
    'Puedes consultar el estado de tu cotización en cualquier momento desde tu enlace con el código de seguridad de 6 dígitos.',
    '',
    '¿Necesitas ayuda? Contáctanos por WhatsApp:',
    enlaceWhatsApp,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;padding:32px 24px;border-radius:4px;">
      <p style="margin:0 0 16px;">Hola ${escaparHtml(input.destinatarioNombre)}.</p>
      <p style="margin:0 0 16px;">Confirmamos que el pago de tu ${pago} de la cotización${escaparHtml(cotizacionDe)} ya fue acreditado en nuestra cuenta.</p>
      <p style="margin:0 0 24px;">Puedes consultar el estado de tu cotización en cualquier momento desde tu enlace con el código de seguridad de 6 dígitos.</p>
      <p style="text-align:center;margin:0;">
        <a href="${enlaceWhatsApp}" style="display:inline-block;background:#d4a017;color:#1a1a1a;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:bold;">¿NECESITAS AYUDA? ESCRÍBENOS POR WHATSAPP</a>
      </p>
    </div>
  </body>
</html>`;

  return { asunto, html, texto };
}

// Envío común de los avisos de pago. SIEMPRE resuelve (nunca lanza), un solo intento.
async function enviarAvisoPago(
  etiqueta: string,
  input: AvisoPagoBase,
  contenido: ContenidoCorreo
): Promise<ResultadoEnvioCorreo> {
  if (!env.brevoApiKey || !env.nextProjectEmail) {
    const motivo =
      !env.brevoApiKey && !env.nextProjectEmail
        ? 'BREVO_API_KEY y NEXT_PROJECT_EMAIL no configurados'
        : !env.brevoApiKey
          ? 'BREVO_API_KEY no configurado'
          : 'NEXT_PROJECT_EMAIL no configurado';
    console.log(`[EMAIL] ${etiqueta}: envío desactivado (${motivo}).`);
    return { estado: 'skipped', motivo };
  }

  const destinoEnmascarado = enmascararEmail(input.destinatarioEmail);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);
  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': env.brevoApiKey,
        ...(env.brevoSandbox ? { 'X-Sib-Sandbox': 'drop' } : {}),
      },
      body: JSON.stringify({
        sender: { name: env.nextProjectName, email: env.nextProjectEmail },
        to: [{ email: input.destinatarioEmail, name: input.destinatarioNombre }],
        subject: contenido.asunto,
        htmlContent: contenido.html,
        textContent: contenido.texto,
      }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as { messageId?: unknown; message?: unknown } | null;

    if (!response.ok) {
      const errorResumen = typeof data?.message === 'string' ? data.message : `HTTP ${response.status}`;
      console.log(`[EMAIL] ${etiqueta}: falló su envío (destino=${destinoEnmascarado}): ${errorResumen}`);
      return { estado: 'failed', error: errorResumen };
    }

    const messageId = typeof data?.messageId === 'string' ? data.messageId : undefined;
    console.log(`[EMAIL] ${etiqueta} enviado correctamente (destino=${destinoEnmascarado}).`);
    return { estado: 'sent', messageId };
  } catch (error) {
    const esTimeout = error instanceof Error && error.name === 'AbortError';
    const errorResumen = esTimeout ? 'timeout' : error instanceof Error ? error.message : 'error desconocido';
    console.log(`[EMAIL] ${etiqueta}: falló su envío (destino=${destinoEnmascarado}): ${errorResumen}`);
    return { estado: 'failed', error: errorResumen };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function enviarComprobanteRechazado(input: ComprobanteRechazadoInput): Promise<ResultadoEnvioCorreo> {
  return enviarAvisoPago('Comprobante rechazado', input, construirContenidoComprobanteRechazado(input));
}

export async function enviarPagoConfirmado(input: PagoConfirmadoInput): Promise<ResultadoEnvioCorreo> {
  return enviarAvisoPago('Pago confirmado', input, construirContenidoPagoConfirmado(input));
}
