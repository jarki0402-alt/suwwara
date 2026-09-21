import { notifyUnauthorized } from '../auth/authStore';
import { getDeviceId } from '../auth/deviceIdentity';
import { pullLibrary } from '../sync/librarySync';
import { handleRemoteCommand, type RemoteCommand } from './commandHandler';
import { useConnectStore, type RemoteDevice, type RemoteState } from './connectStore';

const RECONNECT_MAX_MS = 15_000;
// The server sends a keep-alive comment every 20s; a stream that has said nothing for this long
// is dead even if the socket still looks open (a phone that switched from Wi-Fi to mobile data).
const SILENCE_LIMIT_MS = 55_000;

let running = false;
let controller: AbortController | null = null;
let backoffMs = 1000;
let wake: (() => void) | null = null;

const authHeaders = () => ({ Authorization: `Bearer ${getDeviceId()}` });

/** Opens the account's live channel (and keeps it open, reconnecting on failure). Idempotent. */
export function startConnect(): void {
  if (running) return;
  running = true;
  void loop();
}

export function stopConnect(): void {
  running = false;
  controller?.abort();
  wake?.();
  useConnectStore.getState().reset();
}

/** Reconnect right now instead of waiting out the back-off (the app just came back to the foreground). */
export function reconnectNow(): void {
  if (!running || useConnectStore.getState().connected) return;
  backoffMs = 0;
  wake?.();
  controller?.abort();
}

async function loop(): Promise<void> {
  while (running) {
    controller = new AbortController();
    let lastByteAt = Date.now();
    const silence = setInterval(() => {
      if (Date.now() - lastByteAt > SILENCE_LIMIT_MS) controller?.abort();
    }, 15_000);
    try {
      const response = await fetch('/api/connect/stream', { headers: { ...authHeaders(), Accept: 'text/event-stream' }, signal: controller.signal, cache: 'no-store' });
      notifyUnauthorized(response.status);
      if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
      backoffMs = 1000;
      useConnectStore.getState().setConnected(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        lastByteAt = Date.now();
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          dispatch(block);
        }
      }
    } catch {
      // dropped or aborted — fall through to the reconnect below
    } finally {
      clearInterval(silence);
    }
    useConnectStore.getState().setConnected(false);
    if (!running) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, backoffMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = null;
    backoffMs = Math.min(Math.max(backoffMs, 500) * 2, RECONNECT_MAX_MS);
  }
}

function dispatch(block: string): void {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return; // a keep-alive comment
  try {
    const payload = JSON.parse(data);
    if (event === 'devices') useConnectStore.getState().setDevices(payload.you, payload.devices as Omit<RemoteDevice, 'receivedAt'>[]);
    else if (event === 'command') handleRemoteCommand(payload as RemoteCommand);
    else if (event === 'library') void pullLibrary();
  } catch {
    // a malformed event is dropped rather than crashing the stream
  }
}

export async function sendState(state: RemoteState): Promise<void> {
  try {
    const response = await fetch('/api/connect/state', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    if (response.status === 409) reconnectNow(); // the server no longer has this device's stream
  } catch {
    // best-effort: the next change or heartbeat reports again
  }
}

/** Returns false when the target isn't online (or the request failed). */
export async function sendCommand(targetRef: string, type: string, payload?: unknown): Promise<boolean> {
  try {
    const response = await fetch('/api/connect/command', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetRef, type, payload }),
    });
    return response.status === 204;
  } catch {
    return false;
  }
}
