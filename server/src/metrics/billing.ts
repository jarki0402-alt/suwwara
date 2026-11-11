import { statfs } from 'node:fs/promises';
import { sql } from '../db/client';
import { memInfo } from './systemSamples';

/**
 * What this VM's Google Cloud bill should come to, for the admin console. Calibrated on the real billing export
 * (2026-09 to 2026-11):
 *
 * - The only line that costs anything is "Network Data Transfer Out via Carrier Peering Network": the bytes sent to
 *   Cloudflare (the tunnel), at ~Rp 1.450 per GiB (Oct 1.438, Nov 1.454). Cloudflare peers with Google, so this is
 *   NOT the "Standard Data Transfer Out to Internet" that has 200 GiB a month free: every GiB is paid.
 * - The VM (e2-micro), its 30 GB standard disk and the external IP are all zeroed by the free tier; downloads from
 *   YouTube are ingress, free.
 * - The bill's GiB run 8% above what this server counts as audio/video (Oct: 4.22 billed vs 3.92 counted): API
 *   answers, app files after an update, tunnel/TLS framing. Hence the overhead factor.
 *
 * Both numbers are env so a new exchange rate or a re-calibration needs no code. Billing months are cut in the billing
 * account's Pacific time, so this cuts them there too (usage_hourly is per UTC hour, and Pacific is a whole-hour offset).
 */
const num = (raw: string | undefined, fallback: number) => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const PRICING = {
  rpPerGib: num(process.env.EGRESS_RP_PER_GIB, 1450),
  overhead: num(process.env.EGRESS_OVERHEAD, 1.08),
};
const BILLING_TZ = 'America/Los_Angeles';
const GIB = 1024 ** 3;
// The free tier covers one e2-micro (1 GB RAM) with up to 30 GB of standard disk. A little slack for what the
// kernel and filesystem report (a 30 GB disk shows ~29 GiB, an e2-micro ~0.95 GiB of RAM).
const FREE_DISK_MAX_BYTES = 31 * GIB;
const FREE_RAM_MAX_BYTES = 1.25 * GIB;

export const costOf = (bytes: number): number => (bytes / GIB) * PRICING.overhead * PRICING.rpPerGib;

type Kind = 'song' | 'podcast' | 'video';

export async function billingSummary() {
  const [[bounds], kinds, [previous], [lastWeek], memory, disk] = await Promise.all([
    sql<{ start: Date; next: Date; prev: Date; now: Date }[]>`
      select (date_trunc('month', now() at time zone ${BILLING_TZ}) at time zone ${BILLING_TZ}) as start,
        ((date_trunc('month', now() at time zone ${BILLING_TZ}) + interval '1 month') at time zone ${BILLING_TZ}) as next,
        ((date_trunc('month', now() at time zone ${BILLING_TZ}) - interval '1 month') at time zone ${BILLING_TZ}) as prev,
        now() as now`,
    sql<{ kind: string; bytes: string }[]>`
      select kind, sum(bytes)::bigint as bytes from usage_hourly
      where hour >= (date_trunc('month', now() at time zone ${BILLING_TZ}) at time zone ${BILLING_TZ}) group by 1`,
    sql<{ bytes: string }[]>`
      select coalesce(sum(bytes), 0)::bigint as bytes from usage_hourly
      where hour >= ((date_trunc('month', now() at time zone ${BILLING_TZ}) - interval '1 month') at time zone ${BILLING_TZ})
        and hour < (date_trunc('month', now() at time zone ${BILLING_TZ}) at time zone ${BILLING_TZ})`,
    // The pace for the rest of the month: the last 7 days, so a new habit (videos, podcasts) shows at once, where an
    // average since the 1st would lag behind it.
    sql<{ bytes: string; first: Date | null }[]>`
      select coalesce(sum(bytes), 0)::bigint as bytes, min(hour) as first from usage_hourly where hour >= now() - interval '7 days'`,
    memInfo(),
    statfs('/').catch(() => null),
  ]);

  const byKind: Record<Kind, number> = { song: 0, podcast: 0, video: 0 };
  for (const row of kinds) if (row.kind === 'song' || row.kind === 'podcast' || row.kind === 'video') byKind[row.kind] = Number(row.bytes);
  const monthBytes = byKind.song + byKind.podcast + byKind.video;
  const now = bounds.now.getTime();
  // A server younger than a week has fewer days behind it: the pace is over the days it actually has.
  const weekDays = lastWeek.first ? Math.min(7, Math.max(1, (now - lastWeek.first.getTime()) / 86_400_000)) : 7;
  const perDay = Number(lastWeek.bytes) / weekDays;
  const daysLeft = Math.max(0, (bounds.next.getTime() - now) / 86_400_000);
  const projectedBytes = monthBytes + perDay * daysLeft;
  const diskTotal = disk ? disk.blocks * disk.bsize : null;

  return {
    pricing: PRICING,
    month: { start: bounds.start.toISOString(), end: bounds.next.toISOString() },
    bytes: monthBytes,
    cost: costOf(monthBytes),
    byKind: { song: costOf(byKind.song), podcast: costOf(byKind.podcast), video: costOf(byKind.video) },
    projectedCost: costOf(projectedBytes),
    perDayCost: costOf(perDay),
    previousBytes: Number(previous.bytes),
    previousCost: costOf(Number(previous.bytes)),
    freeTier: [
      { label: 'RAM VM setara e2-micro (1 GB)', ok: memory.totalBytes <= FREE_RAM_MAX_BYTES, detail: memory.totalBytes },
      { label: 'Disk maks. 30 GB', ok: diskTotal !== null && diskTotal <= FREE_DISK_MAX_BYTES, detail: diskTotal ?? 0 },
    ],
  };
}

/** The bill's month (Pacific) that `month` (YYYY-MM) names, and the one before: bytes and their cost. */
export async function billingForMonth(month: string) {
  const at = (offset: number) => sql`((${`${month}-01`}::text::date + make_interval(months => ${offset}::int))::timestamp at time zone ${BILLING_TZ})`;
  const sum = async (offset: number) => {
    const [row] = await sql<{ bytes: string }[]>`
      select coalesce(sum(bytes), 0)::bigint as bytes from usage_hourly where hour >= ${at(offset)} and hour < ${at(offset + 1)}`;
    const bytes = Number(row.bytes);
    return { bytes, cost: costOf(bytes) };
  };
  const [current, previous] = await Promise.all([sum(0), sum(-1)]);
  return { current, previous };
}
