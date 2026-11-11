import { sql } from '../db/client';
import { onShutdown } from '../shutdown';

/**
 * Usage per account, for the admin dashboard: per day (usage_daily, 400 days) and per hour split by kind (usage_hourly,
 * 90 days). Counted in memory and written in one batch a minute — a database write per audio request would be one per
 * 256KB chunk on a 1GB VM. Only sizes, counts and seconds: nothing about WHICH songs (the admin cannot see what a user
 * plays). Bounded like every cache here (CLAUDE.md rule 1).
 */
const FLUSH_INTERVAL_MS = 60_000;
const MAX_PENDING = 2000;
const MAX_PENDING_HOURLY = 5000;
const KEEP_DAYS = 400;
const KEEP_HOURLY_DAYS = 90;

export type UsageKind = 'song' | 'podcast' | 'video';

interface Pending {
  accountId: string;
  day: string;
  bytes: number;
  requests: number;
  videoBytes: number;
}
const pending = new Map<string, Pending>();

interface PendingHour {
  accountId: string;
  hour: string;
  kind: UsageKind;
  bytes: number;
  requests: number;
  diskBytes: number;
  listenSec: number;
  started: number;
  completed: number;
  skipped: number;
}
const pendingHourly = new Map<string, PendingHour>();

const today = (): string => new Date().toISOString().slice(0, 10);

/** The start of the hour `at` falls in, as an ISO instant (UTC): every timezone's hours start on the same instants that matter here (WIB is a whole-hour offset). */
const hourOf = (at: number): string => new Date(Math.floor(at / 3_600_000) * 3_600_000).toISOString();

function hourEntry(accountId: string, hour: string, kind: UsageKind): PendingHour | null {
  const key = `${accountId}|${hour}|${kind}`;
  let entry = pendingHourly.get(key);
  if (!entry) {
    if (pendingHourly.size >= MAX_PENDING_HOURLY) return null;
    entry = { accountId, hour, kind, bytes: 0, requests: 0, diskBytes: 0, listenSec: 0, started: 0, completed: 0, skipped: 0 };
    pendingHourly.set(key, entry);
  }
  return entry;
}

function record(accountId: string | undefined, bytes: number, kind: UsageKind, fromDisk: boolean): void {
  if (!accountId || bytes <= 0) return;
  const day = today();
  const key = `${accountId}|${day}`;
  let entry = pending.get(key);
  if (!entry && pending.size < MAX_PENDING) {
    entry = { accountId, day, bytes: 0, requests: 0, videoBytes: 0 };
    pending.set(key, entry);
  }
  if (entry) {
    if (kind === 'video') {
      entry.videoBytes += bytes;
    } else {
      entry.bytes += bytes;
      entry.requests += 1;
    }
  }
  const hour = hourEntry(accountId, hourOf(Date.now()), kind);
  if (hour) {
    hour.bytes += bytes;
    if (kind !== 'video') hour.requests += 1;
    if (fromDisk) hour.diskBytes += bytes;
  }
}

/** A song or podcast episode the server streamed; `fromDisk` when it came off the server's own audio cache (no YouTube). */
export function recordAudio(accountId: string | undefined, bytes: number, options: { episode?: boolean; fromDisk?: boolean } = {}): void {
  record(accountId, bytes, options.episode ? 'podcast' : 'song', options.fromDisk === true);
}

/** Music videos, counted apart so the dashboard shows what the Video button costs. */
export function recordVideo(accountId: string | undefined, bytes: number): void {
  record(accountId, bytes, 'video', false);
}

/** What a device reports it played (see routes/usage.ts): seconds heard and how many tracks started/finished/were skipped, per hour. */
export function recordListening(
  accountId: string,
  report: { hour: number; kind: 'song' | 'podcast'; listenSec: number; started: number; completed: number; skipped: number },
): void {
  const entry = hourEntry(accountId, hourOf(report.hour), report.kind);
  if (!entry) return;
  entry.listenSec += report.listenSec;
  entry.started += report.started;
  entry.completed += report.completed;
  entry.skipped += report.skipped;
}

export async function flushUsage(): Promise<void> {
  if (pending.size > 0) {
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
  if (pendingHourly.size > 0) {
    const batch = [...pendingHourly.values()];
    pendingHourly.clear();
    for (const entry of batch) {
      try {
        await sql`
          insert into usage_hourly (account_id, hour, kind, bytes, requests, disk_bytes, listen_sec, started, completed, skipped)
          values (${entry.accountId}, ${entry.hour}, ${entry.kind}, ${entry.bytes}, ${entry.requests}, ${entry.diskBytes},
                  ${Math.round(entry.listenSec)}, ${entry.started}, ${entry.completed}, ${entry.skipped})
          on conflict (account_id, hour, kind) do update
            set bytes = usage_hourly.bytes + excluded.bytes, requests = usage_hourly.requests + excluded.requests,
                disk_bytes = usage_hourly.disk_bytes + excluded.disk_bytes, listen_sec = usage_hourly.listen_sec + excluded.listen_sec,
                started = usage_hourly.started + excluded.started, completed = usage_hourly.completed + excluded.completed,
                skipped = usage_hourly.skipped + excluded.skipped
        `;
      } catch {
        // Same as above, per row: one deleted account must not drop everyone else's minute.
      }
    }
  }
}

export async function pruneUsage(): Promise<void> {
  try {
    await sql`delete from usage_daily where day < current_date - ${KEEP_DAYS}::int`;
    await sql`delete from usage_hourly where hour < now() - make_interval(days => ${KEEP_HOURLY_DAYS}::int)`;
  } catch {
    // best-effort
  }
}

setInterval(() => void flushUsage(), FLUSH_INTERVAL_MS).unref();
setInterval(() => void pruneUsage(), 24 * 60 * 60 * 1000).unref();
onShutdown(flushUsage);
