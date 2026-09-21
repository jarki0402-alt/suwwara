import { Router } from 'express';
import { deviceAuth } from '../auth/deviceAuth';

export const authRouter = Router();

authRouter.use(deviceAuth);

/** Lets the client confirm which account its device id resolved to (mainly useful right after a pairing confirm). */
authRouter.get('/auth/whoami', (req, res) => {
  res.json({ accountId: req.accountId });
});
