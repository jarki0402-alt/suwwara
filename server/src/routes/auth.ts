import { Router } from 'express';
import { sql } from '../db/client';
import { deviceAuth } from '../auth/deviceAuth';
import { createPairingCode, consumePairingCode } from '../pairing/pairingManager';

export const authRouter = Router();

authRouter.use(deviceAuth);

/** Lets the client confirm which account its device id resolved to (mainly useful right after a pairing confirm). */
authRouter.get('/auth/whoami', (req, res) => {
  res.json({ accountId: req.accountId });
});

/** Called by an already-onboarded device that wants to link a second device to the same account. */
authRouter.post('/auth/link/generate', (req, res) => {
  const code = createPairingCode(req.accountId!);
  res.json({ code, expiresInSec: 300 });
});

/**
 * Called by the new device once it has the code (scanned QR or typed
 * manually). Repoints this device's row to the target account — any data
 * this device already pushed to its own solo account (created by deviceAuth
 * on its very first request) is intentionally left behind, not merged. This
 * is a known simplification: pairing is meant to happen early (first
 * launch), before a device has accumulated its own library.
 */
authRouter.post('/auth/link/confirm', async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!code) {
    res.status(400).json({ error: 'Missing code.' });
    return;
  }

  const result = consumePairingCode(code);
  if (!result.ok) {
    res.status(404).json({ error: result.reason === 'expired' ? 'Kode sudah kedaluwarsa.' : 'Kode tidak ditemukan.' });
    return;
  }

  await sql`update devices set account_id = ${result.accountId} where device_id = ${req.accountId!}`;
  res.json({ accountId: result.accountId });
});
