import { readdir, readFile, statfs } from 'node:fs/promises';
import { sql } from '../db/client';
import { counterDelta } from './counterDelta';
import { memInfo } from './systemSamples';

/**
 * Everything the VM sends out, for the admin console's "Data keluar" (2026-11, after the switch to DNS-only Cloudflare).
 *
 * Why the network card and not the app's own counts: usage_hourly only counts audio and video bytes. API answers, app
 * files after an update, HLS playlists, Jam/Connect streams, TLS and TCP framing all leave the VM too, and Google meters
 * all of it (the old bill ran 8% above the app's counts). The host's own counter for its network card is the same number
 * Google sees, so it is read straight from there: docker-compose mounts the host's /sys read-only at /host/sys (a bind
 * of the host's sysfs keeps showing the host's interfaces, where the container's own /sys would only show its veth).
 * Missing mount (a laptop, an old compose file) just means "not measured": the console falls back to the app's counts.
 *
 * Read every 5 minutes with the system sample: two small files, one row upserted. The last raw counter is kept in
 * Postgres with the kernel's boot id, so a backend restart loses nothing and a VM reboot (counters back to 0) never
 * makes a negative or a double count.
 *
 * Why it matters at all now that it's free: the Standard tier's free internet egress is 200 GiB a month per billing
 * account. Direct from the VM, this app has used ~2-3% of that. Through Cloudflare's proxy (orange cloud), the same
 * bytes become Carrier Peering egress and are paid from the first GiB, hence the Cloudflare check below.
 */

const HOST_SYS = process.env.HOST_SYS_PATH || '/host/sys';
// Interfaces that never reach the internet: loopback, Docker's own bridges and container ends.
const SKIP_IFACE = /^(lo|docker\d*|br-.*|veth.*|virbr.*)$/;
const KEEP_DAYS = 400;
const BILLING_TZ = 'America/Los_Angeles';
const LOCAL_TZ = 'Asia/Jakarta';
const GIB = 1024 ** 3;
export const FREE_EGRESS_BYTES = 200 * GIB;
// The free tier covers one e2-micro (1 GB RAM) with up to 30 GB of standard disk. A little slack for what the kernel
// and filesystem report (a 30 GB disk shows ~29 GiB, an e2-micro ~0.95 GiB of RAM).
const FREE_DISK_MAX_BYTES = 31 * GIB;
const FREE_RAM_MAX_BYTES = 1.25 * GIB;

interface Counters {
  iface: string;
  tx: number;
  rx: number;
}

