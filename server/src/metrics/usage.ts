import { sql } from '../db/client';

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
}
const pending = new Map<string, Pending>();

const today = (): string => new Date().toISOString().slice(0, 10);

export function recordAudio(accountId: string | undefined, bytes: number): void {
  if (!accountId || bytes <= 0) return;
  const day = today();
  const key = `${accountId}|${day}`;
  const entry = pending.get(key);
  if (entry) {
    entry.bytes += bytes;
    entry.requests += 1;
  } else if (pending.size < MAX_PENDING) {
    pending.set(key, { accountId, day, bytes, requests: 1 });
  }
}

export async function flushUsage(): Promise<void> {
  if (pending.size === 0) return;
  const batch = [...pending.values()];
  pending.clear();
  try {
    for (const entry of batch) {
      await sql`
        insert into usage_daily (account_id, day, audio_bytes, audio_requests)
        values (${entry.accountId}, ${entry.day}, ${entry.bytes}, ${entry.requests})
        on conflict (account_id, day) do update
          set audio_bytes = usage_daily.audio_bytes + excluded.audio_bytes, audio_requests = usage_daily.audio_requests + excluded.audio_requests
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
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void flushUsage().finally(() => process.exit(0));
  });
}
