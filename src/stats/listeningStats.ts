import type { Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import type { PlaybackState } from '../audio-engine/types';
import { isEpisode } from '../podcast/episodeRegistry';
import { useQueueStore } from '../stores/queueStore';

/**
 * How long this device actually played, per hour, for the admin console (server/src/routes/usage.ts): seconds heard,
 * and tracks started / finished / skipped, for songs and podcast episodes apart. Never which track.
 *
 * Why the device counts it: songs kept on the phone ("Simpan lagu", on for everyone) play without a byte reaching the
 * server, so the server's own byte counts would make a heavy listener look idle.
 *
 * Only watches: it subscribes to the engine's coarse state changes and the queue, reads the playhead, and never calls
 * anything that changes playback. Time is counted from how far the playhead moved, capped by the wall clock, so a
 * pause, a stall, a seek or a laptop asleep never counts as listening. While something plays, one 15-second timer
 * reads the playhead; while nothing does, nothing runs. Counts wait in localStorage (bounded) and go to the server in
 * one small request every 5 minutes, or when the app is put away; offline they simply wait.
 */

type Kind = 'song' | 'podcast';
interface Bucket {
  hour: number;
  kind: Kind;
  listenSec: number;
  started: number;
  completed: number;
  skipped: number;
}

const STORAGE_KEY = 'suwwara:listening';
const TICK_MS = 15_000;
const FLUSH_MS = 5 * 60_000;
const MAX_BUCKETS = 400; // ~2 weeks of hours with both kinds; the server takes as many per report
const HOUR_MS = 3_600_000;
// A track counts as finished from 90% in (outros, an early "ended" on Android), otherwise as skipped once it started.
const FINISHED_FRACTION = 0.9;

let buckets = new Map<string, Bucket>();
let track: {
  id: string;
  kind: Kind;
  duration: number;
  started: boolean;
  ended: boolean;
  furthest: number;
  playing: boolean;
  lastPos: number;
  lastWall: number;
} | null = null;
let tick: ReturnType<typeof setInterval> | undefined;
let sending = false;
let started = false;

function load(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Bucket[];
    if (Array.isArray(saved)) for (const bucket of saved) if (bucket && typeof bucket.hour === 'number') buckets.set(`${bucket.hour}|${bucket.kind}`, bucket);
  } catch {
    // Private mode or a broken entry: start from nothing.
  }
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...buckets.values()]));
  } catch {
    // Storage full or blocked: the counts stay in memory until the next send.
  }
}

