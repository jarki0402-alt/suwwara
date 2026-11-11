import { Router } from 'express';
import { requireAdmin } from '../auth/sessions';
import { listeningNow } from '../connect/connectHub';
import { sql } from '../db/client';
import { listPlaybackReports } from '../diagnostics/playbackReports';
import { flushUsage } from '../metrics/usage';
import { billingForMonth, PRICING } from '../metrics/billing';

/**
 * The admin console's usage detail (Pemakaian, a person's page, Laporan, Sistem history, Podcast numbers). Read from
 * usage_hourly / usage_daily / system_samples: counts, sizes and seconds, never which song or episode. Every answer is
 * aggregated in Postgres, so what crosses the wire is a few hundred numbers whatever the range.
 *
 * Hours are grouped in the admin's own timezone (`tz`, from the browser), checked against Postgres' list so it can only
 * ever be a real zone name.
 */
export const adminStatsRouter = Router();
adminStatsRouter.use('/admin', requireAdmin);

const DEFAULT_TZ = 'Asia/Jakarta';
const KINDS = ['song', 'podcast', 'video'] as const;
type Kind = (typeof KINDS)[number];

async function zoneOf(raw: unknown): Promise<string> {
  if (typeof raw !== 'string' || raw.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(raw)) return DEFAULT_TZ;
  const [row] = await sql<{ ok: number }[]>`select 1 as ok from pg_timezone_names where name = ${raw} limit 1`.catch(() => []);
  return row ? raw : DEFAULT_TZ;
}

const days = (raw: unknown, fallback: number, max: number) => Math.min(Math.max(Math.round(Number(raw)) || fallback, 1), max);

interface KindTotals {
  bytes: number;
  diskBytes: number;
  listenSec: number;
  started: number;
  completed: number;
  skipped: number;
}
const emptyTotals = (): KindTotals => ({ bytes: 0, diskBytes: 0, listenSec: 0, started: 0, completed: 0, skipped: 0 });
const emptyByKind = (): Record<Kind, KindTotals> => ({ song: emptyTotals(), podcast: emptyTotals(), video: emptyTotals() });

interface KindRow {
  kind: string;
  bytes: string;
  disk_bytes: string;
  listen_sec: string;
  started: string;
  completed: string;
  skipped: string;
}
function addRow(target: Record<Kind, KindTotals>, row: KindRow): void {
  const kind = (KINDS as readonly string[]).includes(row.kind) ? (row.kind as Kind) : 'song';
  const into = target[kind];
  into.bytes += Number(row.bytes);
  into.diskBytes += Number(row.disk_bytes);
  into.listenSec += Number(row.listen_sec);
  into.started += Number(row.started);
  into.completed += Number(row.completed);
  into.skipped += Number(row.skipped);
}

// Sums that every query below shares.
const sums = () => sql`sum(bytes)::bigint as bytes, sum(disk_bytes)::bigint as disk_bytes, sum(listen_sec)::bigint as listen_sec,
  sum(started)::bigint as started, sum(completed)::bigint as completed, sum(skipped)::bigint as skipped`;

/** From the start of the local day `back` days before today (so "7 days" is today and the 6 before it), in `tz`. */
const rangeStart = (tz: string, back: number) => sql`(((now() at time zone ${tz})::date - ${back}::int)::timestamp at time zone ${tz})`;

/** Activity per weekday × hour: seconds heard, plus bytes for the hours a device didn't report (older data, video). */
async function heatmap(tz: string, start: ReturnType<typeof rangeStart>, accountId: string | null, end?: ReturnType<typeof rangeStart>) {
  const rows = await sql<{ dow: number; h: number; listen_sec: string; bytes: string }[]>`
    select extract(isodow from hour at time zone ${tz})::int as dow, extract(hour from hour at time zone ${tz})::int as h,
      sum(listen_sec)::bigint as listen_sec, sum(bytes)::bigint as bytes
    from usage_hourly where hour >= ${start} ${end ? sql`and hour < ${end}` : sql``} ${accountId ? sql`and account_id = ${accountId}` : sql``}
    group by 1, 2`;
  // Monday first, as Indonesian calendars are.
  const listen = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const bytes = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const row of rows) {
    listen[row.dow - 1][row.h] = Number(row.listen_sec);
    bytes[row.dow - 1][row.h] = Number(row.bytes);
  }
  return { listen, bytes };
}

