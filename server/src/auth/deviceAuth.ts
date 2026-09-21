import type { NextFunction, Request, Response } from 'express';
import { sql } from '../db/client';

declare module 'express-serve-static-core' {
  interface Request {
    accountId?: string;
  }
}

/**
 * Says WHICH DEVICE a request comes from (`Authorization: Bearer <deviceId>`, minted by the client on first launch —
 * src/auth/deviceIdentity.ts). Who the user is now comes from the session cookie (auth/sessions.ts), checked before
 * any of this runs: the device row is (re)pointed at the signed-in account, so all of a user's devices share one
 * account without any pairing step. Nothing here creates accounts any more — only the admin does, see auth/users.ts.
 */
const TOUCH_EVERY_MS = 60_000;
const MAX_REMEMBERED = 500;
const remembered = new Map<string, { accountId: string; touchedAt: number }>();

export async function deviceAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const deviceId = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!deviceId || !req.session) {
    res.status(401).json({ error: 'auth_required', message: 'Silakan masuk dulu.' });
    return;
  }

  const accountId = req.session.accountId;
  const known = remembered.get(deviceId);
  const now = Date.now();
  if (!known || known.accountId !== accountId || now - known.touchedAt > TOUCH_EVERY_MS) {
    try {
      await sql`
        insert into devices (device_id, account_id) values (${deviceId}, ${accountId})
        on conflict (device_id) do update set account_id = excluded.account_id, last_seen_at = now()
      `;
    } catch (error) {
      res.status(502).json({ error: 'Auth backend unavailable.', message: (error as Error).message });
      return;
    }
    remembered.delete(deviceId);
    remembered.set(deviceId, { accountId, touchedAt: now });
    while (remembered.size > MAX_REMEMBERED) {
      const oldest = remembered.keys().next().value;
      if (oldest === undefined) break;
      remembered.delete(oldest);
    }
  }
  req.accountId = accountId;
  next();
}
