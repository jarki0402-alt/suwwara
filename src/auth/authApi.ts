/** The sign-in endpoints (server/src/routes/session.ts). Plain fetches: same-origin, so the session cookie rides along by itself. */
export interface AuthUser {
  username: string;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
}

export interface SessionRow {
  id: string;
  current: boolean;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export type SessionCheck = { kind: 'signed-in'; user: AuthUser } | { kind: 'signed-out' } | { kind: 'unreachable' };
export type ActionResult = { ok: true; user?: AuthUser } | { ok: false; message: string; retryAfterSec?: number };

const TIMEOUT_MS = 10_000;

async function call(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(path, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkSession(): Promise<SessionCheck> {
  try {
    const response = await call('/api/auth/session');
    if (response.status === 401) return { kind: 'signed-out' };
    if (!response.ok) return { kind: 'unreachable' };
    return { kind: 'signed-in', user: ((await response.json()) as { user: AuthUser }).user };
  } catch {
    return { kind: 'unreachable' };
  }
}

async function action(path: string, init: RequestInit, fallback: string): Promise<ActionResult> {
  try {
    const response = await call(path, init);
    const body = (await response.json().catch(() => ({}))) as { user?: AuthUser; message?: string; retryAfterSec?: number };
    if (response.ok) return { ok: true, user: body.user };
    return { ok: false, message: body.message ?? fallback, retryAfterSec: body.retryAfterSec };
  } catch {
    return { ok: false, message: 'Tidak bisa terhubung ke server. Periksa koneksimu.' };
  }
}

export const requestLogin = (username: string, password: string) =>
  action('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }, 'Gagal masuk. Coba lagi.');

export const requestPasswordChange = (current: string, next: string) =>
  action('/api/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) }, 'Gagal mengganti kata sandi.');

export async function requestLogout(): Promise<void> {
  await call('/api/auth/logout', { method: 'POST' }).catch(() => {});
}

export async function listSessions(): Promise<SessionRow[]> {
  try {
    const response = await call('/api/auth/sessions');
    return response.ok ? ((await response.json()) as { sessions: SessionRow[] }).sessions : [];
  } catch {
    return [];
  }
}

export async function revokeSessionById(id: string): Promise<void> {
  await call(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
}
