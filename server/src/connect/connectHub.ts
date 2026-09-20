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

/** Records what a device is playing. One device plays at a time (as in Spotify): when this one
 * starts, every other device that was playing is told to pause. */
export function updateDeviceState(accountId: string, ref: string, state: DeviceState): boolean {
  const hub = hubs.get(accountId);
  const connection = hub?.get(ref);
  if (!hub || !connection) return false;

  const startedPlaying = state.isPlaying && !connection.state?.isPlaying;
  connection.state = state;
  if (startedPlaying) {
    for (const other of hub.values()) {
      if (other.ref === ref || !other.state?.isPlaying) continue;
      other.state = { ...other.state, isPlaying: false };
      write(other, 'command', { from: ref, type: 'pause', payload: { reason: 'takeover' } });
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
