import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { generarController } from '../controllers/asistenteFormulario.controller.js';

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

// FORMULARIO-01: público y sin sesión, igual que POST /api/solicitudes y
// POST /api/leads — la protección de costo/abuso es el rate-limit por IP
// (nexiaRateLimit.service.ts::consumirInvocacionNexiaPublica), nunca
// requireAuth. Un único endpoint, sin lectura ni historial.
export const asistenteFormularioRouter = Router();

asistenteFormularioRouter.post('/', asyncRoute(generarController));
