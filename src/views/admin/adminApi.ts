import { notifyUnauthorized } from '../../auth/authStore';

/** The admin endpoints (server/src/routes/admin.ts): counts, sizes and account management — nothing about what anyone plays. */
export interface AdminUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  disabled: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login_at: string | null;
  sessions: number;
  devices: number;
  today_bytes: number;
  month_bytes: number;
}

export interface Overview {
  users: number;
  disabled: number;
  sessions: number;
  activeUsers: number;
  todayBytes: number;
  monthBytes: number;
  onlineDevices: number;
  jamRooms: number;
  resolve: { count: number; failures: number; avgMs: number | null; p95Ms: number | null; maxMs: number | null; queue: { pending: number; active: number } };
  locked: number;
  /** Bandwidth so far this calendar month against a configurable reference point (BANDWIDTH_QUOTA_GB) — a heads-up, not an enforced cap. */
  bandwidthQuota: { usedBytes: number; quotaBytes: number };
}

export interface Usage {
  days: number;
  series: Array<{ day: string; bytes: number; requests: number }>;
  perUser: Array<{ username: string; bytes: number; requests: number }>;
}

export interface SystemInfo {
  host: { totalBytes: number; availableBytes: number; swapUsedBytes: number; swapTotalBytes: number; load: number[]; cpus: number; uptimeSec: number };
  process: { rssBytes: number; heapUsedBytes: number; uptimeSec: number; node: string };
  disk: { totalBytes: number; freeBytes: number } | null;
  database: { sizeBytes: number; tables: Array<{ name: string; bytes: number; rows: number }> };
}

export interface LegacyAccount {
  id: string;
  liked: number;
  playlists: number;
  devices: number;
  lastSeen: string | null;
  playlistNames: string[];
}

export interface AuditEvent {
  id: string;
  at: string;
  event: string;
  username: string | null;
  ip: string | null;
  detail: string | null;
}

export interface AuditLog {
  events: AuditEvent[];
  locked: Array<{ key: string; retryAfterSec: number }>;
}

export class AdminError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    cache: 'no-store',
  });
  if (!response.ok) {
    notifyUnauthorized(response.status);
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new AdminError(body.message ?? `Gagal (${response.status}).`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const adminApi = {
  overview: () => call<Overview>('/overview'),
  users: () => call<{ users: AdminUser[] }>('/users').then((r) => r.users),
  usage: (days: number) => call<Usage>(`/usage?days=${days}`),
  system: () => call<SystemInfo>('/system'),
  audit: () => call<AuditLog>('/audit?limit=100'),
  legacyAccounts: () => call<{ accounts: LegacyAccount[] }>('/legacy-accounts').then((r) => r.accounts),
  createUser: (username: string, role: 'user' | 'admin', legacyAccountId?: string) =>
    call<{ username: string; temporaryPassword: string }>('/users', { method: 'POST', body: JSON.stringify({ username, role, legacyAccountId }) }),
  resetPassword: (id: string) => call<{ temporaryPassword: string }>(`/users/${id}/reset-password`, { method: 'POST' }),
  update: (id: string, change: { disabled?: boolean; role?: 'user' | 'admin' }) => call<void>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(change) }),
  signOutAll: (id: string) => call<void>(`/users/${id}/sign-out`, { method: 'POST' }),
  remove: (id: string) => call<void>(`/users/${id}`, { method: 'DELETE' }),
  unlock: (key: string) => call<void>('/locks/unlock', { method: 'POST', body: JSON.stringify({ key }) }),
};
