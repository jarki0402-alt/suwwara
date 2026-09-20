import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { deviceAuth } from '../auth/deviceAuth';
import { bearerDeviceId, deviceRef } from '../auth/deviceRef';
import { sql } from '../db/client';
import { mergeLibraries, type LibrarySnapshotData } from '../library/merge';
import { createLinkRequest, getLinkRequest, LINK_REQUEST_TTL_SEC, markLinkApproved, rateLimited } from '../linking/linkRequests';

/**
 * Linked devices (Settings -> Perangkat). deviceAuth is applied per route, not with
 * `router.use()`: a router-wide auth middleware that answers 401 swallows every request meant
 * for a router registered after it (see the comment in index.ts on artistRouter).
 */
export const linkRouter = Router();

/** Library items are opaque JSON to the server; this only satisfies postgres.js's JSON typing. */
const asJson = (value: unknown) => value as Parameters<typeof sql.json>[0];

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

/** The NEW device asks for a code to show as a QR. */
linkRouter.post('/auth/link/request', deviceAuth, (req, res) => {
  const deviceId = bearer(req);
  if (rateLimited(`request:${deviceId}`, 10, 60_000)) {
    res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    return;
  }
  const code = createLinkRequest(deviceId, cleanName(req.body?.name) || 'Perangkat baru', cleanKind(req.body?.kind));
  if (!code) {
    res.status(503).json({ error: 'Busy. Try again shortly.' });
    return;
  }
  res.json({ code, expiresInSec: LINK_REQUEST_TTL_SEC });
});

/** The waiting device polls this until its request is approved (or expires). */
linkRouter.get('/auth/link/request/:code', deviceAuth, (req, res) => {
  const request = getLinkRequest(String(req.params.code));
  if (!request || request.deviceId !== bearer(req)) {
    res.json({ status: 'expired' });
    return;
  }
  res.json({ status: request.approved ? 'approved' : 'pending' });
});

/** The device that scanned the QR previews who is asking before approving. */
linkRouter.get('/auth/link/info/:code', deviceAuth, (req, res) => {
  if (rateLimited(`info:${bearer(req)}`, 20, 60_000)) {
    res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    return;
  }
  const request = getLinkRequest(String(req.params.code));
  if (!request || request.approved) {
    res.status(404).json({ error: 'Kode tidak ditemukan atau sudah kedaluwarsa.' });
    return;
  }
  res.json({ deviceName: request.deviceName, deviceKind: request.deviceKind });
});

/**
 * The device that holds the data approves. The requesting device moves onto THIS account, and
 * the library it had on its own solo account is merged into this one (not thrown away, which
 * is what the older ?pair= flow did).
 */
linkRouter.post('/auth/link/approve', deviceAuth, async (req, res) => {
  const approverDeviceId = bearer(req);
  if (rateLimited(`approve:${approverDeviceId}`, 10, 60_000)) {
    res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    return;
  }
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  const request = code ? getLinkRequest(code) : undefined;
  if (!request || request.approved) {
    res.status(404).json({ error: 'Kode tidak ditemukan atau sudah kedaluwarsa.' });
    return;
  }
  if (request.deviceId === approverDeviceId) {
    res.status(400).json({ error: 'Tidak bisa menautkan perangkat ini ke dirinya sendiri.' });
    return;
  }

  const targetAccountId = req.accountId!;
  try {
    await sql.begin(async (tx) => {
      const [device] = await tx<{ account_id: string }[]>`select account_id from devices where device_id = ${request.deviceId} for update`;
      if (!device) throw new Error('requesting device vanished');
      const oldAccountId = device.account_id;
      if (oldAccountId === targetAccountId) return; // already the same account

      await tx`update devices set account_id = ${targetAccountId}, name = ${request.deviceName}, kind = ${request.deviceKind} where device_id = ${request.deviceId}`;

      const [source] = await tx<{ liked_songs: LibrarySnapshotData['likedSongs']; playlists: LibrarySnapshotData['playlists'] }[]>`
        select liked_songs, playlists from library_snapshots where account_id = ${oldAccountId}`;
      const [target] = await tx<{ liked_songs: LibrarySnapshotData['likedSongs']; playlists: LibrarySnapshotData['playlists'] }[]>`
        select liked_songs, playlists from library_snapshots where account_id = ${targetAccountId}`;
      const merged = mergeLibraries(
        { likedSongs: target?.liked_songs ?? [], playlists: target?.playlists ?? [] },
        { likedSongs: source?.liked_songs ?? [], playlists: source?.playlists ?? [] },
      );
      await tx`
        insert into library_snapshots (account_id, liked_songs, playlists, updated_at, version)
        values (${targetAccountId}, ${tx.json(asJson(merged.likedSongs))}, ${tx.json(asJson(merged.playlists))}, now(), 1)
        on conflict (account_id)
        do update set liked_songs = excluded.liked_songs, playlists = excluded.playlists, updated_at = now(),
                      version = library_snapshots.version + 1`;

      // The requester's old solo account is empty now; drop it (its snapshot goes with it).
      await tx`delete from accounts where id = ${oldAccountId} and not exists (select 1 from devices where account_id = ${oldAccountId})`;
    });
    markLinkApproved(code);
    res.json({ ok: true, deviceName: request.deviceName });
  } catch (error) {
    res.status(502).json({ error: 'Gagal menautkan perangkat.', message: (error as Error).message });
  }
});

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

/** Unlinks a device (any device on the account, including this one): it goes back to a fresh solo account. */
linkRouter.delete('/devices/:ref', deviceAuth, async (req, res) => {
  try {
    const rows = await sql<{ device_id: string }[]>`select device_id from devices where account_id = ${req.accountId!}`;
    const target = rows.find((row) => deviceRef(row.device_id) === req.params.ref);
    if (!target) {
      res.status(404).json({ error: 'Perangkat tidak ditemukan.' });
      return;
    }
    const freshAccountId = randomBytes(16).toString('hex');
    await sql.begin(async (tx) => {
      await tx`insert into accounts (id) values (${freshAccountId})`;
      await tx`update devices set account_id = ${freshAccountId} where device_id = ${target.device_id}`;
    });
    res.status(204).end();
  } catch (error) {
    res.status(502).json({ error: 'Gagal melepas perangkat.', message: (error as Error).message });
  }
});
