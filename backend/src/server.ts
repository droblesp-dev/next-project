import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { registrarEventoSeguridad } from './services/securityLog.js';
import { env } from './config/env.js';
import { checkDatabaseConnection } from './config/db.js';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './config/openapi.js';
import { authRouter } from './routes/auth.routes.js';
import { usuariosRouter } from './routes/usuarios.routes.js';
import { clientesRouter } from './routes/clientes.routes.js';
import { busquedaRouter } from './routes/busqueda.routes.js';
import { solicitudesRouter } from './routes/solicitudes.routes.js';
import { cotizacionesRouter } from './routes/cotizaciones.routes.js';
import { ordenesRouter } from './routes/ordenes.routes.js';
import { analisisIaRouter } from './routes/analisisIa.routes.js';
import { leadsRouter } from './routes/leads.routes.js';
import { alertasRouter } from './routes/alertas.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';
import { asistenteFormularioRouter } from './routes/asistenteFormulario.routes.js';
import { cuentasBancariasRouter } from './routes/cuentasBancarias.routes.js';
import { LOGOS_BANCOS_DIR } from './config/uploadsLogosBancos.js';
import { advertenciaCorreoReal } from './config/advertenciaCorreo.js';

const app = express();

// Detrás de un proxy/balanceador req.ip sería la IP del proxy y los límites por IP
// (login, NexIA) compartirían un único contador. TRUST_PROXY (.env) lo declara
// explícitamente; sin definir se conserva el comportamiento anterior (sin proxy).
if (env.trustProxy !== undefined) {
  app.set('trust proxy', env.trustProxy);
}

// Cabeceras de seguridad (OWASP A05). La API solo sirve JSON y los logos de bancos, así que
// el CSP por defecto de helmet aplica sin cambios; se excluye /api-docs (Swagger UI, solo
// fuera de producción) porque necesita scripts en línea. Los logos se cargan desde el
// origen del frontend, por eso CORP queda en 'cross-origin'.
const helmetApi = helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } });
app.use((req, res, next) => (req.path.startsWith('/api-docs') ? next() : helmetApi(req, res, next)));

// CORS mínimo, sin dependencias nuevas: orígenes permitidos configurados en
// CORS_ORIGINS (.env), no hardcodeados. Sin '*'. No afecta la lógica de
// requireAuth/requireRole.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    // SOLICITUD-RECUPERACION-01A (autorización explícita): se agrega
    // 'Idempotency-Key' — sin esto, el navegador bloquea la petición real en
    // el preflight (OPTIONS) de CORS antes de que llegue al backend
    // (confirmado con una prueba real: "Failed to fetch" en el frontend
    // pese a que el backend nunca llegaba a recibir la petición).
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Idempotency-Key');
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'NextProject backend está activo',
  });
});

// Documentación Swagger de los endpoints documentados; no se expone en producción.
if (process.env.NODE_ENV !== 'production') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec as unknown as Record<string, unknown>));
}

app.use('/api/auth', authRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/clientes', clientesRouter);
app.use('/api/busqueda', busquedaRouter);
app.use('/api/solicitudes', solicitudesRouter);
app.use('/api/cotizaciones', cotizacionesRouter);
app.use('/api/ordenes', ordenesRouter);
app.use('/api/analisis-ia', analisisIaRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/alertas', alertasRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/asistente-formulario', asistenteFormularioRouter);
app.use('/api/cuentas-bancarias', cuentasBancariasRouter);

// PC-2026-01 (Fase D — logos de bancos): único directorio servido como
// estático público en todo el backend — justificado porque un logo de
// banco debe ser visible en la vista pública del cliente (Fase F), no solo
// en el área privada. `express.static` nunca permite salir de
// LOGOS_BANCOS_DIR (sanitiza la ruta), y cada archivo se guarda con un
// nombre generado por el servidor (UUID), nunca el nombre original del
// cliente — ver uploadsLogosBancos.ts. No expone ningún otro directorio
// (comprobantes/evidencias siguen exclusivamente detrás de requireAuth).
app.use('/uploads/logos-bancos', express.static(LOGOS_BANCOS_DIR));

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // CORRECCIÓN FASE 4 (hallazgo #1, manifestación B): un cuerpo JSON sintácticamente inválido, o
  // válido pero no objeto/array en la raíz (ej. el literal `null`), es rechazado por el propio
  // express.json() con un SyntaxError que ya trae status 400 (lo fija body-parser, no código del
  // proyecto) — es un error de ENTRADA del cliente, no un fallo interno. Antes este handler
  // genérico lo convertía igual en 500. Cualquier otro error (sin status 400 de body-parser)
  // conserva exactamente el mismo comportamiento 500 de siempre — no se oculta ningún error
  // interno real.
  if (err instanceof SyntaxError && (err as { status?: number }).status === 400) {
    res.status(400).json({ message: 'El cuerpo de la petición no es JSON válido.' });
    return;
  }

  console.error('Error no controlado:', err instanceof Error ? err.message : err);
  res.status(500).json({ message: 'Error interno del servidor.' });
};

app.use(errorHandler);

// Express 4 no captura promesas rechazadas de handlers async: por defecto Node 20 termina el
// proceso (DoS). Se registra y el servicio sigue atendiendo; cada ruta ya usa asyncRoute.
process.on('unhandledRejection', (motivo) => {
  registrarEventoSeguridad('PROMESA_NO_CAPTURADA', {
    detalle: motivo instanceof Error ? motivo.message : String(motivo),
  });
});

const server = app.listen(env.port, () => {
  console.log(`NextProject backend escuchando en el puerto ${env.port}`);
  const advertenciaCorreo = advertenciaCorreoReal(env);
  if (advertenciaCorreo) console.warn(advertenciaCorreo);
});

server.on('error', (error) => {
  console.error('Error al iniciar el servidor backend:', error);
  process.exit(1);
});

checkDatabaseConnection()
  .then(() => {
    console.log('PostgreSQL conectado correctamente');
  })
  .catch((error: Error) => {
    console.error('No se pudo conectar a PostgreSQL:', error.message);
  });
