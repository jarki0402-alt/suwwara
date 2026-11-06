import { getArtistTopSongs } from '../api/endpoints/artist';
import { searchSongs } from '../api/endpoints/search';
import { getSimilarSongs } from '../api/endpoints/similar';
import { getCachedSongs } from '../api/songCache';
import type { Song } from '../api/types';
import { buildRadioQueue } from '../playback/playSongRadio';
import { dayKey } from './dailyDiscovery';
import { loadHistory, type PlayEvent } from './historyLog';
import { getRecommendations } from './recommendationEngine';
import { topArtistNames } from './topArtistMix';
import { getTrendingSongsIndonesia } from './trendingChart';

/*
 * The "Dibuat untukmu" mixes added with the 2026-11 Home redesign, next to Temuan Mingguan/Harian and Sering Kamu
 * Putar. Every one is built on the listener's device from calls the app already makes (search, similar songs, an
 * artist's top songs: metadata only, no yt-dlp resolve until a song is actually played), and kept for the day in
 * localStorage, so a day costs a handful of lookups per mix at most, and only for the mixes someone opens.
 */

const MIX_SIZE = 30;
// Search results include hour-long compilations and 30-second snippets; a mix wants songs.
const MIN_SONG_SEC = 60;
const MAX_SONG_SEC = 10 * 60;
const TIME_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = 'suwwara.mix.';

export type PartOfDay = 'pagi' | 'siang' | 'sore' | 'malam';

export function partOfDay(hour: number): PartOfDay {
  if (hour >= 4 && hour < 11) return 'pagi';
  if (hour >= 11 && hour < 15) return 'siang';
  if (hour >= 15 && hour < 18) return 'sore';
  return 'malam';
}

const PART_LABEL: Record<PartOfDay, string> = { pagi: 'Pagi', siang: 'Siang', sore: 'Sore', malam: 'Malam' };

export function timeMixTitle(now = new Date()): string {
  return `Mix ${PART_LABEL[partOfDay(now.getHours())]} Ini`;
}

interface StoredMix {
  key: string;
  songs: Song[];
}

/** One localStorage entry per mix kind, overwritten when its key (day, part of day, artist) changes: never grows. */
function readMix(kind: string, key: string): Song[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + kind);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredMix;
    return stored.key === key && Array.isArray(stored.songs) && stored.songs.length > 0 ? stored.songs : null;
  } catch {
    return null;
  }
}

function writeMix(kind: string, key: string, songs: Song[]): void {
  if (songs.length === 0) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + kind, JSON.stringify({ key, songs } satisfies StoredMix));
  } catch {
    // storage full or blocked: the mix is simply rebuilt next time
  }
}

/** In-flight builds, so a card's prefetch and opening it at the same moment do one build, not two. */
const inFlight = new Map<string, Promise<Song[]>>();

function cachedBuild(kind: string, key: string, build: () => Promise<Song[]>): Promise<Song[]> {
  const stored = readMix(kind, key);
  if (stored) return Promise.resolve(stored);
  const flightKey = `${kind}|${key}`;
  const running = inFlight.get(flightKey);
  if (running) return running;
  const promise = build()
    .then((songs) => {
      writeMix(kind, key, songs);
      return songs;
    })
    .finally(() => inFlight.delete(flightKey));
  inFlight.set(flightKey, promise);
  return promise;
}

function isSongLength(song: Song): boolean {
  return !song.duration || (song.duration >= MIN_SONG_SEC && song.duration <= MAX_SONG_SEC);
}

/** Merges lists in turns (a, b, c, a, b, c...), dropping repeats, so no single source fills the top of the mix. */
export function interleaveUnique(lists: Song[][], limit: number): Song[] {
  const out: Song[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest && out.length < limit; i += 1) {
    for (const list of lists) {
      const song = list[i];
      if (!song || seen.has(song.id) || !isSongLength(song)) continue;
      seen.add(song.id);
      out.push(song);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Song ids played in the same part of the day as `part` (local time), most played first. */
export function songsPlayedAt(history: PlayEvent[], part: PartOfDay, now: number): string[] {
  const tally = new Map<string, number>();
  for (const event of history) {
    if (now - event.timestamp > TIME_WINDOW_MS) continue;
    if (partOfDay(new Date(event.timestamp).getHours()) !== part) continue;
    tally.set(event.songId, (tally.get(event.songId) ?? 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([songId]) => songId);
}

/**
 * "Mix Malam Ini" (and pagi/siang/sore): what this listener tends to play at this time of day, mixed with songs like
 * those. New listeners with no such history get their recommendations, then the chart, rather than an empty card.
 */
export function getTimeMix(now = new Date()): Promise<Song[]> {
  const part = partOfDay(now.getHours());
  return cachedBuild('time', `${dayKey(now)}-${part}`, async () => {
    const seeds = getCachedSongs(songsPlayedAt(loadHistory(), part, now.getTime()).slice(0, 12));
    if (seeds.length > 0) {
      const similar = await Promise.allSettled(seeds.slice(0, 2).map((seed) => getSimilarSongs(seed.id, 15)));
      const lists = similar.map((result) => (result.status === 'fulfilled' ? result.value : []));
      return interleaveUnique([seeds, ...lists], MIX_SIZE);
    }
    const recommended = await getRecommendations(new Set(), MIX_SIZE).catch(() => [] as Song[]);
    if (recommended.length > 0) return recommended;
    return getTrendingSongsIndonesia(MIX_SIZE);
  });
}

export type Mood = 'focus' | 'chill';

/**
 * Searches per mood. There is no "mood" field anywhere in the data this app gets, so these lean on how people name
 * such music, plus the listener's own top artists where that makes sense (an acoustic take of who you already like
 * is a better "santai" than generic results). Instrumental for focus on purpose: lyrics pull attention.
 */
function moodQueries(mood: Mood, artists: string[]): string[] {
  if (mood === 'focus') return ['lofi hip hop instrumental', 'piano instrumental tenang', 'ambient music for studying'];
  const [first, second] = artists;
  return [first ? `${first} akustik` : 'akustik indonesia', 'lagu santai akustik indonesia', second ? `${second} live acoustic` : 'lagu santai sore'];
}

export const MOOD_TITLE: Record<Mood, string> = { focus: 'Mix Fokus', chill: 'Mix Santai' };

export function getMoodMix(mood: Mood, now = new Date()): Promise<Song[]> {
  return cachedBuild(`mood-${mood}`, dayKey(now), async () => {
    const queries = moodQueries(mood, topArtistNames(2));
    const results = await Promise.allSettled(queries.map((query) => searchSongs(query, 20)));
    return interleaveUnique(results.map((result) => (result.status === 'fulfilled' ? result.value.songs : [])), MIX_SIZE);
  });
}

/** The artist the "Radio" card is about: the listener's top artist, or null with no history or library yet. */
export function radioArtist(): string | null {
  return topArtistNames(1)[0] ?? null;
}

/** "Radio {artist}": songs like the artist's best-known one, the same engine as starting a song's radio. */
export function getArtistRadio(artistName: string, now = new Date()): Promise<Song[]> {
  return cachedBuild('radio', `${dayKey(now)}-${artistName.toLowerCase()}`, async () => {
    const top = await getArtistTopSongs(artistName, 5);
    const seed = top?.songs[0];
    if (!seed) return [];
    const radio = await buildRadioQueue(seed);
    return interleaveUnique([[seed], radio], MIX_SIZE);
  });
}
