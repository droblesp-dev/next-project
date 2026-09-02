import express from 'express';
import { env } from './config/env.js';
import { checkDatabaseConnection } from './config/db.js';

const app = express();

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'NextProject backend está activo',
  });
});

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
