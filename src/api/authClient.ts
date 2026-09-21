import { notifyUnauthorized } from '../auth/authStore';
import { getDeviceId } from '../auth/deviceIdentity';
import type { Song } from './types';
import type { UserPlaylist } from '../stores/libraryStore';

/**
 * Auth/library/pairing calls, kept in their own file the same way
 * src/jam/jamClient.ts is separate from src/api/musicClient.ts — these are
 * the only calls in the app that need the device-id bearer token, so giving
 * them their own small fetch wrapper is simpler than threading an optional
 * headers param through musicClient's generic apiGet.
 */
/** Carries the status and parsed body so a caller can react to a specific answer (409 on a library save) instead of only a message. */
export class ApiHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.status = status;
    this.body = body;
  }
}

async function authFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(new URL(path, window.location.origin), {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${getDeviceId()}`,
      ...init?.headers,
    },
  });

  if (res.status === 204) return null;
  if (!res.ok) {
    notifyUnauthorized(res.status);
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new ApiHttpError(res.status, body, typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface LibrarySnapshot {
  likedSongs: Song[];
  playlists: UserPlaylist[];
}

export type LibraryPull = ({ unchanged: true } & { version: number }) | (LibrarySnapshot & { version: number; unchanged?: undefined });

/** `since` = the version this device already has; the server answers `unchanged` instead of resending the snapshot. */
export async function fetchLibrarySnapshot(since?: number): Promise<LibraryPull> {
  const result = await authFetch<LibraryPull>(since === undefined ? '/api/library' : `/api/library?since=${since}`);
  return result ?? { likedSongs: [], playlists: [], version: 0 };
}

/** Rejects with ApiHttpError(409, { likedSongs, playlists, version }) when another device saved since `baseVersion`. */
export async function pushLibrarySnapshot(snapshot: LibrarySnapshot, baseVersion: number): Promise<{ version: number }> {
  const result = await authFetch<{ version: number }>('/api/library', { method: 'PUT', body: JSON.stringify({ ...snapshot, baseVersion }) });
  return result ?? { version: baseVersion };
}

// ---- Linked devices (Settings -> Perangkat) ----------------------------------------------

export interface LinkedDevice {
  ref: string;
  name: string;
  kind: 'phone' | 'tablet' | 'desktop';
  lastSeenAt: string;
  isThis: boolean;
}

/** Tells the account what to call this device in the list. Best-effort. */
export async function registerThisDevice(name: string, kind: string): Promise<void> {
  await authFetch('/api/devices/me', { method: 'POST', body: JSON.stringify({ name, kind }) });
}

export async function listLinkedDevices(): Promise<LinkedDevice[]> {
  const result = await authFetch<{ devices: LinkedDevice[] }>('/api/devices');
  return result?.devices ?? [];
}
