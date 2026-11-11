import { statfs } from 'node:fs/promises';
import os from 'node:os';
import { Router } from 'express';
import { clearPlaybackReports, listPlaybackReports } from '../diagnostics/playbackReports';
import { audit } from '../auth/audit';
import { loginLimiter } from '../auth/loginLimiter';
import { generatePassword, hashPassword } from '../auth/password';
import { clientIp, forgetSessions, requireAdmin, revokeAccountSessions } from '../auth/sessions';
import { createUser, normalizeUsername, UsernameTakenError } from '../auth/users';
import { listeningNow, onlineDeviceCount } from '../connect/connectHub';
import { sql } from '../db/client';
import { roomCount } from '../jam/roomManager';
import { flushUsage } from '../metrics/usage';
import { resolveSummary } from '../metrics/resolveStats';
import { memInfo } from '../metrics/systemSamples';
import { billingSummary } from '../metrics/billing';
import { diskCacheStats } from '../youtube/diskCache';
import { resolveQueueState } from '../youtube/stream';

/**
 * The admin dashboard's API. Everything here is counts, sizes and account management — never what anyone listens to.
 * Mounted before authRouter (see index.ts), and guarded with a PATH-scoped requireAdmin: a router-wide one would answer 403
 * for every non-admin route registered after it.
 */

export const adminRouter = Router();
adminRouter.use('/admin', requireAdmin);

const actor = (req: { session?: { username: string } }) => req.session?.username ?? null;

// ---- users -----------------------------------------------------------------------------------

adminRouter.get('/admin/users', async (_req, res) => {
  await flushUsage();
  const rows = await sql`
    select u.account_id as id, u.username, u.role, u.disabled, u.must_change_password, u.created_at, u.last_login_at,
      (select count(*)::int from sessions s where s.account_id = u.account_id and s.expires_at > now()) as sessions,
      (select count(*)::int from devices d where d.account_id = u.account_id) as devices,
      coalesce((select sum(audio_bytes + video_bytes) from usage_daily x where x.account_id = u.account_id and x.day = current_date), 0)::bigint as today_bytes,
      coalesce((select sum(audio_bytes + video_bytes) from usage_daily x where x.account_id = u.account_id and x.day > current_date - 30), 0)::bigint as month_bytes
    from users u order by u.created_at
  `;
  res.json({ users: rows.map((row) => ({ ...row, today_bytes: Number(row.today_bytes), month_bytes: Number(row.month_bytes) })) });
});

adminRouter.post('/admin/users', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  const legacyAccountId = typeof req.body?.legacyAccountId === 'string' && req.body.legacyAccountId ? req.body.legacyAccountId : null;
  if (!username) {
    res.status(400).json({ error: 'invalid', message: 'Nama pengguna 3–32 karakter: huruf kecil, angka, titik, minus, garis bawah.' });
    return;
  }
  if (legacyAccountId && role === 'admin') {
    res.status(400).json({ error: 'invalid', message: 'Akun admin tidak memakai pustaka musik.' });
    return;
  }
  if (legacyAccountId) {
    // Only an account from before sign-in existed, that nobody has claimed yet.
    const [free] = await sql<{ id: string }[]>`select a.id from accounts a where a.id = ${legacyAccountId} and not exists (select 1 from users u where u.account_id = a.id)`;
    if (!free) {
      res.status(400).json({ error: 'invalid', message: 'Akun lama itu tidak ditemukan atau sudah dipakai.' });
      return;
    }
  }
  const temporaryPassword = generatePassword();
  try {
    const id = await createUser({ username, password: temporaryPassword, role, mustChangePassword: true, accountId: legacyAccountId ?? undefined });
    audit('admin_user_created', { accountId: id, username: actor(req), ip: clientIp(req), detail: `${username} (${role})${legacyAccountId ? ' + pustaka lama' : ''}` });
    res.status(201).json({ id, username, role, temporaryPassword });
  } catch (error) {
    if (error instanceof UsernameTakenError) res.status(409).json({ error: 'taken', message: 'Nama pengguna itu sudah dipakai.' });
    else res.status(502).json({ error: 'failed', message: 'Gagal membuat pengguna.' });
  }
});

/**
 * Accounts from before sign-in that still hold a library (liked songs / playlists) and belong to nobody: what the owner's own
 * playlists, or a friend's, became. Counts and up to three playlist names — enough to recognise whose it is — never the songs.
 */
adminRouter.get('/admin/legacy-accounts', async (_req, res) => {
  const rows = await sql<{ id: string; liked: number; playlists: number; devices: number; last_seen: Date | null; names: string[] | null }[]>`
    select a.id,
      jsonb_array_length(l.liked_songs)::int as liked,
      jsonb_array_length(l.playlists)::int as playlists,
      (select count(*)::int from devices d where d.account_id = a.id) as devices,
      (select max(d.last_seen_at) from devices d where d.account_id = a.id) as last_seen,
      (select array_agg(p->>'name') from (select p from jsonb_array_elements(l.playlists) p limit 3) x) as names
    from accounts a join library_snapshots l on l.account_id = a.id
    where not exists (select 1 from users u where u.account_id = a.id)
      and jsonb_array_length(l.liked_songs) + jsonb_array_length(l.playlists) > 0
    order by jsonb_array_length(l.liked_songs) + jsonb_array_length(l.playlists) desc, 1 limit 50
  `;
  res.json({ accounts: rows.map((row) => ({ id: row.id, liked: row.liked, playlists: row.playlists, devices: row.devices, lastSeen: row.last_seen, playlistNames: row.names ?? [] })) });
});

