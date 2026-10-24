import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { cambiarPasswordController, loginController, meController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

// Mismo patrón de las demás rutas (Express 4 no captura promesas rechazadas).
function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}

export const authRouter = Router();

authRouter.post('/login', asyncRoute(loginController));
authRouter.get('/me', requireAuth, asyncRoute(meController));
// Fase 2C: solo el usuario autenticado, sobre su propia cuenta. Documentado en config/openapi.ts.
authRouter.patch('/password', requireAuth, asyncRoute(cambiarPasswordController));
