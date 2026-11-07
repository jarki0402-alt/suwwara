import { sql } from '../db/client';
import { onShutdown } from '../shutdown';

/**
 * Audio bandwidth per account per day, for the admin dashboard. Counted in memory and written in one batch a minute —
 * a database write per audio request would be one per 256KB chunk on a 1GB VM. Only sizes and counts: nothing about
 * WHICH songs (the admin cannot see what a user plays). Bounded like every cache here (CLAUDE.md rule 1).
 */
const FLUSH_INTERVAL_MS = 60_000;
const MAX_PENDING = 2000;
const KEEP_DAYS = 400;

interface Pending {
  accountId: string;
  day: string;
  bytes: number;
  requests: number;
  videoBytes: number;
}
const pending = new Map<string, Pending>();

const today = (): string => new Date().toISOString().slice(0, 10);

function record(accountId: string | undefined, bytes: number, kind: 'audio' | 'video'): void {
  if (!accountId || bytes <= 0) return;
  const day = today();
  const key = `${accountId}|${day}`;
  let entry = pending.get(key);
  if (!entry) {
    if (pending.size >= MAX_PENDING) return;
    entry = { accountId, day, bytes: 0, requests: 0, videoBytes: 0 };
    pending.set(key, entry);
  }
  if (kind === 'video') {
    entry.videoBytes += bytes;
  } else {
    entry.bytes += bytes;
    entry.requests += 1;
  }
}

export function recordAudio(accountId: string | undefined, bytes: number): void {
  record(accountId, bytes, 'audio');
}

/** Music videos, counted apart so the dashboard shows what the Video button costs. */
export function recordVideo(accountId: string | undefined, bytes: number): void {
  record(accountId, bytes, 'video');
}

export async function flushUsage(): Promise<void> {
  if (pending.size === 0) return;
  const batch = [...pending.values()];
  pending.clear();
  try {
    for (const entry of batch) {
      await sql`
        insert into usage_daily (account_id, day, audio_bytes, audio_requests, video_bytes)
        values (${entry.accountId}, ${entry.day}, ${entry.bytes}, ${entry.requests}, ${entry.videoBytes})
        on conflict (account_id, day) do update
          set audio_bytes = usage_daily.audio_bytes + excluded.audio_bytes, audio_requests = usage_daily.audio_requests + excluded.audio_requests,
              video_bytes = usage_daily.video_bytes + excluded.video_bytes
      `;
    }
  } catch {
    // An account deleted in between (foreign key) or a database hiccup: losing one minute of counts is fine.
  }
}

export async function pruneUsage(): Promise<void> {
  try {
    await sql`delete from usage_daily where day < current_date - ${KEEP_DAYS}::int`;
  } catch {
    // best-effort
  }
}

setInterval(() => void flushUsage(), FLUSH_INTERVAL_MS).unref();
setInterval(() => void pruneUsage(), 24 * 60 * 60 * 1000).unref();
onShutdown(flushUsage);
