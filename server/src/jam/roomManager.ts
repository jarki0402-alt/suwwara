import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { addToQueue, advanceOnEnded, cycleRepeat, next, playAtPosition, playNext, previous, removeFromQueue, reorder, setQueue, toggleShuffle } from './queueReducer';
import type { JamIntent, RoomQueueState, RoomSnapshot, RoomTransportState } from './types';

interface Room {
  roomId: string;
  creatorClientId: string;
  queueState: RoomQueueState;
  transportState: RoomTransportState;
  lastAutoAdvanceAt: number;
  /**
   * Open streams per device. A SET, not one stream per device: a phone whose connection blipped opens its new stream
   * BEFORE the server notices the old one is dead, and the old stream's late `close` used to delete the device's entry
   * outright, new stream included. The room then thought it was empty (and was garbage-collected under people still
   * listening) and refused their actions as "not a member". Each close now removes only its own stream.
   */
  members: Map<string, Set<Response>>;
  /**
   * Everyone who has joined and not pressed "Keluar". Actions are allowed by this, not by having a stream open right
   * now: a device that is between streams (a reconnect, a phone just woken up) is still in the Jam, and its tap or its
   * end-of-song report must not bounce with a 403 that nobody sees.
   */
  participants: Set<string>;
  lastActivityAt: number;
}

const rooms = new Map<string, Room>();

const ROOM_CODE_BYTES = 3; // 6 hex chars — ~16.7M combinations, plenty unguessable for a closed circle
/**
 * How long a room nobody is connected to survives. Was 5 minutes, which a Jam where every phone had its screen off (so
 * every stream dropped) routinely outlived: everyone came back to "Jam sudah berakhir". Rooms are tiny (a queue of song
 * metadata) and stored in Postgres too (see roomStore.ts), so a few hours costs nothing.
 */
export const ROOM_IDLE_TTL_MS = 3 * 60 * 60 * 1000;
const GC_INTERVAL_MS = 60 * 1000;
const AUTO_ADVANCE_DEDUPE_MS = 3000;
// Hard caps (CLAUDE.md rule 1): room ids and client ids come from requests, so nothing here may grow without bound.
const MAX_ROOMS = 200;
const MAX_STREAMS_PER_CLIENT = 3;
const MAX_PARTICIPANTS = 50;
// A room with people connected is alive even when nobody taps anything; its stored activity time is refreshed this
// often so a restart does not mistake it for an abandoned one.
const TOUCH_EVERY_MS = 5 * 60 * 1000;

/** What roomStore.ts writes to and reads back from Postgres. Streams are never stored: devices reopen them. */
export interface PersistedRoom {
  roomId: string;
  creatorClientId: string;
  queueState: RoomQueueState;
  transportState: RoomTransportState;
  lastAutoAdvanceAt: number;
  participants: string[];
  lastActivityAt: number;
}

const dirtyRooms = new Set<string>();
const removedRooms = new Set<string>();
const touchedRooms = new Set<string>();

function markDirty(room: Room): void {
  dirtyRooms.add(room.roomId);
}

function dropRoom(roomId: string): void {
  rooms.delete(roomId);
  dirtyRooms.delete(roomId);
  touchedRooms.delete(roomId);
  removedRooms.add(roomId);
}

function toPersisted(room: Room): PersistedRoom {
  return {
    roomId: room.roomId,
    creatorClientId: room.creatorClientId,
    queueState: room.queueState,
    transportState: room.transportState,
    lastAutoAdvanceAt: room.lastAutoAdvanceAt,
    participants: [...room.participants],
    lastActivityAt: room.lastActivityAt,
  };
}

/** Rooms changed since the last call (cleared on read). Hand them back with requeueDirty if writing them fails. */
export function takeDirtyRooms(): PersistedRoom[] {
  const out: PersistedRoom[] = [];
  for (const roomId of dirtyRooms) {
    const room = rooms.get(roomId);
    if (room) out.push(toPersisted(room));
  }
  dirtyRooms.clear();
  return out;
}

export function requeueDirty(roomIds: string[]): void {
  for (const roomId of roomIds) if (rooms.has(roomId)) dirtyRooms.add(roomId);
}

export function takeRemovedRoomIds(): string[] {
  const out = [...removedRooms];
  removedRooms.clear();
  return out;
}

/** Rooms that only need their activity time refreshed: [roomId, lastActivityAt]. */
export function takeTouchedRooms(): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const roomId of touchedRooms) {
    const room = rooms.get(roomId);
    if (room) out.push([roomId, room.lastActivityAt]);
  }
  touchedRooms.clear();
  return out;
}

/** Brings a stored room back after a restart. Nobody is connected yet; every device reconnects on its own. */
export function restoreRoom(stored: PersistedRoom): void {
  if (rooms.has(stored.roomId) || rooms.size >= MAX_ROOMS) return;
  rooms.set(stored.roomId, {
    roomId: stored.roomId,
    creatorClientId: stored.creatorClientId,
    queueState: stored.queueState,
    transportState: stored.transportState,
    lastAutoAdvanceAt: stored.lastAutoAdvanceAt,
    members: new Map(),
    participants: new Set(stored.participants.slice(-MAX_PARTICIPANTS)),
    lastActivityAt: stored.lastActivityAt,
  });
}

