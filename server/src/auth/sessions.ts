import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { sql } from '../db/client';
import { parseCookie } from './cookie';

export { parseCookie };

export const SESSION_COOKIE = 'suwwara_session';
const SESSION_DAYS = 90;
// Every audio chunk is its own request, so the session check must not be a database round trip each time: answers are
// kept in memory for a short while. Revoking or disabling forgets them at once (same process), so the delay only ever
// applies to a change made outside this process. Hard-capped like every cache here (CLAUDE.md rule 1).
const CACHE_TTL_MS = 60_000;
const MAX_CACHED = 500;
// Sliding expiry is written at most this often per session, not on every request.
const TOUCH_AFTER_MS = 60 * 60 * 1000;

export interface SessionInfo {
  tokenHash: string;
  accountId: string;
  username: string;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionInfo;
  }
}

interface CacheEntry {
  info: SessionInfo;
  checkedAt: number;
  touchedAt: number;
}
const cache = new Map<string, CacheEntry>();

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** The real client IP: behind Cloudflare the socket address is the tunnel's, Cloudflare puts the visitor's in a header. */
export function clientIp(req: Request): string {
  const forwarded = req.headers['cf-connecting-ip'];
  return (typeof forwarded === 'string' && forwarded) || req.socket.remoteAddress || 'unknown';
}

export function sessionCookie(token: string, req: Request, maxAgeSec = SESSION_DAYS * 24 * 60 * 60): string {
  // Secure only when the visitor is on HTTPS (Cloudflare says so in x-forwarded-proto) — plain http://localhost must still work.
  const secure = String(req.headers['x-forwarded-proto'] ?? '').includes('https') ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export async function createSession(accountId: string, req: Request): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
  await sql`
    insert into sessions (token_hash, account_id, user_agent, ip, expires_at)
    values (${hashToken(token)}, ${accountId}, ${userAgent}, ${clientIp(req)}, now() + make_interval(days => ${SESSION_DAYS}))
  `;
  return token;
}

async function lookup(tokenHash: string): Promise<SessionInfo | null> {
  const now = Date.now();
  const cached = cache.get(tokenHash);
  if (cached && now - cached.checkedAt < CACHE_TTL_MS) return cached.info;

  const [row] = await sql<{ account_id: string; username: string; role: string; must_change_password: boolean; last_seen_ms: string }[]>`
    select s.account_id, u.username, u.role, u.must_change_password, (extract(epoch from s.last_seen_at) * 1000)::bigint as last_seen_ms
    from sessions s join users u on u.account_id = s.account_id
    where s.token_hash = ${tokenHash} and s.expires_at > now() and not u.disabled
  `;
  if (!row) {
    cache.delete(tokenHash);
    return null;
  }
  const info: SessionInfo = {
    tokenHash,
    accountId: row.account_id,
    username: row.username,
    role: row.role === 'admin' ? 'admin' : 'user',
    mustChangePassword: row.must_change_password,
  };
  let touchedAt = Number(row.last_seen_ms);
  if (now - touchedAt > TOUCH_AFTER_MS) {
    touchedAt = now;
    void sql`update sessions set last_seen_at = now(), expires_at = now() + make_interval(days => ${SESSION_DAYS}) where token_hash = ${tokenHash}`.catch(() => {});
  }
  cache.delete(tokenHash);
  cache.set(tokenHash, { info, checkedAt: now, touchedAt });
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return info;
}

/** Forget cached answers — after a revoke, a role change, a disable, a password change. */
export function forgetSessions(match: (info: SessionInfo) => boolean): void {
  for (const [hash, entry] of cache) if (match(entry.info)) cache.delete(hash);
}

export async function revokeSession(tokenHash: string): Promise<void> {
  cache.delete(tokenHash);
  await sql`delete from sessions where token_hash = ${tokenHash}`;
}

export async function revokeAccountSessions(accountId: string, exceptTokenHash?: string): Promise<void> {
  forgetSessions((info) => info.accountId === accountId && info.tokenHash !== exceptTokenHash);
  await sql`delete from sessions where account_id = ${accountId} and token_hash <> ${exceptTokenHash ?? ''}`;
}

/** The session behind this request's cookie, or null. Throws only when the database itself is unreachable. */
export async function sessionFromRequest(req: Request): Promise<SessionInfo | null> {
  const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
  return token ? lookup(hashToken(token)) : null;
}

/** Everything under /api except sign-in itself needs a valid session — audio, images' API, Jam, Connect, all of it. */
export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  let info: SessionInfo | null;
  try {
    info = await sessionFromRequest(req);
  } catch {
    // Not "signed out": the database is down. A 401 here would log every device out during a restart.
    res.status(503).json({ error: 'auth_unavailable', message: 'Layanan sedang tidak tersedia.' });
    return;
  }
  if (!info) {
    res.status(401).json({ error: 'auth_required', message: 'Silakan masuk dulu.' });
    return;
  }
  if (info.mustChangePassword) {
    res.status(403).json({ error: 'password_change_required', message: 'Ganti kata sandi sementara dulu.' });
    return;
  }
  req.session = info;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.role !== 'admin') {
    res.status(403).json({ error: 'forbidden', message: 'Khusus admin.' });
    return;
  }
  next();
}
