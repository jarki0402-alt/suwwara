import { Router } from 'express';
import {
  addMember,
  applyIntent,
  closeRoom,
  createRoom,
  getSnapshot,
  isMember,
  removeMember,
  roomExists,
} from '../jam/roomManager';
import type { JamIntent, RoomQueueState } from '../jam/types';

export const jamRouter = Router();

const KEEPALIVE_MS = 20000;

function isValidQueueState(value: unknown): value is RoomQueueState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.queue) && Array.isArray(v.order) && typeof v.position === 'number';
}

jamRouter.post('/jam/create', (req, res) => {
  const { clientId, initialQueue } = req.body ?? {};
  if (typeof clientId !== 'string' || !clientId) {
    res.status(400).json({ error: 'clientId is required.' });
    return;
  }
  const queueState: RoomQueueState = isValidQueueState(initialQueue)
    ? {
        queue: initialQueue.queue,
        order: initialQueue.order,
        position: initialQueue.position,
        repeatMode: initialQueue.repeatMode ?? 'off',
        shuffle: initialQueue.shuffle ?? false,
      }
    : { queue: [], order: [], position: 0, repeatMode: 'off', shuffle: false };

  const roomId = createRoom(clientId, queueState);
  res.json({ roomId });
});

jamRouter.post('/jam/:roomId/join', (req, res) => {
  const { roomId } = req.params;
  const { clientId } = req.body ?? {};
  if (typeof clientId !== 'string' || !clientId) {
    res.status(400).json({ error: 'clientId is required.' });
    return;
  }
  if (!roomExists(roomId)) {
    res.status(404).json({ error: 'Room not found.' });
    return;
  }
  const snapshot = getSnapshot(roomId);
  res.json({ ok: true, snapshot });
});

jamRouter.post('/jam/:roomId/action', (req, res) => {
  const { roomId } = req.params;
  const { clientId, type, payload } = req.body ?? {};
  if (typeof clientId !== 'string' || !clientId || typeof type !== 'string') {
    res.status(400).json({ error: 'clientId and type are required.' });
    return;
  }
  if (!isMember(roomId, clientId)) {
    res.status(403).json({ error: 'Not a member of this room.' });
    return;
  }
  const intent = { type, payload } as JamIntent;
  const applied = applyIntent(roomId, intent);
  if (!applied) {
    res.status(404).json({ error: 'Room not found.' });
    return;
  }
  res.json({ ok: true });
});

jamRouter.post('/jam/:roomId/leave', (req, res) => {
  const { roomId } = req.params;
  const { clientId } = req.body ?? {};
  if (typeof clientId === 'string' && clientId) removeMember(roomId, clientId);
  res.json({ ok: true });
});

jamRouter.post('/jam/:roomId/end', (req, res) => {
  const { roomId } = req.params;
  // Any participant may end the Jam for everyone — control is fully symmetric,
  // there's no "host" who exclusively owns this action.
  closeRoom(roomId, 'ended-by-participant');
  res.json({ ok: true });
});

jamRouter.get('/jam/:roomId/stream', (req, res) => {
  const { roomId } = req.params;
  const clientId = req.query.clientId;
  if (typeof clientId !== 'string' || !clientId) {
    res.status(400).json({ error: 'clientId query param is required.' });
    return;
  }
  if (!roomExists(roomId)) {
    res.status(404).json({ error: 'Room not found.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const snapshot = addMember(roomId, clientId, res);
  if (snapshot) res.write(`event: room-state\ndata: ${JSON.stringify(snapshot)}\n\n`);

  // Keeps the connection from being idle-timed-out by any intermediary proxy
  // (nginx, Koyeb's own edge, etc.) — a comment line, not a real event.
  const keepAlive = setInterval(() => res.write(':\n\n'), KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(keepAlive);
    removeMember(roomId, clientId);
  });
});
