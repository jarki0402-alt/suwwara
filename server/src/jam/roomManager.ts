import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { addToQueue, advanceOnEnded, cycleRepeat, next, playAtPosition, playNext, previous, removeFromQueue, reorder, setQueue, toggleShuffle } from './queueReducer';
import type { JamIntent, RoomQueueState, RoomSnapshot, RoomTransportState } from './types';

interface Member {
  res: Response;
  connectedAt: number;
}

interface Room {
  roomId: string;
  creatorClientId: string;
  queueState: RoomQueueState;
  transportState: RoomTransportState;
  lastAutoAdvanceAt: number;
  members: Map<string, Member>;
  lastActivityAt: number;
}

const rooms = new Map<string, Room>();

const ROOM_CODE_BYTES = 3; // 6 hex chars — ~16.7M combinations, plenty unguessable for a closed circle
const ROOM_IDLE_TTL_MS = 5 * 60 * 1000;
const GC_INTERVAL_MS = 60 * 1000;
const AUTO_ADVANCE_DEDUPE_MS = 3000;

function generateRoomId(): string {
  let code: string;
  do {
    code = randomBytes(ROOM_CODE_BYTES).toString('hex').toUpperCase();
  } while (rooms.has(code));
  return code;
}

export function createRoom(creatorClientId: string, initialQueue: RoomQueueState): string {
  const roomId = generateRoomId();
  const now = Date.now();
  rooms.set(roomId, {
    roomId,
    creatorClientId,
    queueState: initialQueue,
    transportState: { isPlaying: false, positionSec: 0, lastUpdatedAtMs: now },
    lastAutoAdvanceAt: 0,
    members: new Map(),
    lastActivityAt: now,
  });
  return roomId;
}

/** Open Jam rooms right now (admin dashboard). */
export function roomCount(): number {
  return rooms.size;
}

export function roomExists(roomId: string): boolean {
  return rooms.has(roomId);
}

export function isCreator(roomId: string, clientId: string): boolean {
  return rooms.get(roomId)?.creatorClientId === clientId;
}

export function isMember(roomId: string, clientId: string): boolean {
  return rooms.get(roomId)?.members.has(clientId) ?? false;
}

/** The room's transport state rolled forward to `now`. The server only learns the
 * playhead from discrete events (seek/next/play...) — nothing reports it continuously —
 * so `positionSec` is really "where the playhead was at lastUpdatedAtMs". Anyone reading
 * it later (a device joining or reconnecting mid-song, or a `play` arriving after a long
 * pause) must add the time that has passed since, or they start from a stale spot. Done
 * here, on the one clock every device already agrees to follow, rather than on each
 * client: no cross-device clock skew involved. */
function projectTransport(transport: RoomTransportState, now: number): RoomTransportState {
  const elapsedSec = transport.isPlaying ? Math.max(0, now - transport.lastUpdatedAtMs) / 1000 : 0;
  return { isPlaying: transport.isPlaying, positionSec: transport.positionSec + elapsedSec, lastUpdatedAtMs: now };
}

function toSnapshot(room: Room): RoomSnapshot {
  return { ...room.queueState, ...projectTransport(room.transportState, Date.now()), memberCount: room.members.size };
}

export function getSnapshot(roomId: string): RoomSnapshot | null {
  const room = rooms.get(roomId);
  return room ? toSnapshot(room) : null;
}

function writeEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastQueue(room: Room): void {
  const payload = { ...room.queueState };
  for (const member of room.members.values()) writeEvent(member.res, 'queue', payload);
}

function broadcastTransport(room: Room): void {
  const payload = projectTransport(room.transportState, Date.now());
  for (const member of room.members.values()) writeEvent(member.res, 'transport', payload);
}

function broadcastPresence(room: Room): void {
  const payload = { memberCount: room.members.size };
  for (const member of room.members.values()) writeEvent(member.res, 'presence', payload);
}

export function addMember(roomId: string, clientId: string, res: Response): RoomSnapshot | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  room.members.set(clientId, { res, connectedAt: Date.now() });
  room.lastActivityAt = Date.now();
  broadcastPresence(room);
  return toSnapshot(room);
}

export function removeMember(roomId: string, clientId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.members.delete(clientId);
  room.lastActivityAt = Date.now();
  if (room.members.size > 0) broadcastPresence(room);
}

export function closeRoom(roomId: string, reason: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const member of room.members.values()) {
    writeEvent(member.res, 'room-closed', { reason });
    member.res.end();
  }
  rooms.delete(roomId);
}

/** Applies one intent to a room's canonical state and broadcasts the result to
 * every connected member, including the sender — nobody is special-cased, which
 * is what makes control fully symmetric/collaborative. Returns false if the
 * room no longer exists. */
