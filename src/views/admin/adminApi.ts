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
  /** What this month's Google Cloud bill should come to (server/src/metrics/billing.ts). */
  billing: Billing;
  /** Who is playing right now and on what kind of device (never what). */
  listeningNow: Array<{ username: string; kinds: string[] }>;
  today: DayTotals;
  yesterday: DayTotals;
}

/** Rp per GiB the bill charges for data sent to Cloudflare, and how far the bill runs above the bytes the server counts. */
export interface Pricing {
  rpPerGib: number;
  overhead: number;
}

export interface Billing {
  pricing: Pricing;
  /** The bill's month, cut in Pacific time like Google's. */
  month: { start: string; end: string };
  bytes: number;
  cost: number;
  byKind: Record<UsageKind, number>;
  projectedCost: number;
  perDayCost: number;
  previousBytes: number;
  previousCost: number;
  freeTier: Array<{ label: string; ok: boolean; detail: number }>;
}

/** One WIB day's usage, for Ringkasan's "vs kemarin". */
export interface DayTotals {
  songBytes: number;
  podcastBytes: number;
  videoBytes: number;
  songSec: number;
  podcastSec: number;
  plays: number;
}

export type UsageKind = 'song' | 'podcast' | 'video';

/** One kind's numbers over a range (server/src/routes/adminStats.ts). listenSec and the play counts come from the devices. */
export interface KindTotals {
  bytes: number;
  diskBytes: number;
  listenSec: number;
  started: number;
  completed: number;
  skipped: number;
}
export type ByKind = Record<UsageKind, KindTotals>;

/** Weekday (Monday first) × hour of day, in the admin's timezone. */
export interface Heatmap {
  listen: number[][];
  bytes: number[][];
}

export interface UserUsage extends ByKind {
  accountId: string;
  username: string;
  disabled: boolean;
  peakHour: number | null;
  activeDays: number;
  lastSeen: string | null;
  devices: string[];
  listeningOn: string[];
}

export interface Usage {
  days: number;
  tz: string;
  pricing: Pricing;
  /** When devices started reporting listening time (null: not yet). Bytes go back further. */
  listenSince: string | null;
  totals: ByKind;
  series: Array<{ day: string } & ByKind>;
  heatmap: Heatmap;
  perUser: UserUsage[];
  /** Today and yesterday in the admin's timezone, whatever range is picked. */
  today: ByKind;
  yesterday: ByKind;
  /** Today's 24 hours, for the "Hari ini" range. */
  todayByHour: ByKind[];
}

export interface UserDetail {
  days: number;
  tz: string;
  pricing: Pricing;
  user: { accountId: string; username: string; disabled: boolean; createdAt: string; lastLoginAt: string | null; listeningOn: string[] };
  totals: ByKind;
  series: Array<{ day: string } & ByKind>;
  heatmap: Heatmap;
  last48h: Array<{ hour: string } & ByKind>;
  /** Today and yesterday in the admin's timezone, whatever range is picked. */
  today: ByKind;
  yesterday: ByKind;
  devices: Array<{ userAgent: string; ip: string | null; signedInAt: string; lastSeen: string }>;
  reports: PlaybackReport[];
}

export interface MonthSummary {
  totals: ByKind;
  activeUsers: number;
  /** The month's bytes from the per-day table, which reaches further back than the hourly one. */
  dailyTableBytes: number;
}

export interface MonthReport {
  month: string;
  tz: string;
  pricing: Pricing;
  /** The same month on Google's bill (Pacific time), and the one before. */
  gcp: { current: { bytes: number; cost: number }; previous: { bytes: number; cost: number } };
  months: string[];
  current: MonthSummary;
  previous: MonthSummary;
  series: Array<{ day: string } & ByKind>;
  heatmap: Heatmap;
  perUser: UserUsage[];
  resolve: { count: number; failures: number; avgMs: number | null; samples: number } | null;
}

export interface SystemSample {
  at: string;
  ram: number;
  swapBytes: number;
  load: number;
  disk: number | null;
  rssBytes: number;
  cacheFiles: number | null;
  cacheBytes: number | null;
  dbBytes: number | null;
  resolves: number;
  failures: number;
  avgMs: number | null;
  queue: number;
}