function bucketFor(kind: Kind, at: number): Bucket {
  const hour = Math.floor(at / HOUR_MS) * HOUR_MS;
  const key = `${hour}|${kind}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hour, kind, listenSec: 0, started: 0, completed: 0, skipped: 0 };
    buckets.set(key, bucket);
    // Oldest hours go first if a device stays offline for weeks.
    while (buckets.size > MAX_BUCKETS) buckets.delete(buckets.keys().next().value!);
  }
  return bucket;
}

/** `seconds` heard, ending now, spread over the hours they fell in. */
function addListening(kind: Kind, seconds: number): void {
  let end = Date.now();
  let left = seconds;
  while (left > 0) {
    const hourStart = Math.floor((end - 1) / HOUR_MS) * HOUR_MS;
    const inThisHour = Math.min(left, (end - hourStart) / 1000);
    bucketFor(kind, end - 1).listenSec += inThisHour;
    left -= inThisHour;
    end = hourStart;
  }
}

/** Moves the count forward to the playhead now (only while this track is playing). */
function sample(): void {
  if (!track || !track.playing) return;
  // The engine may already hold the next track (a preloaded swap): its playhead says nothing about this one.
  if (audioEngine.getCurrentSong()?.id !== track.id) return;
  const position = audioEngine.getCurrentTime();
  const wall = Date.now();
  const moved = position - track.lastPos;
  // A seek forward jumps the playhead without anyone hearing it: never more than the time that really passed.
  if (moved > 0) addListening(track.kind, Math.min(moved, (wall - track.lastWall) / 1000 + 1));
  track.furthest = Math.max(track.furthest, position);
  track.lastPos = position;
  track.lastWall = wall;
}

function closeTrack(): void {
  if (!track) return;
  sample();
  if (track.started) {
    const finished = track.ended || (track.duration > 0 && track.furthest >= track.duration * FINISHED_FRACTION);
    const bucket = bucketFor(track.kind, Date.now());
    if (finished) bucket.completed += 1;
    else bucket.skipped += 1;
  }
  track = null;
}

function stopTick(): void {
  if (tick) clearInterval(tick);
  tick = undefined;
}

function onEngine(state: PlaybackState): void {
  const song: Song | null = audioEngine.getCurrentSong();
  if (track && song?.id !== track.id) closeTrack();
  if (!song) {
    stopTick();
    return;
  }
  if (!track) {
    track = {
      id: song.id,
      kind: isEpisode(song) ? 'podcast' : 'song',
      duration: 0,
      started: false,
      ended: false,
      furthest: 0,
      playing: false,
      lastPos: audioEngine.getCurrentTime(),
      lastWall: Date.now(),
    };
  }
  const duration = state.duration || song.duration || 0;
  if (duration > 0) track.duration = duration;

  if (state.status === 'playing') {
    if (!track.started) {
      track.started = true;
      bucketFor(track.kind, Date.now()).started += 1;
    }
    if (!track.playing) {
      // Counting restarts from here: the time spent paused or loading before was not heard.
      track.playing = true;
      track.lastPos = audioEngine.getCurrentTime();
      track.lastWall = Date.now();
    }
    if (!tick) tick = setInterval(sample, TICK_MS);
    return;
  }
  sample();
  track.playing = false;
  stopTick();
  // Finished counts now, not when (or whether) something plays next: the last song of the evening is finished too.
  // Played again (repeat one), the same track then starts as a new one.
  if (state.status === 'ended') {
    track.ended = true;
    closeTrack();
  }
}

async function send(): Promise<void> {
  if (sending) return;
  sample();
  const batch = [...buckets.values()].filter((bucket) => bucket.listenSec >= 1 || bucket.started || bucket.completed || bucket.skipped);
  if (batch.length === 0) return;
  // Taken out before sending, so what is heard meanwhile lands in fresh buckets; put back if the send fails.
  buckets = new Map([...buckets].filter(([, bucket]) => !batch.includes(bucket)));
  sending = true;
  try {
    const response = await fetch('/api/usage/listen', {
      method: 'POST',
      // The app may be closing (that is one of the moments this runs): the request has to land anyway.
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buckets: batch.map((bucket) => ({ ...bucket, listenSec: Math.round(bucket.listenSec) })) }),
    });
    if (!response.ok && response.status !== 400) throw new Error(String(response.status));
  } catch {
    for (const bucket of batch) {
      const into = bucketFor(bucket.kind, bucket.hour);
      into.listenSec += bucket.listenSec;
      into.started += bucket.started;
      into.completed += bucket.completed;
      into.skipped += bucket.skipped;
    }
  } finally {
    sending = false;
    save();
  }
}

/** Starts counting for the signed-in listener (App.tsx, never for the admin console). Once per app session. */
export function initListeningStats(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  load();
  audioEngine.subscribe(onEngine);
  onEngine(audioEngine.getSnapshot());
  // The queue moves on before the engine loads the next track: the playhead still belongs to the old one here, so
  // its last seconds are counted before the switch.
  useQueueStore.subscribe((state, previous) => {
    if (state.currentSong()?.id !== previous.currentSong()?.id) sample();
  });
  setInterval(() => void send(), FLUSH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      save();
      void send();
    }
  });
  window.addEventListener('pagehide', () => save());
}
