import express, { type ErrorRequestHandler } from 'express';
import { env } from './config/env.js';
import { checkDatabaseConnection } from './config/db.js';
import { authRouter } from './routes/auth.routes.js';
import { usuariosRouter } from './routes/usuarios.routes.js';
import { clientesRouter } from './routes/clientes.routes.js';
import { solicitudesRouter } from './routes/solicitudes.routes.js';
import { cotizacionesRouter } from './routes/cotizaciones.routes.js';
import { ordenesRouter } from './routes/ordenes.routes.js';
import { analisisIaRouter } from './routes/analisisIa.routes.js';
import { leadsRouter } from './routes/leads.routes.js';
import { alertasRouter } from './routes/alertas.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';

const app = express();

// CORS mínimo, sin dependencias nuevas: orígenes permitidos configurados en
// CORS_ORIGINS (.env), no hardcodeados. Sin '*'. No afecta la lógica de
// requireAuth/requireRole.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
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

app.use('/api/auth', authRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/clientes', clientesRouter);
app.use('/api/solicitudes', solicitudesRouter);
app.use('/api/cotizaciones', cotizacionesRouter);
app.use('/api/ordenes', ordenesRouter);
app.use('/api/analisis-ia', analisisIaRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/alertas', alertasRouter);
app.use('/api/dashboard', dashboardRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('Error no controlado:', err instanceof Error ? err.message : err);
  res.status(500).json({ message: 'Error interno del servidor.' });
};

app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`NextProject backend escuchando en el puerto ${env.port}`);
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