async function readCounter(iface: string, name: 'tx_bytes' | 'rx_bytes'): Promise<number | null> {
  const value = Number((await readFile(`${HOST_SYS}/class/net/${iface}/statistics/${name}`, 'utf8').catch(() => '')).trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** The VM's internet-facing card: NET_IFACE if set, otherwise the busiest one that isn't loopback or Docker's. */
async function readCounters(): Promise<Counters | null> {
  const wanted = process.env.NET_IFACE;
  const names = wanted ? [wanted] : (await readdir(`${HOST_SYS}/class/net`).catch(() => [] as string[])).filter((name) => !SKIP_IFACE.test(name));
  let best: Counters | null = null;
  for (const iface of names) {
    const [tx, rx] = await Promise.all([readCounter(iface, 'tx_bytes'), readCounter(iface, 'rx_bytes')]);
    if (tx === null || rx === null) continue;
    if (!best || tx + rx > best.tx + best.rx) best = { iface, tx, rx };
  }
  return best;
}

async function bootId(): Promise<string> {
  // The kernel's, shared with the host: a container restart keeps it, a VM reboot changes it.
  return (await readFile('/proc/sys/kernel/random/boot_id', 'utf8').catch(() => 'unknown')).trim();
}

export let lastInterface: string | null = null;

/**
 * Moves the stored counters forward and books what was sent/received since the last reading into this hour.
 * Returns the bytes for the system sample, or null when the host's card can't be read.
 */
export async function sampleEgress(): Promise<{ tx: number; rx: number } | null> {
  const counters = await readCounters();
  if (!counters) return null;
  lastInterface = counters.iface;
  const boot = await bootId();
  const [stored] = await sql<{ boot_id: string; iface: string; tx: string; rx: string }[]>`select boot_id, iface, tx, rx from net_counter where id = 1`;
  const before = (value: string | undefined) => (stored && value !== undefined ? { boot: stored.boot_id, iface: stored.iface, value: Number(value) } : null);
  const tx = counterDelta(before(stored?.tx), { boot, iface: counters.iface, value: counters.tx });
  const rx = counterDelta(before(stored?.rx), { boot, iface: counters.iface, value: counters.rx });
  await sql`
    insert into net_counter (id, boot_id, iface, tx, rx, at) values (1, ${boot}, ${counters.iface}, ${counters.tx}, ${counters.rx}, now())
    on conflict (id) do update set boot_id = excluded.boot_id, iface = excluded.iface, tx = excluded.tx, rx = excluded.rx, at = excluded.at`;
  // The very first reading only sets the starting point; the hour row still appears, so "measured since" is known.
  await sql`
    insert into net_hourly (hour, tx_bytes, rx_bytes) values (date_trunc('hour', now()), ${tx}, ${rx})
    on conflict (hour) do update set tx_bytes = net_hourly.tx_bytes + excluded.tx_bytes, rx_bytes = net_hourly.rx_bytes + excluded.rx_bytes`;
  await sql`delete from net_hourly where hour < now() - make_interval(days => ${KEEP_DAYS}::int)`;
  return { tx, rx };
}

// ---- Cloudflare in front or not ------------------------------------------------------------------

// Cloudflare's proxy adds CF-Ray to every request it forwards; straight from a browser it is absent. A forged one only
// makes the admin card warn for an hour, nothing else reads it. One timestamp in memory, nothing per request beyond
// looking at a header.
let cloudflareSeenAt: number | null = null;
let cloudflareRequests = 0;

export function noteCloudflare(cfRay: unknown): void {
  if (!cfRay) return;
  cloudflareSeenAt = Date.now();
  cloudflareRequests += 1;
}

export const cloudflareState = () => ({ seenAt: cloudflareSeenAt ? new Date(cloudflareSeenAt).toISOString() : null, requests: cloudflareRequests });

// ---- what the console shows ----------------------------------------------------------------------

type Kind = 'song' | 'podcast' | 'video';
const monthStart = (offset: number) =>
  sql`((date_trunc('month', now() at time zone ${BILLING_TZ}) + make_interval(months => ${offset}::int)) at time zone ${BILLING_TZ})`;

type Fragment = ReturnType<typeof monthStart>;

async function countedByKind(from: Fragment, to: Fragment | null) {
  const rows = await sql<{ kind: string; bytes: string }[]>`
    select kind, coalesce(sum(bytes), 0)::bigint as bytes from usage_hourly where hour >= ${from} ${to ? sql`and hour < ${to}` : sql``} group by 1`;
  const byKind: Record<Kind, number> = { song: 0, podcast: 0, video: 0 };
  for (const row of rows) if (row.kind === 'song' || row.kind === 'podcast' || row.kind === 'video') byKind[row.kind] = Number(row.bytes);
  return byKind;
}

const sumKinds = (byKind: Record<Kind, number>) => byKind.song + byKind.podcast + byKind.video;

/** The month as Google counts it (Pacific): the VM card where measured, the app's own counts for the part before. */
async function monthTotals(offset: number, measuredSince: Date | null) {
  const from = monthStart(offset);
  const to = monthStart(offset + 1);
  const [[net], [bounds], byKind] = await Promise.all([
    sql<{ tx: string; rx: string }[]>`
      select coalesce(sum(tx_bytes), 0)::bigint as tx, coalesce(sum(rx_bytes), 0)::bigint as rx from net_hourly where hour >= ${from} and hour < ${to}`,
    sql<{ from_at: Date; to_at: Date }[]>`select ${from} as from_at, ${to} as to_at`,
    countedByKind(from, to),
  ]);
  const counted = sumKinds(byKind);
  const measured = measuredSince !== null && measuredSince < bounds.to_at;
  // Counted by the app before the card was measured (the month the feature arrived in): carried over as is.
  let before = 0;
  let countedMeasured = counted;
  if (measured && measuredSince > bounds.from_at) {
    before = sumKinds(await countedByKind(sql`${bounds.from_at}`, sql`${measuredSince}`));
    countedMeasured = counted - before;
  }
  const vmTx = Number(net.tx);
  return {
    start: bounds.from_at.toISOString(),
    end: bounds.to_at.toISOString(),
    /** Everything out, as Google counts it (VM card + what the app counted before measuring started). */
    total: measured ? vmTx + before : counted,
    measured,
    /** Only the measured part, so "lain-lain" compares like with like. */
    vmTx,
    vmRx: Number(net.rx),
    counted,
    byKind,
    other: measured ? Math.max(0, vmTx - countedMeasured) : 0,
  };
}

async function measuredSinceDate(): Promise<Date | null> {
  const [row] = await sql<{ first: Date | null }[]>`select min(hour) as first from net_hourly`;
  return row?.first ?? null;
}

export async function egressSummary() {
  const since = await measuredSinceDate();
  const [current, previous, [pace], [days], daily, memory, disk] = await Promise.all([
    monthTotals(0, since),
    monthTotals(-1, since),
    // The pace for the rest of the month: the last 7 days, the card where it has them, else the app's counts.
    sql<{ net: string; net_hours: number; counted: string; first: Date | null }[]>`
      select (select coalesce(sum(tx_bytes), 0) from net_hourly where hour >= now() - interval '7 days')::bigint as net,
        (select count(*) from net_hourly where hour >= now() - interval '7 days')::int as net_hours,
        (select coalesce(sum(bytes), 0) from usage_hourly where hour >= now() - interval '7 days')::bigint as counted,
        (select min(hour) from usage_hourly where hour >= now() - interval '7 days') as first`,
    // Today and yesterday in WIB, the listeners' day.
    sql<{ today_tx: string; yesterday_tx: string; today_rx: string }[]>`
      select
        coalesce(sum(tx_bytes) filter (where hour >= ((now() at time zone ${LOCAL_TZ})::date)::timestamp at time zone ${LOCAL_TZ}), 0)::bigint as today_tx,
        coalesce(sum(tx_bytes) filter (where hour < ((now() at time zone ${LOCAL_TZ})::date)::timestamp at time zone ${LOCAL_TZ}), 0)::bigint as yesterday_tx,
        coalesce(sum(rx_bytes) filter (where hour >= ((now() at time zone ${LOCAL_TZ})::date)::timestamp at time zone ${LOCAL_TZ}), 0)::bigint as today_rx
      from net_hourly where hour >= ((now() at time zone ${LOCAL_TZ})::date - 1)::timestamp at time zone ${LOCAL_TZ}`,
    sql<{ day: string; tx: string; rx: string }[]>`
      select to_char((hour at time zone ${LOCAL_TZ})::date, 'YYYY-MM-DD') as day, sum(tx_bytes)::bigint as tx, sum(rx_bytes)::bigint as rx
      from net_hourly where hour >= ((now() at time zone ${LOCAL_TZ})::date - 13)::timestamp at time zone ${LOCAL_TZ} group by 1 order by 1`,
    memInfo(),
    statfs('/').catch(() => null),
  ]);

  const now = Date.now();
  // A day of card readings is enough for a pace; before that the app's counts (which run a little low) stand in.
  const useNet = pace.net_hours >= 24;
  const paceDays = useNet ? Math.min(7, pace.net_hours / 24) : pace.first ? Math.min(7, Math.max(1, (now - pace.first.getTime()) / 86_400_000)) : 7;
  const perDay = (useNet ? Number(pace.net) : Number(pace.counted)) / paceDays;
  const daysLeft = Math.max(0, (new Date(current.end).getTime() - now) / 86_400_000);
  const diskTotal = disk ? disk.blocks * disk.bsize : null;
  const cloudflare = cloudflareState();
  const recentCloudflare = cloudflare.seenAt !== null && now - new Date(cloudflare.seenAt).getTime() < 3_600_000;

  return {
    freeBytes: FREE_EGRESS_BYTES,
    measuredSince: since?.toISOString() ?? null,
    iface: lastInterface,
    month: current,
    previous,
    perDay,
    paceFromCard: useNet,
    projected: current.total + perDay * daysLeft,
    today: since ? { tx: Number(days.today_tx), rx: Number(days.today_rx) } : null,
    yesterday: since ? { tx: Number(days.yesterday_tx) } : null,
    daily: daily.map((row) => ({ day: row.day, tx: Number(row.tx), rx: Number(row.rx) })),
    cloudflare: { ...cloudflare, active: recentCloudflare },
    freeTier: [
      { label: 'RAM VM setara e2-micro (1 GB)', ok: memory.totalBytes <= FREE_RAM_MAX_BYTES, detail: memory.totalBytes },
      { label: 'Disk maks. 30 GB', ok: diskTotal !== null && diskTotal <= FREE_DISK_MAX_BYTES, detail: diskTotal ?? 0 },
    ],
  };
}

/** The Pacific month that `month` (YYYY-MM) names and the one before, for the monthly report. */
export async function egressForMonth(month: string) {
  const since = await measuredSinceDate();
  const at = (offset: number) => sql`((${`${month}-01`}::text::date + make_interval(months => ${offset}::int))::timestamp at time zone ${BILLING_TZ})`;
  const totals = async (offset: number) => {
    const [[bounds], [net], byKind] = await Promise.all([
      sql<{ from_at: Date; to_at: Date }[]>`select ${at(offset)} as from_at, ${at(offset + 1)} as to_at`,
      sql<{ tx: string; rx: string }[]>`
        select coalesce(sum(tx_bytes), 0)::bigint as tx, coalesce(sum(rx_bytes), 0)::bigint as rx from net_hourly where hour >= ${at(offset)} and hour < ${at(offset + 1)}`,
      countedByKind(at(offset), at(offset + 1)),
    ]);
    const counted = sumKinds(byKind);
    const measured = since !== null && since < bounds.to_at;
    let before = 0;
    if (measured && since > bounds.from_at) before = sumKinds(await countedByKind(sql`${bounds.from_at}`, sql`${since}`));
    const vmTx = Number(net.tx);
    return {
      total: measured ? vmTx + before : counted,
      measured,
      counted,
      vmRx: Number(net.rx),
      other: measured ? Math.max(0, vmTx - (counted - before)) : 0,
    };
  };
  const [current, previous] = await Promise.all([totals(0), totals(-1)]);
  return { freeBytes: FREE_EGRESS_BYTES, measuredSince: since?.toISOString() ?? null, current, previous };
}