export interface SystemInfo {
  host: { totalBytes: number; availableBytes: number; swapUsedBytes: number; swapTotalBytes: number; load: number[]; cpus: number; uptimeSec: number };
  process: { rssBytes: number; heapUsedBytes: number; uptimeSec: number; node: string };
  disk: { totalBytes: number; freeBytes: number } | null;
  database: { sizeBytes: number; tables: Array<{ name: string; bytes: number; rows: number }> };
  audioCache: { files: number; bytes: number; maxBytes: number } | null;
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

/** A device's own note that playback went wrong in the background (server/src/diagnostics/playbackReports.ts). */
export interface PlaybackReport {
  at: number;
  username: string;
  event: string;
  device: string;
  detail: string;
}

export class AdminError extends Error {}

/** The admin's own timezone: hours of day and days are grouped in it (the server checks it is a real zone). */
const TZ = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta');

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

export interface PodcastPick {
  channelId: string;
  name: string;
  avatar: string;
  subscribers: string;
}

export const adminApi = {
  overview: () => call<Overview>('/overview'),
  users: () => call<{ users: AdminUser[] }>('/users').then((r) => r.users),
  usage: (days: number) => call<Usage>(`/usage?days=${days}&tz=${TZ}`),
  userUsage: (id: string, days: number) => call<UserDetail>(`/usage/user/${encodeURIComponent(id)}?days=${days}&tz=${TZ}`),
  report: (month: string | null) => call<MonthReport>(`/report?tz=${TZ}${month ? `&month=${month}` : ''}`),
  systemHistory: (hours: number) => call<{ hours: number; bucketSec: number; samples: SystemSample[] }>(`/system/history?hours=${hours}`),
  system: () => call<SystemInfo>('/system'),
  audit: () => call<AuditLog>('/audit?limit=100'),
  legacyAccounts: () => call<{ accounts: LegacyAccount[] }>('/legacy-accounts').then((r) => r.accounts),
  createUser: (username: string, role: 'user' | 'admin', legacyAccountId?: string) =>
    call<{ username: string; temporaryPassword: string }>('/users', { method: 'POST', body: JSON.stringify({ username, role, legacyAccountId }) }),
  resetPassword: (id: string) => call<{ temporaryPassword: string }>(`/users/${id}/reset-password`, { method: 'POST' }),
  update: (id: string, change: { disabled?: boolean; role?: 'user' | 'admin' }) => call<void>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(change) }),
  signOutAll: (id: string) => call<void>(`/users/${id}/sign-out`, { method: 'POST' }),
  remove: (id: string) => call<void>(`/users/${id}`, { method: 'DELETE' }),
  // Podcast tab's "Pilihan" (routes/podcast.ts). The list itself is read where every user reads it.
  podcastPicks: () =>
    fetch('/api/podcast/picks', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ picks: PodcastPick[] }>)
      .then((r) => r.picks),
  podcastSearch: (q: string) =>
    call<{ channels: { id: string; name: string; avatar: string; subscribers: string }[] }>(`/podcast/search?q=${encodeURIComponent(q)}`).then((r) =>
      r.channels.map((c) => ({ channelId: c.id, name: c.name, avatar: c.avatar, subscribers: c.subscribers })),
    ),
  addPodcastPick: (c: PodcastPick) =>
    call<void>(`/podcast/picks/${encodeURIComponent(c.channelId)}`, { method: 'PUT', body: JSON.stringify(c) }),
  removePodcastPick: (channelId: string) => call<void>(`/podcast/picks/${encodeURIComponent(channelId)}`, { method: 'DELETE' }),
  unlock: (key: string) => call<void>('/locks/unlock', { method: 'POST', body: JSON.stringify({ key }) }),
  playbackReports: () => call<{ reports: PlaybackReport[] }>('/playback-reports').then((r) => r.reports),
  clearPlaybackReports: () => call<void>('/playback-reports', { method: 'DELETE' }),
};
