import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT) || 3000,
  // Origenes permitidos para CORS, separados por coma en CORS_ORIGINS. Sin
  // esa variable, se usan los puertos de desarrollo del propio proyecto.
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((origen) => origen.trim())
    .filter((origen) => origen.length > 0),
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  // Secreto independiente de jwtSecret: firma exclusivamente los tokens de
  // enlace público de cotizaciones (vista de cliente sin login). No debe
  // reutilizarse para sesiones internas ni exponerse al frontend.
  cotizacionLinkSecret: process.env.COTIZACION_LINK_SECRET ?? '',
  // Secreto independiente de jwtSecret y de cotizacionLinkSecret: firma
  // exclusivamente los enlaces de solicitud de un lead TIBIO. Un token de
  // cotización nunca verifica contra este secreto (y viceversa).
  leadLinkSecret: process.env.LEAD_LINK_SECRET ?? '',
  // Correo del OPERATIVO responsable por defecto de las órdenes nuevas (Bloque
  // 1). A diferencia de los secretos, su ausencia NO impide arrancar el
  // backend: se valida al crear cada orden (existe, activo, rol OPERATIVO) y,
  // si no es válido, la orden no se crea. Coincidencia exacta con usuarios.email.
  operativoPorDefectoEmail: (process.env.OPERATIVO_POR_DEFECTO_EMAIL ?? '').trim(),
  // A diferencia de JWT_SECRET, la ausencia de GEMINI_API_KEY NO impide que
  // el backend arranque: la IA es un módulo asistente (CLAUDE.md §17), no
  // parte del núcleo de autenticación. Su ausencia se maneja en el momento
  // de generar un análisis, dejándolo en estado ERROR.
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
  // SOLICITUD-RECUPERACION-01B (autorización explícita): correo
  // transaccional de confirmación vía Brevo (API HTTP directa, sin SDK —
  // ver services/email.service.ts). Mismo principio que geminiApiKey: su
  // ausencia NO impide arrancar el backend — el envío de correo es un
  // complemento DESPUÉS del COMMIT de la solicitud, nunca un requisito para
  // crearla (CLAUDE.md §17: un módulo asistente nunca bloquea el flujo
  // principal). NEXT_PROJECT_EMAIL es el remitente real que debe estar
  // configurado y VERIFICADO en Brevo — nunca se inventa un valor; mientras
  // falte (junto con BREVO_API_KEY), el envío queda en estado "skipped"
  // (ver email.service.ts), sin romper nada.
  brevoApiKey: (process.env.BREVO_API_KEY ?? '').trim(),
  nextProjectEmail: (process.env.NEXT_PROJECT_EMAIL ?? '').trim(),
  // Validado como venía desde BREVO_SANDBOX: solo agrega el header
  // `X-Sib-Sandbox: drop` (mecanismo oficial de Brevo para aceptar la
  // petición sin enviar el correo real) — exclusivamente para validar la
  // integración antes de un envío real, nunca para uso en producción.
  brevoSandbox: (process.env.BREVO_SANDBOX ?? '').trim().toLowerCase() === 'true',
  // Mismo nombre/número ya centralizados en el frontend
  // (frontend/src/lib/config.ts, SOLICITUD-RECUPERACION-01A) — el backend
  // necesita su propia copia porque corre en un proceso/runtime distinto
  // (no puede importar un módulo del frontend). Mismos valores por defecto
  // ya verificados y en uso en todo el proyecto, nunca inventados.
  nextProjectName: (process.env.NEXT_PROJECT_NAME ?? 'NextProject').trim(),
  nextProjectWhatsapp: (process.env.NEXT_PROJECT_WHATSAPP ?? '593939067666').trim(),
  // Datos bancarios para el flujo de anticipo por transferencia (Fase D).
  // Opcionales a proposito: mientras no se configuren, el backend debe
  // mostrar un aviso generico en lugar de datos bancarios — nunca inventar
  // valores ni bloquear el arranque del servidor por su ausencia.
  datosBancarios: {
    banco: process.env.BANCO_NOMBRE || null,
    tipoCuenta: process.env.BANCO_TIPO_CUENTA || null,
    numeroCuenta: process.env.BANCO_NUMERO_CUENTA || null,
    titular: process.env.BANCO_TITULAR || null,
    ruc: process.env.BANCO_RUC || null,
  },
};

if (!env.jwtSecret) {
  throw new Error('JWT_SECRET no está definido en las variables de entorno.');
}

if (!env.cotizacionLinkSecret) {
  throw new Error('COTIZACION_LINK_SECRET no está definido en las variables de entorno.');
}

if (!env.leadLinkSecret) {
  throw new Error('LEAD_LINK_SECRET no está definido en las variables de entorno.');
}
