import express, { type ErrorRequestHandler } from 'express';
import { env } from './config/env.js';
import { checkDatabaseConnection } from './config/db.js';
import { authRouter } from './routes/auth.routes.js';
import { usuariosRouter } from './routes/usuarios.routes.js';
import { clientesRouter } from './routes/clientes.routes.js';
import { solicitudesRouter } from './routes/solicitudes.routes.js';

const app = express();

// CORS mínimo, sin dependencias nuevas: orígenes de desarrollo del propio
// proyecto (el configurado en package.json y el usado en la práctica para
// probarlo en paralelo con el backend, dado el conflicto de puerto ya
// documentado). Sin '*'. No afecta la lógica de requireAuth/requireRole.
const ORIGENES_PERMITIDOS = ['http://localhost:3000', 'http://localhost:5173'];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ORIGENES_PERMITIDOS.includes(origin)) {
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
