import { Router } from 'express';
import { deviceAuth } from '../auth/deviceAuth';
import { bearerDeviceId, deviceRef } from '../auth/deviceRef';
import { sql } from '../db/client';

/**
 * Linked devices (Settings -> Perangkat). deviceAuth is applied per route, not with
 * `router.use()`: a router-wide auth middleware that answers 401 swallows every request meant
 * for a router registered after it (see the comment in index.ts on artistRouter).
 */
export const linkRouter = Router();

/** Library items are opaque JSON to the server; this only satisfies postgres.js's JSON typing. */

const KINDS = new Set(['phone', 'tablet', 'desktop']);
function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) : '';
}
function cleanKind(value: unknown): string {
  return typeof value === 'string' && KINDS.has(value) ? value : 'desktop';
}

/** Where this device tells the account what to call it in the list. */
linkRouter.post('/devices/me', deviceAuth, async (req, res) => {
  const name = cleanName(req.body?.name);
  const kind = cleanKind(req.body?.kind);
  const deviceId = bearer(req);
  try {
    await sql`update devices set name = ${name || null}, kind = ${kind} where device_id = ${deviceId}`;
    res.status(204).end();
  } catch (error) {
    res.status(502).json({ error: 'Failed to save the device name.', message: (error as Error).message });
  }
});

const bearer = bearerDeviceId;


/** Devices on this account. Never includes anyone's device id — only the reference. */
linkRouter.get('/devices', deviceAuth, async (req, res) => {
  const self = deviceRef(bearer(req));
  try {
    const rows = await sql<{ device_id: string; name: string | null; kind: string | null; last_seen_at: Date }[]>`
      select device_id, name, kind, last_seen_at from devices where account_id = ${req.accountId!} order by created_at`;
    res.json({
      devices: rows.map((row) => {
        const ref = deviceRef(row.device_id);
        return { ref, name: row.name ?? 'Perangkat', kind: row.kind ?? 'desktop', lastSeenAt: row.last_seen_at, isThis: ref === self };
      }),
    });
  } catch (error) {
    res.status(502).json({ error: 'Failed to list devices.', message: (error as Error).message });
  }
});
