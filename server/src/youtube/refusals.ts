import type { Response } from 'express';

/**
 * Videos YouTube recently said no to, and why (2026-11). Without this a refused song cost the same anonymous attempts
 * on every tap of "Coba lagi", every quiet retry and every background retry: one night saw a single song asked 5 times
 * in 40 s, 15 requests to a YouTube that was already distrusting this VM's IP. Now the first refusal is the only one
 * that reaches YouTube until it expires, and the client is told what kind of no it was (see playability()).
 *
 * The reasons come from ytdlp-service (main.py, refusal_kind):
 *  - gone: private, removed, members-only, blocked in the VM's country. No retry will change it today.
 *  - account: age-restricted / sign-in only, and the backup account could not help (none set up, or it is resting).
 *    Shorter, so a newly added account gets its chance within the hour.
 *  - limited: "not a bot". About the IP, not the song: a short pause, long enough that repeated taps stop feeding it.
 */
export type RefusalReason = 'gone' | 'account' | 'limited';

export class ResolveRefusedError extends Error {
  constructor(
    readonly reason: RefusalReason,
    message: string,
  ) {
    super(message);
    this.name = 'ResolveRefusedError';
  }
}

const TTL_MS: Record<RefusalReason, number> = {
  gone: 24 * 60 * 60 * 1000,
  account: 60 * 60 * 1000,
  limited: 2 * 60 * 1000,
};
// Video ids come from any listener's taps, so the map is capped, not just left to expire.
const MAX_ENTRIES = 500;

const refusals = new Map<string, { reason: RefusalReason; until: number }>();

export function isRefusalReason(value: unknown): value is RefusalReason {
  return value === 'gone' || value === 'account' || value === 'limited';
}

export function rememberRefusal(videoId: string, reason: RefusalReason, now = Date.now()): void {
  refusals.delete(videoId);
  refusals.set(videoId, { reason, until: now + TTL_MS[reason] });
  while (refusals.size > MAX_ENTRIES) {
    const oldest = refusals.keys().next().value;
    if (oldest === undefined) break;
    refusals.delete(oldest);
  }
}

export function refusalFor(videoId: string, now = Date.now()): RefusalReason | null {
  const entry = refusals.get(videoId);
  if (!entry) return null;
  if (entry.until <= now) {
    refusals.delete(videoId);
    return null;
  }
  return entry.reason;
}

/** What the player needs to know: skip it for good, wait a little, or nothing known against it. */
export function playability(videoId: string): 'unplayable' | 'limited' | 'ok' {
  const reason = refusalFor(videoId);
  if (reason === 'gone' || reason === 'account') return 'unplayable';
  return reason ?? 'ok';
}

/**
 * The HTTP answer for a refused resolve, or null for any other error (which keeps its route's own 502). 410 says "this
 * song will not play, move on"; 503 + Retry-After says "YouTube is limiting the server, try again in a bit". A plain
 * <audio> element only sees "failed" either way, so the player asks /api/audio/:id/playability afterwards.
 */
export function refusalResponse(
  error: unknown,
): { status: 410 | 503; retryAfterSec?: number; body: { error: string; playability: 'unplayable' | 'limited' } } | null {
  if (!(error instanceof ResolveRefusedError)) return null;
  if (error.reason === 'limited') {
    return {
      status: 503,
      retryAfterSec: Math.round(TTL_MS.limited / 1000),
      body: { error: 'YouTube is limiting this server for now.', playability: 'limited' },
    };
  }
  return { status: 410, body: { error: 'YouTube does not allow this video to be played here.', playability: 'unplayable' } };
}

/** Answers a refused resolve with 410/503 (see refusalResponse); false for any other error. */
export function sendRefusal(res: Response, error: unknown): boolean {
  const refusal = refusalResponse(error);
  if (!refusal || res.headersSent) return false;
  if (refusal.retryAfterSec) res.setHeader('Retry-After', String(refusal.retryAfterSec));
  res.status(refusal.status).json(refusal.body);
  return true;
}

/** Reads ytdlp-service's error body (`{"detail": {"reason", "message"}}`); null for anything else. */
export function parseRefusal(body: string): { reason: RefusalReason; message: string } | null {
  try {
    const detail = (JSON.parse(body) as { detail?: { reason?: unknown; message?: unknown } }).detail;
    if (detail && isRefusalReason(detail.reason)) return { reason: detail.reason, message: String(detail.message ?? '') };
  } catch {
    // Not JSON: an older service, a proxy error page. Treated as an ordinary failure.
  }
  return null;
}

/** For tests. */
export function clearRefusals(): void {
  refusals.clear();
}

setInterval(
  () => {
    const now = Date.now();
    for (const [videoId, entry] of refusals) if (entry.until <= now) refusals.delete(videoId);
  },
  5 * 60 * 1000,
).unref();
