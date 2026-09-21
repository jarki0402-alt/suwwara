import { getLyricsPayload, type LyricsPayload } from '../api/endpoints/lyrics';
import type { Song } from '../api/types';
import { readCachedLyrics, writeCachedLyrics } from './lyricsCache';
import { parseLrc, type LrcLine } from './lrcParser';

export type LyricsResult =
  | { type: 'synced'; lines: LrcLine[] }
  | { type: 'plain'; text: string; source: 'lrclib' | 'ytmusic' }
  | { type: 'instrumental' }
  | { type: 'none' };

const MAX_MEMORY_ENTRIES = 60;
const memory = new Map<string, LyricsResult>();
const inFlight = new Map<string, Promise<LyricsResult>>();

function toResult(payload: LyricsPayload): LyricsResult {
  switch (payload.type) {
    case 'synced': {
      const lines = parseLrc(payload.lrc);
      if (lines.length === 0) return { type: 'none' };
      return { type: 'synced', lines };
    }
    case 'plain':
      return payload.text ? { type: 'plain', text: payload.text, source: payload.source } : { type: 'none' };
    case 'instrumental':
      return { type: 'instrumental' };
    default:
      return { type: 'none' };
  }
}

function remember(songId: string, result: LyricsResult): void {
  memory.delete(songId);
  memory.set(songId, result);
  while (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/**
 * Lyrics for a song, from the backend (which owns the lookups: LRCLIB, then YouTube Music, cached in Postgres).
 * Rejects when the lyrics couldn't be checked — the caller shows a retry, and NOTHING is remembered for that song,
 * so a bad moment on the network no longer turns into "Lirik tidak tersedia" until the app is restarted.
 */
export function resolveLyrics(song: Song): Promise<LyricsResult> {
  const inMemory = memory.get(song.id);
  if (inMemory) return Promise.resolve(inMemory);

  const stored = readCachedLyrics(song.id);
  if (stored) {
    const result = toResult(stored);
    remember(song.id, result);
    return Promise.resolve(result);
  }

  const pending = inFlight.get(song.id);
  if (pending) return pending;

  const loading = getLyricsPayload(song.id)
    .then((payload) => {
      const result = toResult(payload);
      remember(song.id, result);
      writeCachedLyrics(song.id, payload);
      return result;
    })
    .finally(() => {
      inFlight.delete(song.id);
    });
  inFlight.set(song.id, loading);
  return loading;
}
