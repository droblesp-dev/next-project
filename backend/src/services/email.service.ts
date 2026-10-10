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