async function targetUser(id: string): Promise<{ account_id: string; username: string; role: string; disabled: boolean } | null> {
  const [user] = await sql<{ account_id: string; username: string; role: string; disabled: boolean }[]>`select account_id, username, role, disabled from users where account_id = ${id}`;
  return user ?? null;
}

/** True when this change would leave no enabled admin (locking everyone out of this very dashboard). */
async function wouldLoseLastAdmin(id: string): Promise<boolean> {
  const [{ count }] = await sql<{ count: string }[]>`select count(*) from users where role = 'admin' and not disabled and account_id <> ${id}`;
  return Number(count) === 0;
}

adminRouter.post('/admin/users/:id/reset-password', async (req, res) => {
  const user = await targetUser(String(req.params.id));
  if (!user) return void res.status(404).json({ error: 'not_found', message: 'Pengguna tidak ditemukan.' });
  const temporaryPassword = generatePassword();
  await sql`update users set password_hash = ${await hashPassword(temporaryPassword)}, must_change_password = true where account_id = ${user.account_id}`;
  await revokeAccountSessions(user.account_id);
  audit('admin_password_reset', { accountId: user.account_id, username: actor(req), ip: clientIp(req), detail: user.username });
  res.json({ temporaryPassword });
});

adminRouter.patch('/admin/users/:id', async (req, res) => {
  const user = await targetUser(String(req.params.id));
  if (!user) return void res.status(404).json({ error: 'not_found', message: 'Pengguna tidak ditemukan.' });
  const disabled = typeof req.body?.disabled === 'boolean' ? req.body.disabled : user.disabled;
  const role = req.body?.role === 'admin' || req.body?.role === 'user' ? req.body.role : user.role;
  const losesAdmin = user.role === 'admin' && !user.disabled && (disabled || role !== 'admin');
  if (user.account_id === req.session!.accountId && (disabled || role !== 'admin')) {
    return void res.status(400).json({ error: 'self', message: 'Kamu tidak bisa menonaktifkan atau menurunkan akunmu sendiri.' });
  }
  if (losesAdmin && (await wouldLoseLastAdmin(user.account_id))) {
    return void res.status(400).json({ error: 'last_admin', message: 'Harus tetap ada minimal satu admin aktif.' });
  }
  const promoted = role === 'admin' && user.role !== 'admin';
  // An admin needs a stronger password than an ordinary account: on promotion the current one is not trusted, the next sign-in must choose a new one.
  await sql`update users set disabled = ${disabled}, role = ${role}, must_change_password = must_change_password or ${promoted} where account_id = ${user.account_id}`;
  forgetSessions((info) => info.accountId === user.account_id);
  if (disabled || promoted) await revokeAccountSessions(user.account_id);
  audit('admin_user_updated', { accountId: user.account_id, username: actor(req), ip: clientIp(req), detail: `${user.username}: disabled=${disabled} role=${role}` });
  res.status(204).end();
});

adminRouter.post('/admin/users/:id/sign-out', async (req, res) => {
  const user = await targetUser(String(req.params.id));
  if (!user) return void res.status(404).json({ error: 'not_found', message: 'Pengguna tidak ditemukan.' });
  await revokeAccountSessions(user.account_id, user.account_id === req.session!.accountId ? req.session!.tokenHash : undefined);
  audit('admin_signed_out', { accountId: user.account_id, username: actor(req), ip: clientIp(req), detail: user.username });
  res.status(204).end();
});

adminRouter.delete('/admin/users/:id', async (req, res) => {
  const user = await targetUser(String(req.params.id));
  if (!user) return void res.status(404).json({ error: 'not_found', message: 'Pengguna tidak ditemukan.' });
  if (user.account_id === req.session!.accountId) return void res.status(400).json({ error: 'self', message: 'Kamu tidak bisa menghapus akunmu sendiri.' });
  if (user.role === 'admin' && !user.disabled && (await wouldLoseLastAdmin(user.account_id))) {
    return void res.status(400).json({ error: 'last_admin', message: 'Harus tetap ada minimal satu admin aktif.' });
  }
  await revokeAccountSessions(user.account_id);
  await sql`delete from accounts where id = ${user.account_id}`; // cascades: user, sessions, devices, library, profile, usage
  audit('admin_user_deleted', { username: actor(req), ip: clientIp(req), detail: user.username });
  res.status(204).end();
});

// ---- usage / overview / system -----------------------------------------------------------------

// /admin/usage (and a person's detail, the monthly report, system history) live in adminStats.ts.

