import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import { sql } from '../db/client';
import { diskCacheStats } from '../youtube/diskCache';
import { resolveQueueState } from '../youtube/stream';
import { resolveSummary } from './resolveStats';

/**
 * One row about the VM every 5 minutes (system_samples), kept 14 days, so the admin's Sistem tab can show what RAM,
 * CPU, disk and loading times did overnight, not only during the minutes the console was open. ~4000 rows of numbers;
 * each sample is a few file stats and two tiny queries, nothing that competes with playback.
 */
const SAMPLE_EVERY_MS = 5 * 60 * 1000;
const KEEP_DAYS = 14;

export async function memInfo(): Promise<{ totalBytes: number; availableBytes: number; swapUsedBytes: number; swapTotalBytes: number }> {
  try {
    const text = await readFile('/proc/meminfo', 'utf8');
    const kb = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0) * 1024;
    return { totalBytes: kb('MemTotal'), availableBytes: kb('MemAvailable'), swapUsedBytes: kb('SwapTotal') - kb('SwapFree'), swapTotalBytes: kb('SwapTotal') };
  } catch {
    return { totalBytes: os.totalmem(), availableBytes: os.freemem(), swapUsedBytes: 0, swapTotalBytes: 0 };
  }
}

async function takeSample(): Promise<void> {
  try {
    const [memory, disk, cache, [db]] = await Promise.all([
      memInfo(),
      statfs('/').catch(() => null),
      diskCacheStats(),
      sql<{ size: string }[]>`select pg_database_size(current_database())::bigint as size`,
    ]);
    const resolve = resolveSummary(SAMPLE_EVERY_MS);
    await sql`
      insert into system_samples (at, ram_used_bytes, ram_total_bytes, swap_used_bytes, load1, cpus, disk_used_bytes, disk_total_bytes,
        rss_bytes, cache_files, cache_bytes, db_bytes, resolves, resolve_failures, resolve_avg_ms, queue_pending)
      values (date_trunc('minute', now()), ${memory.totalBytes - memory.availableBytes}, ${memory.totalBytes}, ${memory.swapUsedBytes},
        ${os.loadavg()[0]}, ${os.cpus().length}, ${disk ? (disk.blocks - disk.bavail) * disk.bsize : null}, ${disk ? disk.blocks * disk.bsize : null},
        ${process.memoryUsage().rss}, ${cache?.files ?? null}, ${cache?.bytes ?? null}, ${Number(db.size)},
        ${resolve.count}, ${resolve.failures}, ${resolve.avgMs}, ${Math.min(resolveQueueState().pending, 32767)})
      on conflict (at) do nothing`;
    await sql`delete from system_samples where at < now() - make_interval(days => ${KEEP_DAYS}::int)`;
  } catch {
    // A missed sample is a gap in a chart, nothing more.
  }
}

// The first one a minute after boot (the schema is in place by then), then every 5 minutes.
setTimeout(() => void takeSample(), 60_000).unref();
setInterval(() => void takeSample(), SAMPLE_EVERY_MS).unref();
