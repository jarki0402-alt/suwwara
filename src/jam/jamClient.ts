import type { Song } from '../api/types';
import { notifyUnauthorized } from '../auth/authStore';
import type { RepeatMode } from '../stores/queueStore';

// Only useful if the frontend and backend are ever hosted on different origins
// (e.g. a split Vercel/Koyeb deploy) — defaults to '' so every call stays a
// same-origin relative path, identical in spirit to how src/api/musicClient.ts
// already calls /api/* today.
const BASE_URL = (import.meta.env.VITE_JAM_API_BASE_URL as string | undefined) ?? '';

export interface JamQueuePayload {
  queue: Song[];
  order: number[];
  position: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
}

export interface JamTransportPayload {
  isPlaying: boolean;
  positionSec: number;
  lastUpdatedAtMs: number;
}

export interface JamRoomSnapshot extends JamQueuePayload, JamTransportPayload {
  memberCount: number;
}

export type JamIntentType =
  | 'add-to-queue'
  | 'play-next'
  | 'remove-from-queue'
  | 'reorder'
  | 'toggle-shuffle'
  | 'cycle-repeat'
  | 'play-at-position'
  | 'set-queue'
  | 'play'
  | 'pause'
  | 'toggle-play'
  | 'next'
  | 'previous'
  | 'seek'
  | 'advance-on-ended'
  | 'heartbeat';

/** A request the server answered with an error status (as opposed to one that never got an answer). */
export class JamRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Whether an error means the room is definitely gone. The ONLY reason the app may take someone out of a Jam on its own:
 * a timeout, a dropped connection or a proxy error while the backend restarts all mean "not reachable right now", and
 * treating those as "ended" is what used to throw people out of a Jam that was still running.
 */
export function isRoomGone(error: unknown): boolean {
  return error instanceof JamRequestError && error.status === 404;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    notifyUnauthorized(res.status);
    const message = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new JamRequestError(typeof message?.error === 'string' ? message.error : `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export async function createRoom(
  clientId: string,
  initialQueue: JamQueuePayload,
  initialTransport?: { isPlaying: boolean; positionSec: number },
): Promise<string> {
  const result = await postJson<{ roomId: string }>('/api/jam/create', { clientId, initialQueue, initialTransport });
  return result.roomId;
}

export async function joinRoom(roomId: string, clientId: string): Promise<JamRoomSnapshot | null> {
  const result = await postJson<{ ok: boolean; snapshot: JamRoomSnapshot | null }>(`/api/jam/${roomId}/join`, {
    clientId,
  });
  return result.snapshot;
}

export async function sendJamIntent(
  roomId: string,
  clientId: string,
  type: JamIntentType,
  payload?: Record<string, unknown>,
): Promise<void> {
  await postJson(`/api/jam/${roomId}/action`, { clientId, type, payload });
}

export async function leaveRoom(roomId: string, clientId: string): Promise<void> {
  await postJson(`/api/jam/${roomId}/leave`, { clientId }).catch(() => {});
}

export async function endRoom(roomId: string, clientId: string): Promise<void> {
  await postJson(`/api/jam/${roomId}/end`, { clientId }).catch(() => {});
}

export interface JamStreamHandlers {
  onRoomState: (snapshot: JamRoomSnapshot) => void;
  onQueue: (payload: JamQueuePayload) => void;
  onTransport: (payload: JamTransportPayload) => void;
  onPresence: (payload: { memberCount: number }) => void;
  onRoomClosed: (payload: { reason: string }) => void;
  /** The server's keepalive (every 20s): proof the stream is still alive, see useJamSync. */
  onPing: () => void;
}

/** Opens the room's SSE stream. `EventSource` reconnects on its own after a
 * drop; the server always re-sends a full `room-state` snapshot on connect,
 * so a reconnect resyncs for free without any bespoke backoff logic here. */
export function openJamStream(roomId: string, clientId: string, handlers: JamStreamHandlers): EventSource {
  const source = new EventSource(`${BASE_URL}/api/jam/${roomId}/stream?clientId=${encodeURIComponent(clientId)}`);

  const listen = <T,>(event: string, handler: (payload: T) => void) => {
    source.addEventListener(event, (e) => {
      try {
        handler(JSON.parse((e as MessageEvent).data));
      } catch {
        // Malformed event — ignore rather than crash the stream handler.
      }
    });
  };

  listen('room-state', handlers.onRoomState);
  listen('queue', handlers.onQueue);
  listen('transport', handlers.onTransport);
  listen('presence', handlers.onPresence);
  listen('room-closed', handlers.onRoomClosed);
  listen('ping', handlers.onPing);

  return source;
}
