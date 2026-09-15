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
  // A diferencia de JWT_SECRET, la ausencia de GEMINI_API_KEY NO impide que
  // el backend arranque: la IA es un módulo asistente (CLAUDE.md §17), no
  // parte del núcleo de autenticación. Su ausencia se maneja en el momento
  // de generar un análisis, dejándolo en estado ERROR.
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
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