async function dailySeries(tz: string, start: ReturnType<typeof rangeStart>, accountId: string | null, end?: ReturnType<typeof rangeStart>) {
  const rows = await sql<(KindRow & { day: string })[]>`
    select to_char((hour at time zone ${tz})::date, 'YYYY-MM-DD') as day, kind, ${sums()}
    from usage_hourly where hour >= ${start} ${end ? sql`and hour < ${end}` : sql``} ${accountId ? sql`and account_id = ${accountId}` : sql``}
    group by 1, 2 order by 1`;
  const byDay = new Map<string, Record<Kind, KindTotals>>();
  for (const row of rows) {
    let entry = byDay.get(row.day);
    if (!entry) byDay.set(row.day, (entry = emptyByKind()));
    addRow(entry, row);
  }
  return [...byDay.entries()].map(([day, kinds]) => ({ day, ...kinds }));
}

/** Everyone who listens (not admins), with their totals per kind over the range, even when that is nothing. */
async function perUser(tz: string, start: ReturnType<typeof rangeStart>, end?: ReturnType<typeof rangeStart>) {
  const [users, kindRows, peaks, activeDays, sessions] = await Promise.all([
    sql<{ account_id: string; username: string; disabled: boolean; created_at: Date }[]>`
      select account_id, username, disabled, created_at from users where role = 'user' order by username`,
    sql<(KindRow & { account_id: string })[]>`
      select account_id, kind, ${sums()} from usage_hourly
      where hour >= ${start} ${end ? sql`and hour < ${end}` : sql``} group by 1, 2`,
    // The hour of day with the most activity: seconds heard, or bytes at ~128 kbps where nothing was reported.
    sql<{ account_id: string; h: number }[]>`
      select distinct on (account_id) account_id, h from (
        select account_id, extract(hour from hour at time zone ${tz})::int as h, sum(listen_sec + bytes / 16000) as weight
        from usage_hourly where hour >= ${start} ${end ? sql`and hour < ${end}` : sql``} group by 1, 2
      ) t order by account_id, weight desc`,
    sql<{ account_id: string; days: number }[]>`
      select account_id, count(distinct (hour at time zone ${tz})::date)::int as days from usage_hourly
      where hour >= ${start} ${end ? sql`and hour < ${end}` : sql``} and (listen_sec > 0 or bytes > 0) group by 1`,
    sql<{ account_id: string; user_agent: string | null; last_seen_at: Date }[]>`
      select account_id, user_agent, last_seen_at from sessions where expires_at > now() order by last_seen_at desc`,
  ]);
  const totals = new Map<string, Record<Kind, KindTotals>>();
  for (const row of kindRows) {
    let entry = totals.get(row.account_id);
    if (!entry) totals.set(row.account_id, (entry = emptyByKind()));
    addRow(entry, row);
  }
  const peakOf = new Map(peaks.map((row) => [row.account_id, row.h]));
  const daysOf = new Map(activeDays.map((row) => [row.account_id, row.days]));
  const nowListening = new Map(listeningNow().map((row) => [row.accountId, row.kinds]));
  return users.map((user) => {
    const own = sessions.filter((row) => row.account_id === user.account_id);
    return {
      accountId: user.account_id,
      username: user.username,
      disabled: user.disabled,
      ...(totals.get(user.account_id) ?? emptyByKind()),
      peakHour: peakOf.get(user.account_id) ?? null,
      activeDays: daysOf.get(user.account_id) ?? 0,
      lastSeen: own[0]?.last_seen_at.toISOString() ?? null,
      devices: own.map((row) => row.user_agent ?? ''),
      listeningOn: nowListening.get(user.account_id) ?? [],
    };
  });
}

async function firstHour(): Promise<string | null> {
  const [row] = await sql<{ first: Date | null }[]>`select min(hour) as first from usage_hourly where listen_sec > 0`;
  return row?.first ? row.first.toISOString() : null;
}

// ---- Pemakaian ---------------------------------------------------------------------------------

adminStatsRouter.get('/admin/usage', async (req, res) => {
  const range = days(req.query.days, 30, 90);
  const tz = await zoneOf(req.query.tz);
  await flushUsage();
  const start = rangeStart(tz, range - 1);
  const [series, map, users, since] = await Promise.all([dailySeries(tz, start, null), heatmap(tz, start, null), perUser(tz, start), firstHour()]);
  const totals = emptyByKind();
  for (const day of series) for (const kind of KINDS) for (const key of Object.keys(totals[kind]) as Array<keyof KindTotals>) totals[kind][key] += day[kind][key];
  res.json({ days: range, tz, pricing: PRICING, listenSince: since, totals, series, heatmap: map, perUser: users });
});

