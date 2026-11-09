import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { mapBackendSong, type BackendSong } from '../api/mappers';
import { notifyUnauthorized } from '../auth/authStore';
import { getDeviceId } from '../auth/deviceIdentity';
import { useLibraryStore, type SavedSong } from '../stores/libraryStore';
import { parseJsonWithoutEmDash } from '../utils/noEmDash';
import type { ImportPayload } from './exportifyFile';

/**
 * Client half of the Spotify import (server: routes/spotifyImport.ts + importer/importWorker.ts). The server matches;
 * this device, the one that uploaded, polls the progress and, as each playlist finishes, claims its songs and adds
 * them to the library, from where library sync carries them to every other device. The import id is persisted, so
 * closing the app mid-import just means the next launch picks up where it left off.
 */

export interface ImportPlaylistStatus {
  index: number;
  name: string;
  liked: boolean;
  total: number;
  done: number;
  complete: boolean;
  claimed: boolean;
}

export interface ImportStatus {
  id: string;
  status: 'running' | 'done' | 'cancelled';
  total: number;
  done: number;
  playlists: ImportPlaylistStatus[];
}

interface ClaimedPlaylist {
  name: string;
  liked: boolean;
  songs: { song: BackendSong; addedAt: number | null; verdict: 'yakin' | 'ragu' }[];
  missing: { name: string; artists: string[] }[];
}

export interface ImportReport {
  added: number;
  doubtful: number;
  missing: { playlist: string; name: string; artists: string[] }[];
}

interface SpotifyImportState {
  importId: string | null;
  status: ImportStatus | null;
  report: ImportReport;
  /** The import has nothing left to hand over: show the report until it is dismissed. */
  finished: boolean;
}

const emptyReport = (): ImportReport => ({ added: 0, doubtful: 0, missing: [] });

export const useSpotifyImportStore = create<SpotifyImportState>()(
  persist(() => ({ importId: null, status: null, report: emptyReport(), finished: false }) as SpotifyImportState, {
    name: 'suwwara-spotify-import',
  }),
);

async function importFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(new URL(path, window.location.origin), {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${getDeviceId()}`,
    },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    notifyUnauthorized(res.status);
    let code = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === 'string') code = body.error;
    } catch {
      // not JSON: keep the status
    }
    throw new ImportHttpError(res.status, code);
  }
  // Song titles from YouTube and Spotify names: external text, cleaned like every other response (CLAUDE.md #11).
  return parseJsonWithoutEmDash<T>(text);
}

export class ImportHttpError extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

const POLL_MS = 4000;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;
let started = false;

function schedule(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  const { importId, finished } = useSpotifyImportStore.getState();
  // Hidden tab or app in the background: nothing to show and nothing urgent, the server keeps matching. Picked up
  // again on visibilitychange.
  if (!importId || finished || document.visibilityState === 'hidden') return;
  pollTimer = setTimeout(() => void tick(), POLL_MS);
}

function toSavedSongs(claimed: ClaimedPlaylist): SavedSong[] {
  return claimed.songs.map(({ song, addedAt }) => ({ ...mapBackendSong(song), ...(addedAt ? { addedAt } : {}) }));
}

async function claim(importId: string, playlist: ImportPlaylistStatus): Promise<void> {
  let claimed: ClaimedPlaylist | null;
  try {
    claimed = await importFetch<ClaimedPlaylist>(`/api/import/spotify/${importId}/playlists/${playlist.index}/claim`, { method: 'POST' });
  } catch (error) {
    // Another tab got it first: it is that tab's to add.
    if (error instanceof ImportHttpError && error.status === 409) return;
    throw error;
  }
  if (!claimed) return;
  const songs = toSavedSongs(claimed);
  const library = useLibraryStore.getState();
  const added = claimed.liked ? library.importLikedSongs(songs) : (library.importPlaylist(claimed.name, songs), songs.length);
  useSpotifyImportStore.setState((state) => ({
    report: {
      added: state.report.added + added,
      doubtful: state.report.doubtful + claimed.songs.filter((s) => s.verdict === 'ragu').length,
      missing: [...state.report.missing, ...claimed.missing.map((m) => ({ playlist: claimed.name, ...m }))],
    },
  }));
}

async function tick(): Promise<void> {
  const { importId } = useSpotifyImportStore.getState();
  if (!importId || ticking) return;
  ticking = true;
  try {
    const status = await importFetch<ImportStatus>(`/api/import/spotify/${importId}`);
    if (!status) return;
    useSpotifyImportStore.setState({ status });
    for (const playlist of status.playlists) {
      if (playlist.complete && !playlist.claimed) await claim(importId, playlist);
    }
    if (status.status !== 'running') {
      // Cancelled imports leave unfinished playlists unclaimed on purpose; done ones are all claimed by now.
      useSpotifyImportStore.setState({ finished: true });
    }
  } catch (error) {
    // Gone (pruned, or another account): forget it rather than poll a 404 forever.
    if (error instanceof ImportHttpError && error.status === 404) useSpotifyImportStore.setState({ importId: null, status: null });
    // Anything else (offline, server restarting) is retried by the next poll.
  } finally {
    ticking = false;
    schedule();
  }
}

/** Once per session after sign-in (App.tsx, next to initLibrarySync). Resumes an import left running. */
export function initSpotifyImport(): void {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tick();
  });
  void tick();
}

export async function startSpotifyImport(payload: ImportPayload): Promise<void> {
  const status = await importFetch<ImportStatus>('/api/import/spotify', { method: 'POST', body: JSON.stringify(payload) });
  if (!status) return;
  useSpotifyImportStore.setState({ importId: status.id, status, report: emptyReport(), finished: false });
  void tick();
}

export async function cancelSpotifyImport(): Promise<void> {
  const { importId } = useSpotifyImportStore.getState();
  if (!importId) return;
  await importFetch(`/api/import/spotify/${importId}/cancel`, { method: 'POST' });
  await tick();
}

/** Closes the report. The import's rows on the server are pruned on their own. */
export function dismissSpotifyImport(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  useSpotifyImportStore.setState({ importId: null, status: null, report: emptyReport(), finished: false });
}