export function applyIntent(roomId: string, intent: JamIntent): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  room.lastActivityAt = Date.now();

  let queueChanged = false;
  let transportChanged = false;
  const now = Date.now();

  switch (intent.type) {
    case 'add-to-queue':
      room.queueState = addToQueue(room.queueState, intent.payload.song);
      queueChanged = true;
      break;
    case 'play-next':
      room.queueState = playNext(room.queueState, intent.payload.song);
      queueChanged = true;
      break;
    case 'remove-from-queue':
      room.queueState = removeFromQueue(room.queueState, intent.payload.orderPosition);
      queueChanged = true;
      break;
    case 'reorder':
      room.queueState = reorder(room.queueState, intent.payload.fromPosition, intent.payload.toPosition);
      queueChanged = true;
      break;
    case 'toggle-shuffle':
      room.queueState = toggleShuffle(room.queueState);
      queueChanged = true;
      break;
    case 'cycle-repeat':
      room.queueState = cycleRepeat(room.queueState);
      queueChanged = true;
      break;
    case 'play-at-position':
      room.queueState = playAtPosition(room.queueState, intent.payload.orderPosition);
      room.transportState = { isPlaying: true, positionSec: 0, lastUpdatedAtMs: now };
      queueChanged = true;
      transportChanged = true;
      break;
    case 'set-queue':
      room.queueState = setQueue(room.queueState, intent.payload.songs, intent.payload.startAt);
      room.transportState = { isPlaying: true, positionSec: 0, lastUpdatedAtMs: now };
      room.lastAutoAdvanceAt = 0;
      queueChanged = true;
      transportChanged = true;
      break;
    case 'next':
      room.queueState = next(room.queueState);
      room.transportState = { ...room.transportState, positionSec: 0, lastUpdatedAtMs: now };
      queueChanged = true;
      transportChanged = true;
      break;
    case 'previous':
      room.queueState = previous(room.queueState);
      room.transportState = { ...room.transportState, positionSec: 0, lastUpdatedAtMs: now };
      queueChanged = true;
      transportChanged = true;
      break;
    case 'advance-on-ended': {
      // Every device runs its own end-of-track watchdog, so several reports for the
      // same track arrive within moments of each other — only the first should advance.
      // Two guards, because each catches what the other can't:
      //  - the report must be about the track that is playing *right now*. A slow
      //    device (a phone on a bad connection) can report seconds later, after the
      //    queue has already moved on; a purely time-based window would wrongly treat
      //    that late report as a fresh "track ended" and skip a song nobody finished.
      //  - a short window for the same track, so repeat-one / a queue holding the same
      //    song twice can still legitimately replay it, while simultaneous reports
      //    for one ending collapse into a single advance.
      const currentId = room.queueState.queue[room.queueState.order[room.queueState.position]]?.id;
      const reportedId = intent.payload?.songId;
      if (reportedId !== undefined && currentId !== undefined && reportedId !== currentId) break;
      if (now - room.lastAutoAdvanceAt < AUTO_ADVANCE_DEDUPE_MS) break;
      room.lastAutoAdvanceAt = now;
      const result = advanceOnEnded(room.queueState);
      room.queueState = result.state;
      room.transportState = { isPlaying: !result.ranOut, positionSec: 0, lastUpdatedAtMs: now };
      queueChanged = true;
      transportChanged = true;
      break;
    }
    // play/pause/toggle must bank the time already played *before* flipping isPlaying:
    // otherwise pausing at 1:00 keeps the stale positionSec, and resuming makes every
    // device seek back to wherever the last seek/next happened.
    case 'play':
      room.transportState = { ...projectTransport(room.transportState, now), isPlaying: true };
      transportChanged = true;
      break;
    case 'pause':
      room.transportState = { ...projectTransport(room.transportState, now), isPlaying: false };
      transportChanged = true;
      break;
    case 'toggle-play':
      room.transportState = { ...projectTransport(room.transportState, now), isPlaying: !room.transportState.isPlaying };
      transportChanged = true;
      break;
    case 'seek':
      room.transportState = { ...room.transportState, positionSec: Math.max(intent.payload.positionSec, 0), lastUpdatedAtMs: now };
      transportChanged = true;
      break;
    case 'heartbeat':
      room.transportState = { isPlaying: intent.payload.isPlaying, positionSec: Math.max(intent.payload.positionSec, 0), lastUpdatedAtMs: now };
      transportChanged = true;
      break;
  }

  if (queueChanged) broadcastQueue(room);
  if (transportChanged) broadcastTransport(room);
  return true;
}

// Rooms nobody is connected to any more are dropped after a grace period —
// hygiene for a long-running Koyeb/VPS process, not a strict cleanup guarantee.
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (room.members.size === 0 && now - room.lastActivityAt > ROOM_IDLE_TTL_MS) {
      rooms.delete(roomId);
    }
  }
}, GC_INTERVAL_MS).unref();