/** The cap is reached: give up the room abandoned longest, never one people are connected to. */
function evictOldestEmptyRoom(): void {
  let oldest: Room | null = null;
  for (const room of rooms.values()) {
    if (room.members.size === 0 && (!oldest || room.lastActivityAt < oldest.lastActivityAt)) oldest = room;
  }
  if (oldest) dropRoom(oldest.roomId);
}

function addParticipant(room: Room, clientId: string): void {
  if (room.participants.has(clientId)) return;
  room.participants.add(clientId);
  if (room.participants.size > MAX_PARTICIPANTS) {
    const first = room.participants.values().next().value;
    if (first !== undefined) room.participants.delete(first);
  }
  markDirty(room);
}

function generateRoomId(): string {
  let code: string;
  do {
    code = randomBytes(ROOM_CODE_BYTES).toString('hex').toUpperCase();
  } while (rooms.has(code));
  return code;
}

/**
 * `initialTransport` is the host's own playback at the moment of starting: a room used to always start paused at 0:00,
 * so starting a Jam while music played stopped the music for the host, who then had to press play again.
 */
export function createRoom(
  creatorClientId: string,
  initialQueue: RoomQueueState,
  initialTransport?: { isPlaying: boolean; positionSec: number },
): string {
  if (rooms.size >= MAX_ROOMS) evictOldestEmptyRoom();
  const roomId = generateRoomId();
  const now = Date.now();
  const room: Room = {
    roomId,
    creatorClientId,
    queueState: initialQueue,
    transportState: {
      isPlaying: initialTransport?.isPlaying ?? false,
      positionSec: Math.max(0, initialTransport?.positionSec ?? 0),
      lastUpdatedAtMs: now,
    },
    lastAutoAdvanceAt: 0,
    members: new Map(),
    participants: new Set([creatorClientId]),
    lastActivityAt: now,
  };
  rooms.set(roomId, room);
  markDirty(room);
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
  return rooms.get(roomId)?.participants.has(clientId) ?? false;
}

/** The join step (before the stream opens): from here on this device may act in the room. */
export function joinRoom(roomId: string, clientId: string): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  addParticipant(room, clientId);
  return true;
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

function broadcast(room: Room, event: string, payload: unknown): void {
  for (const streams of room.members.values()) for (const res of streams) writeEvent(res, event, payload);
}

function broadcastQueue(room: Room): void {
  broadcast(room, 'queue', { ...room.queueState });
}

function broadcastTransport(room: Room): void {
  broadcast(room, 'transport', projectTransport(room.transportState, Date.now()));
}

function broadcastPresence(room: Room): void {
  broadcast(room, 'presence', { memberCount: room.members.size });
}

export function addMember(roomId: string, clientId: string, res: Response): RoomSnapshot | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  let streams = room.members.get(clientId);
  const isNewDevice = !streams;
  if (!streams) {
    streams = new Set();
    room.members.set(clientId, streams);
  }
  streams.add(res);
  // A device piling up streams (each reconnect before the old one is noticed dead) keeps only its newest few.
  while (streams.size > MAX_STREAMS_PER_CLIENT) {
    const oldest = streams.values().next().value;
    if (oldest === undefined) break;
    streams.delete(oldest);
    oldest.end();
  }
  addParticipant(room, clientId);
  room.lastActivityAt = Date.now();
  if (isNewDevice) broadcastPresence(room);
  return toSnapshot(room);
}

/** One stream closed. The device stays in the room (and in the count) while it has another stream open. */
export function removeConnection(roomId: string, clientId: string, res: Response): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const streams = room.members.get(clientId);
  if (!streams || !streams.delete(res)) return;
  if (streams.size > 0) return;
  room.members.delete(clientId);
  room.lastActivityAt = Date.now();
  touchedRooms.add(room.roomId);
  if (room.members.size > 0) broadcastPresence(room);
}

/** "Keluar": the device leaves the Jam for real (unlike a dropped stream, which it will reopen). */
export function removeMember(roomId: string, clientId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.members.delete(clientId);
  if (room.participants.delete(clientId)) markDirty(room);
  room.lastActivityAt = Date.now();
  if (room.members.size > 0) broadcastPresence(room);
}

export function closeRoom(roomId: string, reason: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const streams of room.members.values()) {
    for (const res of streams) {
      writeEvent(res, 'room-closed', { reason });
      res.end();
    }
  }
  dropRoom(roomId);
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
  if (queueChanged || transportChanged) markDirty(room);
  return true;
}

// Rooms nobody is connected to any more are dropped after a grace period —
// hygiene for a long-running Koyeb/VPS process, not a strict cleanup guarantee.
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (room.members.size > 0) {
      if (now - room.lastActivityAt >= TOUCH_EVERY_MS) {
        room.lastActivityAt = now;
        touchedRooms.add(roomId);
      }
    } else if (now - room.lastActivityAt > ROOM_IDLE_TTL_MS) {
      dropRoom(roomId);
    }
  }
}, GC_INTERVAL_MS).unref();
