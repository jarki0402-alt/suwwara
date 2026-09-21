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

export async function unlinkDevice(ref: string): Promise<void> {
  await authFetch(`/api/devices/${encodeURIComponent(ref)}`, { method: 'DELETE' });
}

/** New device: ask for a code to show as a QR. */
export async function requestLinkCode(name: string, kind: string): Promise<{ code: string; expiresInSec: number }> {
  const result = await authFetch<{ code: string; expiresInSec: number }>('/api/auth/link/request', { method: 'POST', body: JSON.stringify({ name, kind }) });
  return result!;
}

export async function getLinkRequestStatus(code: string): Promise<'pending' | 'approved' | 'expired'> {
  const result = await authFetch<{ status: 'pending' | 'approved' | 'expired' }>(`/api/auth/link/request/${encodeURIComponent(code)}`);
  return result?.status ?? 'expired';
}

/** Scanning device: who is asking? */
export async function getLinkRequestInfo(code: string): Promise<{ deviceName: string; deviceKind: string }> {
  const result = await authFetch<{ deviceName: string; deviceKind: string }>(`/api/auth/link/info/${encodeURIComponent(code)}`);
  return result!;
}

export async function approveLinkRequest(code: string): Promise<{ deviceName: string }> {
  const result = await authFetch<{ deviceName: string }>('/api/auth/link/approve', { method: 'POST', body: JSON.stringify({ code }) });
  return result!;
}

/** Called by an already-onboarded device to start linking a second device to this account. */
export async function generatePairingCode(): Promise<{ code: string; expiresInSec: number }> {
  const result = await authFetch<{ code: string; expiresInSec: number }>('/api/auth/link/generate', { method: 'POST' });
  return result!;
}

export type ConfirmPairingResult = { ok: true } | { ok: false; reason: 'not-found' | 'other' };

/** Called by the new device once it has a code (scanned QR or typed manually). */
export async function confirmPairingCode(code: string): Promise<ConfirmPairingResult> {
  try {
    await authFetch('/api/auth/link/confirm', { method: 'POST', body: JSON.stringify({ code }) });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'not-found' };
  }
}
