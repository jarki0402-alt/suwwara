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
 * URL without streaming any bytes yet. Cheap — no audio bytes cross the
 * network here, just a yt-dlp resolution that gets cached server-side for a
 * few hours (see server/src/youtube/stream.ts) — so this is safe to call for
 * several upcoming tracks at once without meaningfully adding to server load.
 * Called ahead of time so the multi-second yt-dlp resolution has already
 * happened by the time playback actually reaches that track.
 */
export function prefetchAudioResolveOnly(songId: string, quality: 'high' | 'low'): void {
  const url = `/api/audio/${encodeURIComponent(songId)}/resolve?quality=${quality}`;
  fetch(new URL(url, window.location.origin), { keepalive: true }).catch(() => {
    // Best-effort warm-up only — a failed prefetch just means the normal
    // on-demand resolution path runs later, same as before this existed.
  });
}

// Tracks the one in-flight full-byte prefetch (if any) so a newer target can
// cancel the previous one instead of letting it keep running unbounded in the
// background — see prefetchAudioFull's own doc comment for why this matters.
let fullPrefetchController: AbortController | null = null;
let fullPrefetchSongId: string | null = null;

/**
 * Downloads the actual audio bytes for one upcoming track ahead of time, into
 * the browser's own HTTP cache (the audio route sends `Cache-Control: public,
 * max-age=3600` — see server/src/routes/audio.ts — so this simply seeds that
 * same cache entry early). Unlike prefetchAudioResolveOnly, this genuinely
 * costs the same server-side work (yt-dlp resolution + proxying the full
 * file) as actually playing the track — so it's deliberately capped to at
 * most ONE in-flight full prefetch at a time, for the single next track only.
 * Calling this again for a different track cancels whichever one was still
 * in flight rather than letting both run concurrently — without this, a
 * queue that changes its "next" track a few times in a row (reordering,
 * radio auto-extend, someone else's Jam edit) could pile up several full
 * downloads running at once, which is exactly what overwhelmed the VM the
 * first time this existed without cancellation.
 */
export function prefetchAudioFull(songId: string, quality: 'high' | 'low'): void {
  if (fullPrefetchSongId === songId) return; // already the one in flight (or just finished)
  fullPrefetchController?.abort();

  const controller = new AbortController();
  fullPrefetchController = controller;
  fullPrefetchSongId = songId;

  const audioUrl = buildAudioUrl(songId, quality);
  fetch(new URL(audioUrl, window.location.origin), { signal: controller.signal }).catch(() => {
    // Aborted (superseded by a newer prefetch) or failed outright — either
    // way, playback falls back to a normal on-demand fetch when it gets here.
  });
}
