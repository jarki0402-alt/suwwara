import type { Response } from 'express';

/**
 * "Connect": the devices linked to one account, live. Each keeps a server-sent-events stream
 * open here, reports what it is playing, and can send another one a command — the way Spotify
 * Connect lets a laptop pause the phone. In-memory and per account (like the Jam rooms): it
 * only needs to describe who is online right now, not survive a restart.
 */
export interface RemoteSong {
  id: string;
  name: string;
  artist: string;
  image: string;
}

export interface DeviceState {
  song: RemoteSong | null;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  /** False on iOS, where the volume of a web page's audio is the hardware's alone. */
  canSetVolume: boolean;
  /** Set while this device is a remote for another one (shows as "Remote" in the device list instead of a song). */
  followingRef: string | null;
  /** In a Jam, the device is out of the account's session; the others show that instead of offering to move playback there. */
  inJam: boolean;
  /**
   * How long ago (ms, on the device's own clock) someone last asked THIS device to play: a tap on a song, play, a
   * transfer. Null from a device that never did, absent from an older build. Sent as an age, not a time, so the
   * devices' clocks never have to agree.
   */
  playIntentAgeMs?: number | null;
  /** Server clock: when that ask happened (filled in here, never trusted from the client). */
  startedAt?: number;
}

interface Connection {
  ref: string;
  name: string;
  kind: string;
  res: Response;
  state: DeviceState | null;
}

export const COMMAND_TYPES = new Set(['play', 'pause', 'toggle', 'next', 'previous', 'seek', 'volume', 'transfer', 'handoff']);

// A person has a handful of devices. The cap is what stops a leaked id from holding open an
// unbounded number of streams on a 1GB VM.
const MAX_CONNECTIONS_PER_ACCOUNT = 8;

const hubs = new Map<string, Map<string, Connection>>();

function write(connection: Connection, event: string, data: unknown): void {
  connection.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastDevices(accountId: string): void {
  const hub = hubs.get(accountId);
  if (!hub) return;
  const devices = [...hub.values()].map((connection) => ({ ref: connection.ref, name: connection.name, kind: connection.kind, state: connection.state }));
  for (const connection of hub.values()) write(connection, 'devices', { you: connection.ref, devices });
}

/** Accounts playing right now and on what kind of device (admin dashboard): who is listening, never what. */
export function listeningNow(): Array<{ accountId: string; kinds: string[] }> {
  const out: Array<{ accountId: string; kinds: string[] }> = [];
  for (const [accountId, hub] of hubs) {
    const kinds = [...hub.values()].filter((connection) => connection.state?.isPlaying).map((connection) => connection.kind);
    if (kinds.length > 0) out.push({ accountId, kinds });
  }
  return out;
}

/** Devices with an open Connect stream right now, across all accounts (admin dashboard). */
export function onlineDeviceCount(): number {
  let total = 0;
  for (const hub of hubs.values()) total += hub.size;
  return total;
}

export function connectDevice(accountId: string, ref: string, name: string, kind: string, res: Response): () => void {
  let hub = hubs.get(accountId);
  if (!hub) {
    hub = new Map();
    hubs.set(accountId, hub);
  }
  // The same device reconnecting (network change, wake from sleep) replaces its old, dead stream.
  const previous = hub.get(ref);
  if (previous) previous.res.end();
  hub.delete(ref);
  while (hub.size >= MAX_CONNECTIONS_PER_ACCOUNT) {
    const oldest = hub.keys().next().value;
    if (oldest === undefined) break;
    hub.get(oldest)?.res.end();
    hub.delete(oldest);
  }

  const connection: Connection = { ref, name, kind, res, state: previous?.state ?? null };
  hub.set(ref, connection);
  broadcastDevices(accountId);

  return () => {
    const current = hubs.get(accountId);
    if (current?.get(ref) === connection) {
      current.delete(ref);
      if (current.size === 0) hubs.delete(accountId);
      else broadcastDevices(accountId);
    }
  };
}

// Two reports of the same ask land a little apart (each age is measured when its request leaves); anything closer than
// this is the same ask, not a new one.
const SAME_INTENT_MS = 2000;

/**
 * Records what a device is playing. One device plays at a time (as in Spotify), and the device asked to play most
 * recently is the one that keeps playing: every other playing device that was asked earlier is told to pause.
 *
 * Decided by when the ask happened, not by who reported "playing" last. A phone frozen by Android while it played wakes
 * up minutes later (Doze, a reconnecting stream, a background retry still "loading") and reports playing again: judged
 * by the report alone that looked like a new start, and the tablet the person was actually listening to got paused.
 * Its ask is the old one, so now it is that phone that gets told to stop.
 */
export function updateDeviceState(accountId: string, ref: string, state: DeviceState): boolean {
  const hub = hubs.get(accountId);
  const connection = hub?.get(ref);
  if (!hub || !connection) return false;

  const previous = connection.state;
  if (state.isPlaying) {
    const now = Date.now();
    const asked = typeof state.playIntentAgeMs === 'number' ? now - state.playIntentAgeMs : null;
    const sameAsk = previous?.isPlaying === true && previous.startedAt !== undefined && (asked === null || Math.abs(asked - previous.startedAt) <= SAME_INTENT_MS);
    // An older build sends no age: its start counts from the moment it began reporting playing, as before.
    state.startedAt = sameAsk ? previous.startedAt : (asked ?? now);
  }
  connection.state = state;

  if (state.isPlaying && !state.inJam && state.startedAt !== undefined) {
    const mine = state.startedAt;
    for (const other of hub.values()) {
      if (other.ref === ref || !other.state?.isPlaying || other.state.inJam) continue;
      if ((other.state.startedAt ?? 0) <= mine) {
        other.state = { ...other.state, isPlaying: false };
        write(other, 'command', { from: ref, type: 'pause', payload: { reason: 'takeover' } });
      } else {
        // Someone was asked to play after this device: this one is the stale report.
        connection.state = { ...state, isPlaying: false };
        write(connection, 'command', { from: other.ref, type: 'pause', payload: { reason: 'takeover' } });
        break;
      }
    }
  }
  broadcastDevices(accountId);
  return true;
}

export function sendCommand(accountId: string, fromRef: string, targetRef: string, type: string, payload: unknown): boolean {
  const target = hubs.get(accountId)?.get(targetRef);
  if (!target) return false;
  write(target, 'command', { from: fromRef, type, payload });
  return true;
}

/** Hands an update of the account's playback session to every OTHER device of the account (the sender already has it). */
export function broadcastSession(accountId: string, fromRef: string, session: unknown): void {
  const hub = hubs.get(accountId);
  if (!hub) return;
  for (const connection of hub.values()) {
    if (connection.ref !== fromRef) write(connection, 'session', session);
  }
}

/** Tells the account's OTHER devices the library changed, so they pull it now instead of on their next poll. */
export function notifyLibraryChanged(accountId: string, exceptRef: string, version: number): void {
  const hub = hubs.get(accountId);
  if (!hub) return;
  for (const connection of hub.values()) {
    if (connection.ref !== exceptRef) write(connection, 'library', { version });
  }
}

export function keepAliveAll(): void {
  for (const hub of hubs.values()) {
    for (const connection of hub.values()) connection.res.write(':\n\n');
  }
}

// One timer for every stream (a comment line, so no proxy in between idle-times a quiet connection out).
setInterval(keepAliveAll, 20_000).unref();
