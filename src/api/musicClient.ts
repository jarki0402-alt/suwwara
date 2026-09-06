import { MusicApiError } from './types';

const DEFAULT_TIMEOUT_MS = 12000;

// Only set when audio traffic is deliberately routed to a separate origin
// from the rest of the API (e.g. a subdomain kept off Cloudflare's proxied
// network specifically for the heavy audio-byte traffic, while search/details/
// etc. stay on the main proxied domain) — defaults to '' so audio requests
// stay same-origin, identical to every other endpoint here, when unset.
const AUDIO_BASE_URL = (import.meta.env.VITE_AUDIO_BASE_URL as string | undefined) ?? '';

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Calls our own backend (server/) at a relative /api/* path. In dev this is
 * forwarded to the local backend by Vite's server.proxy config (vite.config.ts)
 * — that's what lets a phone on the same Wi-Fi hit /api/... successfully
 * without needing to know the backend's LAN IP. In production the backend
 * must be reachable at the same origin (e.g. behind a reverse proxy).
 */
export async function apiGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url.toString(), DEFAULT_TIMEOUT_MS);
  } catch (error) {
    throw new MusicApiError('Failed to reach the music backend.', error);
  }

  if (!response.ok) {
    let message = `Music backend responded with status ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // response body wasn't JSON — keep the generic message
    }
    throw new MusicApiError(message);
  }

  return (await response.json()) as T;
}

/** Builds the URL our AudioEngine's <audio> element should point at for a given song. */
export function buildAudioUrl(songId: string, quality: 'high' | 'low'): string {
  return `${AUDIO_BASE_URL}/api/audio/${encodeURIComponent(songId)}?quality=${quality}`;
}

/**
 * Fire-and-forget: asks the backend to resolve (and cache) a track's audio
 * URL without streaming any bytes yet. Called ahead of time for the next
 * queued track so the multi-second yt-dlp resolution has already happened
 * by the time playback actually needs it — this is what removes the
 * buffering delay when a song ends or the user hits next.
 */
export function prefetchAudio(songId: string, quality: 'high' | 'low'): void {
  const url = `${AUDIO_BASE_URL}/api/audio/${encodeURIComponent(songId)}/resolve?quality=${quality}`;
  fetch(new URL(url, window.location.origin), { keepalive: true }).catch(() => {
    // Best-effort warm-up only — a failed prefetch just means the normal
    // on-demand resolution path runs later, same as before this existed.
  });
}
