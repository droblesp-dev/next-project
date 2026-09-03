import express, { type ErrorRequestHandler } from 'express';
import { env } from './config/env.js';
import { checkDatabaseConnection } from './config/db.js';
import { authRouter } from './routes/auth.routes.js';
import { usuariosRouter } from './routes/usuarios.routes.js';

const app = express();

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'NextProject backend está activo',
  });
});

app.use('/api/auth', authRouter);
app.use('/api/usuarios', usuariosRouter);

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
