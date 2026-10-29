import "dotenv/config";

function parseTrustProxy(valor: string | undefined): boolean | number | string | undefined {
  const v = (valor ?? "").trim();
  if (!v) return undefined;
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

// FRONTEND_URL es opcional: un valor vacío o un macro de Azure sin resolver ("$(PROD_FRONTEND_URL)")
// cuenta como no definido.
function parseUrlOpcional(valor: string | undefined): string {
  const v = (valor ?? "").trim();
  return !v || v.startsWith("$(") ? "" : v.replace(/\/+$/, "");
}

export const env = {
  port: Number(process.env.PORT) || 3000,
  corsOrigins: (
    process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:5173"
  )
    .split(",")
    .map((origen) => origen.trim())
    .filter((origen) => origen.length > 0),
  // TRUST_PROXY: número de saltos de proxy ("1"), "true"/"false" o una lista de IP/subredes
  // de Express. Sin definir: undefined (no se toca la configuración por defecto de Express).
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  // URL pública del frontend (para los enlaces de los correos). Sin definir, se usa el primer
  // origen de CORS_ORIGINS.
  frontendUrl: parseUrlOpcional(process.env.FRONTEND_URL),
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: (process.env.DB_SSL ?? "").trim().toLowerCase() === "true",
  },
  jwtSecret: process.env.JWT_SECRET ?? "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  cotizacionLinkSecret: process.env.COTIZACION_LINK_SECRET ?? "",
  leadLinkSecret: process.env.LEAD_LINK_SECRET ?? "",
  operativoPorDefectoEmail: (
    process.env.OPERATIVO_POR_DEFECTO_EMAIL ?? ""
  ).trim(),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterModel:
    process.env.OPENROUTER_MODEL ?? "cohere/north-mini-code:free",
  // Salvaguarda contra correos reales accidentales: bajo Vitest (VITEST=true) la clave de Brevo se ignora y el
  // sandbox queda activo aunque el .env local tenga una clave real y BREVO_SANDBOX=false. Los tests de correo
  // simulan `env` y `fetch`; ninguna prueba debe llegar a la API real.
  brevoApiKey: process.env.VITEST === "true" ? "" : (process.env.BREVO_API_KEY ?? "").trim(),
  nextProjectEmail: (process.env.NEXT_PROJECT_EMAIL ?? "").trim(),
  brevoSandbox:
    process.env.VITEST === "true" ||
    (process.env.BREVO_SANDBOX ?? "").trim().toLowerCase() === "true",
  nextProjectName: (process.env.NEXT_PROJECT_NAME ?? "NextProject").trim(),
  nextProjectWhatsapp: (
    process.env.NEXT_PROJECT_WHATSAPP ?? "593939067666"
  ).trim(),
  datosBancarios: {
    banco: process.env.BANCO_NOMBRE || null,
    tipoCuenta: process.env.BANCO_TIPO_CUENTA || null,
    numeroCuenta: process.env.BANCO_NUMERO_CUENTA || null,
    titular: process.env.BANCO_TITULAR || null,
    ruc: process.env.BANCO_RUC || null,
  },
};

if (!env.jwtSecret) {
  throw new Error("JWT_SECRET no está definido en las variables de entorno.");
}

if (!env.cotizacionLinkSecret) {
  throw new Error(
    "COTIZACION_LINK_SECRET no está definido en las variables de entorno.",
  );
}

if (!env.leadLinkSecret) {
  throw new Error(
    "LEAD_LINK_SECRET no está definido en las variables de entorno.",
  );
}
