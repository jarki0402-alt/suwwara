import { MusicApiError } from './types';

const DEFAULT_TIMEOUT_MS = 12000;

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
  return `/api/audio/${encodeURIComponent(songId)}?quality=${quality}`;
}

/**
 * Fire-and-forget: asks the backend to resolve (and cache) a track's audio
 * URL without streaming any bytes yet. Called ahead of time for the next
 * queued track so the multi-second yt-dlp resolution has already happened
 * by the time playback actually needs it — this is what removes the
 * yt-dlp buffering delay when a song ends or the user hits next.
 *
 * That alone doesn't warm the *browser's* cache, though — the actual audio
 * bytes still had to travel over the network the first time anything asked
 * for them, so the transition still waited on a fresh download. This second
 * fetch downloads the real bytes ahead of time into the browser's own HTTP
 * cache (the audio route already sends `Cache-Control: public, max-age=3600`
 * — see server/src/routes/audio.ts — so this simply seeds that same cache
 * entry early); the <audio> element's own request for the identical URL
 * moments later is then served locally instead of over the network.
 * Deliberately NOT `keepalive: true` here — Chrome caps keepalive fetch
 * bodies at 64KB, far too small for a multi-MB song, so a page unload mid-
 * download just aborts this one harmlessly, same as any other in-flight
 * request would.
 */
export function prefetchAudio(songId: string, quality: 'high' | 'low'): void {
  const resolveUrl = `/api/audio/${encodeURIComponent(songId)}/resolve?quality=${quality}`;
  fetch(new URL(resolveUrl, window.location.origin), { keepalive: true }).catch(() => {
    // Best-effort warm-up only — a failed prefetch just means the normal
    // on-demand resolution path runs later, same as before this existed.
  });

  const audioUrl = buildAudioUrl(songId, quality);
  fetch(new URL(audioUrl, window.location.origin)).catch(() => {
    // Same as above — a failed/aborted prefetch just falls back to a normal
    // on-demand network fetch when playback actually needs this track.
  });
}
