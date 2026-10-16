import { Router } from 'express';
import { bearerDeviceId, deviceRef } from '../auth/deviceRef';
import { deviceAuth } from '../auth/deviceAuth';
import { COMMAND_TYPES, broadcastSession, connectDevice, sendCommand, updateDeviceState, type DeviceState } from '../connect/connectHub';
import { loadSession, sanitizeSessionUpdate, saveSession, saveSessionPosition } from '../connect/session';
import { sql } from '../db/client';
import { rateLimited } from '../auth/rateLimit';

/** Per-route deviceAuth — see the note in routes/link.ts. */
export const connectRouter = Router();

connectRouter.get('/connect/stream', deviceAuth, async (req, res) => {
  const deviceId = bearerDeviceId(req);
  const ref = deviceRef(deviceId);
  const [row] = await sql<{ name: string | null; kind: string | null }[]>`select name, kind from devices where device_id = ${deviceId}`.catch(() => []);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(':\n\n');

  const disconnect = connectDevice(req.accountId!, ref, row?.name ?? 'Perangkat', row?.kind ?? 'desktop', res);
  req.on('close', disconnect);
});

function toState(body: unknown): DeviceState | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const song = b.song && typeof b.song === 'object' ? (b.song as Record<string, unknown>) : null;
  const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  return {
    song: song && typeof song.id === 'string' ? { id: song.id.slice(0, 40), name: String(song.name ?? '').slice(0, 200), artist: String(song.artist ?? '').slice(0, 200), image: String(song.image ?? '').slice(0, 500) } : null,
    isPlaying: b.isPlaying === true,
    positionSec: Math.max(0, num(b.positionSec, 0)),
    durationSec: Math.max(0, num(b.durationSec, 0)),
    volume: Math.min(1, Math.max(0, num(b.volume, 1))),
    canSetVolume: b.canSetVolume !== false,
    followingRef: typeof b.followingRef === 'string' ? b.followingRef.slice(0, 40) : null,
    inJam: b.inJam === true,
  };
}

connectRouter.post('/connect/state', deviceAuth, (req, res) => {
  const deviceId = bearerDeviceId(req);
  if (rateLimited(`state:${deviceId}`, 60, 10_000)) {
    res.status(429).json({ error: 'Too many updates.' });
    return;
  }
  const state = toState(req.body);
  if (!state) {
    res.status(400).json({ error: 'Invalid state.' });
    return;
  }
  // 409 = not connected (the stream dropped); the client reconnects and reports again.
  res.status(updateDeviceState(req.accountId!, deviceRef(deviceId), state) ? 204 : 409).end();
});

connectRouter.post('/connect/command', deviceAuth, (req, res) => {
  const deviceId = bearerDeviceId(req);
  if (rateLimited(`command:${deviceId}`, 40, 10_000)) {
    res.status(429).json({ error: 'Too many commands.' });
    return;
  }
  const { targetRef, type, payload } = req.body ?? {};
  if (typeof targetRef !== 'string' || typeof type !== 'string' || !COMMAND_TYPES.has(type)) {
    res.status(400).json({ error: 'Invalid command.' });
    return;
  }
  const delivered = sendCommand(req.accountId!, deviceRef(deviceId), targetRef, type, payload ?? null);
  res.status(delivered ? 204 : 404).end();
});

// The account's playback session (see connect/session.ts). Not gated on an open stream: a lone device still saves where
// it is, so the next device to open — even after this one is gone — can carry on from there.
connectRouter.get('/connect/session', deviceAuth, async (req, res) => {
  try {
    const have = typeof req.query.have === 'string' ? req.query.have : null;
    res.json({ session: await loadSession(req.accountId!, have) });
  } catch {
    res.status(503).json({ error: 'Session unavailable.' });
  }
});

connectRouter.put('/connect/session', deviceAuth, async (req, res) => {
  const deviceId = bearerDeviceId(req);
  if (rateLimited(`session:${deviceId}`, 40, 10_000)) {
    res.status(429).json({ error: 'Too many updates.' });
    return;
  }
  const update = sanitizeSessionUpdate(req.body);
  if (!update) {
    res.status(400).json({ error: 'Invalid session.' });
    return;
  }
  const ref = deviceRef(deviceId);
  try {
    const updatedAt = await saveSession(req.accountId!, ref, update);
    // 409: the update named a queue revision the server doesn't hold — the device resends it with the queue.
    if (updatedAt === null) {
      res.status(409).json({ error: 'Queue needed.' });
      return;
    }
    const { cursor, queue } = update;
    broadcastSession(req.accountId!, ref, {
      from: ref,
      updatedAt,
      queueRev: cursor.queueRev,
      ...(queue ? { queue } : {}),
      order: cursor.order,
      position: cursor.position,
      repeatMode: cursor.repeatMode,
      shuffle: cursor.shuffle,
      songId: cursor.songId,
      activeRef: cursor.activeRef ?? ref,
    });
    res.json({ updatedAt });
  } catch {
    res.status(503).json({ error: 'Session unavailable.' });
  }
});

connectRouter.post('/connect/session/position', deviceAuth, async (req, res) => {
  const deviceId = bearerDeviceId(req);
  if (rateLimited(`position:${deviceId}`, 20, 10_000)) {
    res.status(429).end();
    return;
  }
  const { songId, positionSec, isPlaying } = req.body ?? {};
  if (typeof songId !== 'string' || songId.length > 40 || typeof positionSec !== 'number' || !Number.isFinite(positionSec)) {
    res.status(400).end();
    return;
  }
  try {
    await saveSessionPosition(req.accountId!, songId, Math.max(0, positionSec), isPlaying === true);
    res.status(204).end();
  } catch {
    res.status(503).end();
  }
});
