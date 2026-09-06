import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { addToQueue, advanceOnEnded, cycleRepeat, next, playAtPosition, previous, removeFromQueue, reorder, setQueue, songAt, toggleShuffle } from './queueReducer';
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
  lastCompletedSongId: string | null;
  members: Map<string, Member>;
  lastActivityAt: number;
}

const rooms = new Map<string, Room>();

const ROOM_CODE_BYTES = 3; // 6 hex chars — ~16.7M combinations, plenty unguessable for a closed circle
const ROOM_IDLE_TTL_MS = 5 * 60 * 1000;
const GC_INTERVAL_MS = 60 * 1000;

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
    lastCompletedSongId: null,
    members: new Map(),
    lastActivityAt: now,
  });
  return roomId;
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

function toSnapshot(room: Room): RoomSnapshot {
  return { ...room.queueState, ...room.transportState, memberCount: room.members.size };
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
  const payload = { ...room.transportState };
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
      room.lastCompletedSongId = null;
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
      const currentSong = songAt(room.queueState);
      // Dedupe: multiple devices' local completion-watchdogs can all fire for the
      // same song within moments of each other — only the first one for a given
      // now-playing song actually advances the queue; the rest are no-ops.
      if (!currentSong || currentSong.id !== intent.payload.songId || room.lastCompletedSongId === intent.payload.songId) {
        break;
      }
      room.lastCompletedSongId = intent.payload.songId;
      const result = advanceOnEnded(room.queueState);
      room.queueState = result.state;
      room.transportState = { isPlaying: !result.ranOut, positionSec: 0, lastUpdatedAtMs: now };
      queueChanged = true;
      transportChanged = true;
      break;
    }
    case 'play':
      room.transportState = { ...room.transportState, isPlaying: true, lastUpdatedAtMs: now };
      transportChanged = true;
      break;
    case 'pause':
      room.transportState = { ...room.transportState, isPlaying: false, lastUpdatedAtMs: now };
      transportChanged = true;
      break;
    case 'toggle-play':
      room.transportState = { ...room.transportState, isPlaying: !room.transportState.isPlaying, lastUpdatedAtMs: now };
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