// ---- one person ----------------------------------------------------------------------------------

adminStatsRouter.get('/admin/usage/user/:id', async (req, res) => {
  const range = days(req.query.days, 30, 90);
  const tz = await zoneOf(req.query.tz);
  await flushUsage();
  const [user] = await sql<{ account_id: string; username: string; disabled: boolean; created_at: Date; last_login_at: Date | null }[]>`
    select account_id, username, disabled, created_at, last_login_at from users where account_id = ${req.params.id} and role = 'user'`;
  if (!user) {
    res.status(404).json({ error: 'not_found', message: 'Pengguna tidak ditemukan.' });
    return;
  }
  const start = rangeStart(tz, range - 1);
  const [series, map, hours, sessions] = await Promise.all([
    dailySeries(tz, start, user.account_id),
    heatmap(tz, start, user.account_id),
    // The last 48 hours hour by hour, for "what did today look like".
    sql<(KindRow & { hour: Date })[]>`
      select hour, kind, ${sums()} from usage_hourly
      where account_id = ${user.account_id} and hour >= date_trunc('hour', now()) - interval '47 hours' group by 1, 2 order by 1`,
    sql<{ user_agent: string | null; ip: string | null; created_at: Date; last_seen_at: Date }[]>`
      select user_agent, ip, created_at, last_seen_at from sessions where account_id = ${user.account_id} and expires_at > now() order by last_seen_at desc`,
  ]);
  const totals = emptyByKind();
  for (const day of series) for (const kind of KINDS) for (const key of Object.keys(totals[kind]) as Array<keyof KindTotals>) totals[kind][key] += day[kind][key];
  const hourly = new Map<string, Record<Kind, KindTotals>>();
  for (const row of hours) {
    const key = row.hour.toISOString();
    let entry = hourly.get(key);
    if (!entry) hourly.set(key, (entry = emptyByKind()));
    addRow(entry, row);
  }
  res.json({
    days: range,
    tz,
    pricing: PRICING,
    user: {
      accountId: user.account_id,
      username: user.username,
      disabled: user.disabled,
      createdAt: user.created_at.toISOString(),
      lastLoginAt: user.last_login_at?.toISOString() ?? null,
      listeningOn: listeningNow().find((row) => row.accountId === user.account_id)?.kinds ?? [],
    },
    totals,
    series,
    heatmap: map,
    last48h: [...hourly.entries()].map(([hour, kinds]) => ({ hour, ...kinds })),
    devices: sessions.map((row) => ({ userAgent: row.user_agent ?? '', ip: row.ip, signedInAt: row.created_at.toISOString(), lastSeen: row.last_seen_at.toISOString() })),
    reports: listPlaybackReports().filter((report) => report.username === user.username),
  });
});

// ---- Laporan (one calendar month against the one before) ----------------------------------------

