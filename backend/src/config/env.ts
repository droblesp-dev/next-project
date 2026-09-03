import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  // A diferencia de JWT_SECRET, la ausencia de GEMINI_API_KEY NO impide que
  // el backend arranque: la IA es un módulo asistente (CLAUDE.md §17), no
  // parte del núcleo de autenticación. Su ausencia se maneja en el momento
  // de generar un análisis, dejándolo en estado ERROR.
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
};

if (!env.jwtSecret) {
  throw new Error('JWT_SECRET no está definido en las variables de entorno.');
}
