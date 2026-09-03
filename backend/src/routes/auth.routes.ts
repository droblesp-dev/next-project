import { Router } from 'express';
import { loginController, meController } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export const authRouter = Router();

authRouter.post('/login', loginController);
authRouter.get('/me', requireAuth, meController);