adminStatsRouter.get('/admin/report', async (req, res) => {
  const tz = await zoneOf(req.query.tz);
  await flushUsage();
  const [nowRow] = await sql<{ month: string }[]>`select to_char(now() at time zone ${tz}, 'YYYY-MM') as month`;
  const month = typeof req.query.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month) ? req.query.month : nowRow.month;
  const monthStart = (offset: number) => sql`((${`${month}-01`}::text::date + make_interval(months => ${offset}::int))::timestamp at time zone ${tz})`;

  async function summary(offset: number) {
    const start = monthStart(offset);
    const end = monthStart(offset + 1);
    const [kinds, [active], [daily]] = await Promise.all([
      sql<KindRow[]>`select kind, ${sums()} from usage_hourly where hour >= ${start} and hour < ${end} group by 1`,
      sql<{ users: number }[]>`
        select count(distinct account_id)::int as users from usage_hourly where hour >= ${start} and hour < ${end} and (listen_sec > 0 or bytes > 0)`,
      // usage_daily keeps 400 days, so a month older than the hourly table's 90 still has its bytes.
      sql<{ bytes: string }[]>`
        select coalesce(sum(audio_bytes + video_bytes), 0)::bigint as bytes from usage_daily
        where day >= (${`${month}-01`}::text::date + make_interval(months => ${offset}::int))::date
          and day < (${`${month}-01`}::text::date + make_interval(months => ${offset + 1}::int))::date`,
    ]);
    const totals = emptyByKind();
    for (const row of kinds) addRow(totals, row);
    return { totals, activeUsers: active?.users ?? 0, dailyTableBytes: Number(daily?.bytes ?? 0) };
  }

  const [current, previous, series, map, users, months, resolve, gcp] = await Promise.all([
    summary(0),
    summary(-1),
    dailySeries(tz, monthStart(0), null, monthStart(1)),
    heatmap(tz, monthStart(0), null, monthStart(1)),
    perUser(tz, monthStart(0), monthStart(1)),
    sql<{ month: string }[]>`
      select distinct to_char(day, 'YYYY-MM') as month from usage_daily
      union select to_char(now() at time zone ${tz}, 'YYYY-MM') order by 1 desc limit 24`,
    // Loading times for the month, from the 5-minute samples (kept 14 days, so only the most recent part of a month).
    sql<{ resolves: string; failures: string; avg_ms: number | null; samples: number }[]>`
      select coalesce(sum(resolves), 0)::bigint as resolves, coalesce(sum(resolve_failures), 0)::bigint as failures,
        round(sum(resolve_avg_ms * resolves)::numeric / nullif(sum(case when resolve_avg_ms is null then 0 else resolves end), 0))::int as avg_ms,
        count(*)::int as samples
      from system_samples where at >= ${monthStart(0)} and at < ${monthStart(1)}`,
    // The bill for the same month, cut where Google cuts it (Pacific time), not in WIB.
    billingForMonth(month),
  ]);
  res.json({
    month,
    tz,
    pricing: PRICING,
    gcp,
    months: months.map((row) => row.month),
    current,
    previous,
    series,
    heatmap: map,
    perUser: users,
    resolve: resolve[0]
      ? { count: Number(resolve[0].resolves), failures: Number(resolve[0].failures), avgMs: resolve[0].avg_ms, samples: resolve[0].samples }
      : null,
  });
});

// ---- Sistem history ------------------------------------------------------------------------------

adminStatsRouter.get('/admin/system/history', async (req, res) => {
  const hours = Math.min(Math.max(Math.round(Number(req.query.hours)) || 24, 1), 14 * 24);
  // At most a few hundred points whatever the range: 5-minute samples for a day, half hours for a week, hours beyond.
  const bucketSec = hours <= 24 ? 300 : hours <= 168 ? 1800 : 3600;
  const rows = await sql<
    {
      at: Date;
      ram: number;
      swap: string;
      load: number;
      disk: number | null;
      rss: string;
      cache_files: number | null;
      cache_bytes: string | null;
      db_bytes: string | null;
      resolves: string;
      failures: string;
      avg_ms: number | null;
      queue: number;
    }[]
  >`
    select to_timestamp(floor(extract(epoch from at) / ${bucketSec}::int) * ${bucketSec}::int) as at,
      avg(ram_used_bytes::float8 / nullif(ram_total_bytes, 0)) as ram,
      max(swap_used_bytes)::bigint as swap,
      avg(load1 / nullif(cpus, 0)) as load,
      max(disk_used_bytes::float8 / nullif(disk_total_bytes, 0)) as disk,
      max(rss_bytes)::bigint as rss,
      max(cache_files) as cache_files,
      max(cache_bytes)::bigint as cache_bytes,
      max(db_bytes)::bigint as db_bytes,
      sum(resolves)::bigint as resolves,
      sum(resolve_failures)::bigint as failures,
      round(sum(resolve_avg_ms * resolves)::numeric / nullif(sum(case when resolve_avg_ms is null then 0 else resolves end), 0))::int as avg_ms,
      max(queue_pending)::int as queue
    from system_samples where at > now() - make_interval(hours => ${hours}::int)
    group by 1 order by 1`;
  res.json({
    hours,
    bucketSec,
    samples: rows.map((row) => ({
      at: row.at.toISOString(),
      ram: row.ram,
      swapBytes: Number(row.swap),
      load: row.load,
      disk: row.disk,
      rssBytes: Number(row.rss),
      cacheFiles: row.cache_files,
      cacheBytes: row.cache_bytes === null ? null : Number(row.cache_bytes),
      dbBytes: row.db_bytes === null ? null : Number(row.db_bytes),
      resolves: Number(row.resolves),
      failures: Number(row.failures),
      avgMs: row.avg_ms,
      queue: row.queue,
    })),
  });
});
