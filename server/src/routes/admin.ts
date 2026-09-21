import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import { Router } from 'express';
import { audit } from '../auth/audit';
import { loginLimiter } from '../auth/loginLimiter';
import { generatePassword, hashPassword } from '../auth/password';
import { clientIp, forgetSessions, requireAdmin, revokeAccountSessions } from '../auth/sessions';
import { createUser, normalizeUsername, UsernameTakenError } from '../auth/users';
import { onlineDeviceCount } from '../connect/connectHub';
import { sql } from '../db/client';
import { roomCount } from '../jam/roomManager';
import { flushUsage } from '../metrics/usage';
import { resolveSummary } from '../metrics/resolveStats';
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
      coalesce((select sum(audio_bytes) from usage_daily x where x.account_id = u.account_id and x.day = current_date), 0)::bigint as today_bytes,
      coalesce((select sum(audio_bytes) from usage_daily x where x.account_id = u.account_id and x.day > current_date - 30), 0)::bigint as month_bytes
    from users u order by u.created_at
  `;
  res.json({ users: rows.map((row) => ({ ...row, today_bytes: Number(row.today_bytes), month_bytes: Number(row.month_bytes) })) });
});

adminRouter.post('/admin/users', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  if (!username) {
    res.status(400).json({ error: 'invalid', message: 'Nama pengguna 3–32 karakter: huruf kecil, angka, titik, minus, garis bawah.' });
    return;
  }
  const temporaryPassword = generatePassword();
  try {
    const id = await createUser({ username, password: temporaryPassword, role, mustChangePassword: true });
    audit('admin_user_created', { accountId: id, username: actor(req), ip: clientIp(req), detail: `${username} (${role})` });
    res.status(201).json({ id, username, role, temporaryPassword });
  } catch (error) {
    if (error instanceof UsernameTakenError) res.status(409).json({ error: 'taken', message: 'Nama pengguna itu sudah dipakai.' });
    else res.status(502).json({ error: 'failed', message: 'Gagal membuat pengguna.' });
  }
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
  await sql`update users set disabled = ${disabled}, role = ${role} where account_id = ${user.account_id}`;
  forgetSessions((info) => info.accountId === user.account_id);
  if (disabled) await revokeAccountSessions(user.account_id);
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

adminRouter.get('/admin/usage', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
  await flushUsage();
  const series = await sql<{ day: string; bytes: string; requests: number }[]>`
    select to_char(day, 'YYYY-MM-DD') as day, sum(audio_bytes)::bigint as bytes, sum(audio_requests)::int as requests
    from usage_daily where day > current_date - ${days}::int group by day order by day`;
  const perUser = await sql<{ username: string; bytes: string; requests: number }[]>`
    select u.username, sum(x.audio_bytes)::bigint as bytes, sum(x.audio_requests)::int as requests
    from usage_daily x join users u on u.account_id = x.account_id
    where x.day > current_date - ${days}::int group by u.username order by 2 desc limit 50`;
  res.json({
    days,
    series: series.map((row) => ({ day: row.day, bytes: Number(row.bytes), requests: row.requests })),
    perUser: perUser.map((row) => ({ username: row.username, bytes: Number(row.bytes), requests: row.requests })),
  });
});

adminRouter.get('/admin/overview', async (_req, res) => {
  await flushUsage();
  const [counts] = await sql<{ users: number; disabled: number; sessions: number; active_now: number; today_bytes: string; month_bytes: string }[]>`
    select
      (select count(*)::int from users) as users,
      (select count(*)::int from users where disabled) as disabled,
      (select count(*)::int from sessions where expires_at > now()) as sessions,
      (select count(distinct account_id)::int from sessions where last_seen_at > now() - interval '15 minutes' and expires_at > now()) as active_now,
      coalesce((select sum(audio_bytes) from usage_daily where day = current_date), 0)::bigint as today_bytes,
      coalesce((select sum(audio_bytes) from usage_daily where day > current_date - 30), 0)::bigint as month_bytes`;
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
  });
});

async function memInfo(): Promise<{ totalBytes: number; availableBytes: number; swapUsedBytes: number }> {
  try {
    const text = await readFile('/proc/meminfo', 'utf8');
    const kb = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0) * 1024;
    return { totalBytes: kb('MemTotal'), availableBytes: kb('MemAvailable'), swapUsedBytes: kb('SwapTotal') - kb('SwapFree') };
  } catch {
    return { totalBytes: os.totalmem(), availableBytes: os.freemem(), swapUsedBytes: 0 };
  }
}

adminRouter.get('/admin/system', async (_req, res) => {
  const memory = process.memoryUsage();
  const disk = await statfs('/').catch(() => null);
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
  });
});

// ---- security --------------------------------------------------------------------------------

adminRouter.get('/admin/audit', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
  const rows = await sql`select id, at, event, username, ip, detail from audit_log order by id desc limit ${limit}`;
  res.json({ events: rows, locked: loginLimiter.lockedNow() });
});

adminRouter.post('/admin/locks/unlock', (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key : '';
  if (key) {
    loginLimiter.unlock(key);
    audit('admin_unlock', { username: actor(req), ip: clientIp(req), detail: key });
  }
  res.status(204).end();
});
