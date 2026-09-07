import type { NextFunction, Request, Response } from 'express';
import { sql } from '../db/client';

declare module 'express-serve-static-core' {
  interface Request {
    accountId?: string;
  }
}

/**
 * Passwordless "device identity": the client generates a random id for
 * itself on first launch (src/auth/deviceIdentity.ts) and sends it back as
 * `Authorization: Bearer <deviceId>` on every request that touches
 * account-scoped data. No password, no email — the id itself is the
 * credential, which is an acceptable trade-off for a closed friends/family
 * circle with low-stakes data (playlists), not a bank.
 *
 * First time a device is ever seen, it gets its own brand-new account.
 * Pairing (see pairingManager.ts) later repoints a device's account_id to an
 * existing account instead of leaving it on its own solo one.
 */
export async function deviceAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const deviceId = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!deviceId) {
    res.status(401).json({ error: 'Missing device identity.', message: 'Authorization: Bearer <deviceId> header is required.' });
    return;
  }

  try {
    const [existing] = await sql<{ account_id: string }[]>`
      select account_id from devices where device_id = ${deviceId}
    `;

    if (existing) {
      await sql`update devices set last_seen_at = now() where device_id = ${deviceId}`;
      req.accountId = existing.account_id;
      next();
      return;
    }

    const accountId = deviceId; // first-seen device's own id doubles as its fresh account id — simplest unique key available.
    await sql.begin(async (tx) => {
      await tx`insert into accounts (id) values (${accountId}) on conflict do nothing`;
      await tx`insert into devices (device_id, account_id) values (${deviceId}, ${accountId}) on conflict do nothing`;
    });
    req.accountId = accountId;
    next();
  } catch (error) {
    res.status(502).json({ error: 'Auth backend unavailable.', message: (error as Error).message });
  }
}
