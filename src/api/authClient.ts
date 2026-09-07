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
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface LibrarySnapshot {
  likedSongs: Song[];
  playlists: UserPlaylist[];
}

export async function fetchLibrarySnapshot(): Promise<LibrarySnapshot> {
  const result = await authFetch<LibrarySnapshot>('/api/library');
  return result ?? { likedSongs: [], playlists: [] };
}

export async function pushLibrarySnapshot(snapshot: LibrarySnapshot): Promise<void> {
  await authFetch('/api/library', { method: 'PUT', body: JSON.stringify(snapshot) });
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
