import { Router, type Request, type Response } from 'express';
import { sql } from '../db/client';
import { audit } from '../auth/audit';
import { loginLimiter } from '../auth/loginLimiter';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../auth/password';
import {
  clientIp,
  createSession,
  forgetSessions,
  hashToken,
  parseCookie,
  revokeAccountSessions,
  revokeSession,
  sessionCookie,
  sessionFromRequest,
  SESSION_COOKIE,
  type SessionInfo,
} from '../auth/sessions';
import { normalizeUsername, passwordProblem } from '../auth/users';

/** Sign-in, sign-out and "who am I" — mounted BEFORE the session gate, so each route here does its own checks. */
export const sessionRouter = Router();

const publicUser = (info: Pick<SessionInfo, 'username' | 'role' | 'mustChangePassword'>) => ({
  username: info.username,
  role: info.role,
  mustChangePassword: info.mustChangePassword,
});

async function currentSession(req: Request, res: Response): Promise<SessionInfo | null> {
  try {
    const info = await sessionFromRequest(req);
    if (!info) res.status(401).json({ error: 'auth_required', message: 'Silakan masuk dulu.' });
    return info;
  } catch {
    res.status(503).json({ error: 'auth_unavailable', message: 'Layanan sedang tidak tersedia.' });
    return null;
  }
}

sessionRouter.get('/auth/session', async (req, res) => {
  const info = await currentSession(req, res);
  if (info) res.json({ user: publicUser(info) });
});

sessionRouter.post('/auth/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ip = clientIp(req);
  if (!username || !password || password.length > 128) {
    res.status(400).json({ error: 'invalid', message: 'Isi nama pengguna dan kata sandi.' });
    return;
  }

  const limit = loginLimiter.check(ip, username);
  if (limit.locked) {
    audit('login_locked', { username, ip });
    res.status(429).json({ error: 'locked', retryAfterSec: limit.retryAfterSec, message: `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(limit.retryAfterSec / 60)} menit.` });
    return;
  }

  try {
    const [user] = await sql<{ account_id: string; password_hash: string; role: string; disabled: boolean; must_change_password: boolean }[]>`
      select account_id, password_hash, role, disabled, must_change_password from users where username = ${username}
    `;
    const valid = user ? await verifyPassword(password, user.password_hash) : await verifyAgainstDummy(password);
    if (!user || !valid || user.disabled) {
      loginLimiter.fail(ip, username);
      audit('login_failed', { username, ip, detail: user?.disabled ? 'disabled' : undefined });
      // The same answer whatever was wrong — the form must not reveal which usernames exist.
      res.status(401).json({ error: 'invalid_credentials', message: 'Nama pengguna atau kata sandi salah.' });
      return;
    }

    loginLimiter.reset(ip, username);
    const token = await createSession(user.account_id, req);
    void sql`update users set last_login_at = now() where account_id = ${user.account_id}`.catch(() => {});
    audit('login_ok', { accountId: user.account_id, username, ip });
    res.setHeader('Set-Cookie', sessionCookie(token, req));
    res.json({ user: publicUser({ username, role: user.role === 'admin' ? 'admin' : 'user', mustChangePassword: user.must_change_password }) });
  } catch {
    res.status(503).json({ error: 'auth_unavailable', message: 'Layanan sedang tidak tersedia. Coba lagi sebentar.' });
  }
});

sessionRouter.post('/auth/logout', async (req, res) => {
  const token = parseCookie(req.headers.cookie, SESSION_COOKIE);
  if (token) await revokeSession(hashToken(token)).catch(() => {});
  res.setHeader('Set-Cookie', sessionCookie('', req, 0));
  res.status(204).end();
});

sessionRouter.post('/auth/password', async (req, res) => {
  const info = await currentSession(req, res);
  if (!info) return;
  const current = typeof req.body?.current === 'string' ? req.body.current : '';
  const next = req.body?.next;
  const problem = passwordProblem(next);
  if (problem) {
    res.status(400).json({ error: 'weak_password', message: problem });
    return;
  }
  const [user] = await sql<{ password_hash: string }[]>`select password_hash from users where account_id = ${info.accountId}`;
  if (!user || !(await verifyPassword(current, user.password_hash))) {
    audit('password_change_failed', { accountId: info.accountId, username: info.username, ip: clientIp(req) });
    res.status(403).json({ error: 'invalid_credentials', message: 'Kata sandi saat ini salah.' });
    return;
  }
  await sql`update users set password_hash = ${await hashPassword(next as string)}, must_change_password = false where account_id = ${info.accountId}`;
  forgetSessions((cached) => cached.accountId === info.accountId);
  // Every OTHER device is signed out — if the old password was in someone else's hands, this is what cuts them off.
  await revokeAccountSessions(info.accountId, info.tokenHash);
  audit('password_changed', { accountId: info.accountId, username: info.username, ip: clientIp(req) });
  res.json({ user: publicUser({ ...info, mustChangePassword: false }) });
});

/** The browsers/PWAs currently signed in to this account. The public id is a prefix of the token hash, never the token. */
sessionRouter.get('/auth/sessions', async (req, res) => {
  const info = await currentSession(req, res);
  if (!info) return;
  const rows = await sql<{ id: string; user_agent: string | null; created_at: Date; last_seen_at: Date; token_hash: string }[]>`
    select substr(token_hash, 1, 12) as id, token_hash, user_agent, created_at, last_seen_at
    from sessions where account_id = ${info.accountId} and expires_at > now() order by last_seen_at desc
  `;
  res.json({ sessions: rows.map((row) => ({ id: row.id, current: row.token_hash === info.tokenHash, userAgent: row.user_agent, createdAt: row.created_at, lastSeenAt: row.last_seen_at })) });
});

sessionRouter.delete('/auth/sessions/:id', async (req, res) => {
  const info = await currentSession(req, res);
  if (!info) return;
  const id = String(req.params.id);
  const [row] = await sql<{ token_hash: string }[]>`select token_hash from sessions where account_id = ${info.accountId} and substr(token_hash, 1, 12) = ${id}`;
  if (row) await revokeSession(row.token_hash);
  res.status(204).end();
});