adminRouter.get('/admin/overview', async (_req, res) => {
  await flushUsage();
  const playing = listeningNow();
  const names = playing.length
    ? await sql<{ account_id: string; username: string }[]>`select account_id, username from users where account_id in ${sql(playing.map((row) => row.accountId))}`
    : [];
  const nameOf = new Map(names.map((row) => [row.account_id, row.username]));
  // Today and yesterday by kind, in WIB (the listeners' day), for the "vs kemarin" figures.
  const days = await sql<{ day: string; kind: string; bytes: string; listen_sec: string; started: string }[]>`
    select case when (hour at time zone 'Asia/Jakarta')::date = (now() at time zone 'Asia/Jakarta')::date then 'today' else 'yesterday' end as day,
      kind, sum(bytes)::bigint as bytes, sum(listen_sec)::bigint as listen_sec, sum(started)::bigint as started
    from usage_hourly where hour >= ((now() at time zone 'Asia/Jakarta')::date - 1)::timestamp at time zone 'Asia/Jakarta'
    group by 1, 2`;
  const dayTotals = (which: string) => {
    const pick = days.filter((row) => row.day === which);
    const sum = (kind: string, field: 'bytes' | 'listen_sec' | 'started') => pick.filter((row) => row.kind === kind).reduce((total, row) => total + Number(row[field]), 0);
    return {
      songBytes: sum('song', 'bytes'),
      podcastBytes: sum('podcast', 'bytes'),
      videoBytes: sum('video', 'bytes'),
      songSec: sum('song', 'listen_sec'),
      podcastSec: sum('podcast', 'listen_sec'),
      plays: sum('song', 'started') + sum('podcast', 'started'),
    };
  };
  const [counts] = await sql<{ users: number; disabled: number; sessions: number; active_now: number; today_bytes: string; month_bytes: string }[]>`
    select
      (select count(*)::int from users) as users,
      (select count(*)::int from users where disabled) as disabled,
      (select count(*)::int from sessions where expires_at > now()) as sessions,
      (select count(distinct account_id)::int from sessions where last_seen_at > now() - interval '15 minutes' and expires_at > now()) as active_now,
      coalesce((select sum(audio_bytes + video_bytes) from usage_daily where day = current_date), 0)::bigint as today_bytes,
      coalesce((select sum(audio_bytes + video_bytes) from usage_daily where day > current_date - 30), 0)::bigint as month_bytes`;
  res.json({
    users: counts.users,
    disabled: counts.disabled,
    sessions: counts.sessions,
    activeUsers: counts.active_now,
    todayBytes: Number(counts.today_bytes),
    monthBytes: Number(counts.month_bytes),
    onlineDevices: onlineDeviceCount(),
    jamRooms: roomCount(),
    resolve: { ...resolveSummary(), queue: resolveQueueState() },
    locked: loginLimiter.lockedNow().length,
    // What the Google Cloud bill should come to this month (metrics/billing.ts).
    billing: await billingSummary(),
    listeningNow: playing.map((row) => ({ username: nameOf.get(row.accountId) ?? '?', kinds: row.kinds })),
    today: dayTotals('today'),
    yesterday: dayTotals('yesterday'),
  });
});

adminRouter.get('/admin/system', async (_req, res) => {
  const memory = process.memoryUsage();
  const [disk, cache] = await Promise.all([statfs('/').catch(() => null), diskCacheStats()]);
  const [db] = await sql<{ size: string }[]>`select pg_database_size(current_database())::bigint as size`;
  const tables = await sql<{ name: string; bytes: string; rows: number }[]>`
    select c.relname as name, pg_total_relation_size(c.oid)::bigint as bytes, c.reltuples::int as rows
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = 'public' order by 2 desc limit 8`;
  res.json({
    host: { ...(await memInfo()), load: os.loadavg(), cpus: os.cpus().length, uptimeSec: Math.round(os.uptime()) },
    process: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, uptimeSec: Math.round(process.uptime()), node: process.version },
    disk: disk ? { totalBytes: disk.blocks * disk.bsize, freeBytes: disk.bavail * disk.bsize } : null,
    database: { sizeBytes: Number(db.size), tables: tables.map((row) => ({ name: row.name, bytes: Number(row.bytes), rows: Math.max(row.rows, 0) })) },
    audioCache: cache,
  });
});

// ---- security --------------------------------------------------------------------------------

adminRouter.get('/admin/audit', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
  const rows = await sql`select id, at, event, username, ip, detail from audit_log order by id desc limit ${limit}`;
  res.json({ events: rows, locked: loginLimiter.lockedNow() });
});

// ---- playback reports (diagnostics/playbackReports.ts) -----------------------------------------

adminRouter.get('/admin/playback-reports', (_req, res) => {
  res.json({ reports: listPlaybackReports() });
});

adminRouter.delete('/admin/playback-reports', (_req, res) => {
  clearPlaybackReports();
  res.status(204).end();
});

adminRouter.post('/admin/locks/unlock', (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key : '';
  if (key) {
    loginLimiter.unlock(key);
    audit('admin_unlock', { username: actor(req), ip: clientIp(req), detail: key });
  }
  res.status(204).end();
});
