import { create } from 'zustand';
import { apiGet, buildAudioUrl } from '../api/musicClient';
import { primaryArtistNames } from '../api/mappers';
import type { Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * Music videos ("Video" in Now Playing, Spotify-style). The server finds the song's official video and proxies its
 * picture (server/src/routes/video.ts). Two kinds, decided by the server from the two lengths:
 * - synced: the video is the same recording as the song. Its picture plays muted over the song's own audio, which
 *   never stops or reloads: switching Lagu ↔ Video is instant and the song is untouched (VideoSurface follows it).
 * - not synced: the video is a different cut (an intro, a skit). It plays in the theater with its own sound and its
 *   own controls, the song paused underneath and resumed when the theater closes.
 */
export interface MusicVideo {
  videoId: string;
  durationSec: number;
  synced: boolean;
}

export type VideoHeight = '720' | '480';

export function videoStreamUrl(videoId: string, height: VideoHeight): string {
  return `/api/video/${encodeURIComponent(videoId)}?h=${height}`;
}

/** Same video as an HLS playlist over byte ranges of that file (see server/src/routes/video.ts buildHlsPlaylist). */
export function videoHlsUrl(videoId: string, height: VideoHeight): string {
  return `/api/video/${encodeURIComponent(videoId)}/hls.m3u8?h=${height}`;
}

/**
 * WebKit: every iPhone/iPad browser (they're all Safari underneath) and Safari on the Mac. It walks the whole of
 * YouTube's fragmented MP4 to find a time (~5s to the first frame); its native HLS fetches just the needed fragment.
 * Chrome/Firefox keep the plain MP4, which they open at once.
 */
export function prefersHls(video: HTMLVideoElement): boolean {
  if (typeof navigator === 'undefined' || video.canPlayType('application/vnd.apple.mpegurl') === '') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|Android|Firefox/.test(ua));
}

// Session-long and bounded: one entry per song looked at, null included (no video) so it isn't asked again.
const MAX_LOOKUPS = 300;
const lookups = new Map<string, MusicVideo | null>();
const pending = new Map<string, Promise<MusicVideo | null>>();
const lookupListeners = new Set<() => void>();

/** For useSyncExternalStore: notified when a lookup lands. */
export function subscribeLookups(listener: () => void): () => void {
  lookupListeners.add(listener);
  return () => lookupListeners.delete(listener);
}

export function peekMusicVideo(songId: string): MusicVideo | null | undefined {
  return lookups.get(songId);
}

export function lookupMusicVideo(song: Song): Promise<MusicVideo | null> {
  const known = lookups.get(song.id);
  if (known !== undefined) return Promise.resolve(known);
  const inFlight = pending.get(song.id);
  if (inFlight) return inFlight;
  const request = apiGet<{ video: MusicVideo | null }>(`/api/video/match/${encodeURIComponent(song.id)}`, {
    title: song.name,
    artist: primaryArtistNames(song),
    duration: Math.round(song.duration) || undefined,
  })
    .then(({ video }) => {
      lookups.set(song.id, video);
      while (lookups.size > MAX_LOOKUPS) {
        const oldest = lookups.keys().next().value;
        if (oldest === undefined) break;
        lookups.delete(oldest);
      }
      for (const listener of lookupListeners) listener();
      return video;
    })
    // A failed lookup isn't remembered: the button just doesn't show this time.
    .catch(() => null)
    .finally(() => pending.delete(song.id));
  pending.set(song.id, request);
  return request;
}

interface VideoModeState {
  /** The listener picked Video: it stays picked across songs, like Spotify (a song without one shows its cover). */
  wanted: boolean;
  setWanted: (wanted: boolean) => void;
}

export const useVideoMode = create<VideoModeState>((set) => ({
  wanted: false,
  setWanted: (wanted) => set({ wanted }),
}));

/** What VideoSurface keeps the picture in step with. */
export interface VideoClock {
  time: () => number;
  playing: () => boolean;
  /** Notified on play/pause/seek-like changes; the surface also checks a few times a second regardless. */
  subscribe: (listener: () => void) => () => void;
}

export const songClock: VideoClock = {
  time: () => audioEngine.getCurrentTime(),
  playing: () => audioEngine.getSnapshot().status === 'playing',
  subscribe: (listener) => audioEngine.subscribe(() => listener()),
};

/**
 * The sound of a not-synced video: the MV's own audio stream, through the same /api/audio proxy as songs (any YouTube
 * id works there). A plain <audio>, outside AudioEngine on purpose: the song keeps its element, queue and position,
 * paused, and simply carries on when the theater closes.
 */
let videoAudio: HTMLAudioElement | null = null;
let videoSound: { clock: VideoClock; element: HTMLAudioElement } | null = null;
let resumeSongAfter = false;

/** The theater's clock and transport for a not-synced video, while its sound is on. */
export function currentVideoSound(): { clock: VideoClock; element: HTMLAudioElement } | null {
  return videoSound;
}

function elementClock(element: HTMLAudioElement): VideoClock {
  return {
    time: () => element.currentTime,
    playing: () => !element.paused && !element.ended && element.readyState >= 3,
    subscribe: (listener) => {
      const events = ['play', 'pause', 'playing', 'waiting', 'seeked', 'ended'] as const;
      for (const name of events) element.addEventListener(name, listener);
      return () => {
        for (const name of events) element.removeEventListener(name, listener);
      };
    },
  };
}

/**
 * Must run inside the tap: iOS only lets audio start from one. Pauses the song and starts the video's own sound.
 * Returns the clock the theater's picture follows.
 */
export function startVideoSound(video: MusicVideo): { clock: VideoClock; element: HTMLAudioElement } {
  stopVideoSound(false);
  const status = audioEngine.getSnapshot().status;
  resumeSongAfter = status === 'playing' || status === 'loading';
  audioEngine.pause();
  const element = new Audio(buildAudioUrl(video.videoId, 'high'));
  element.preload = 'auto';
  element.volume = useSettingsStore.getState().volume;
  void element.play().catch(() => {});
  videoAudio = element;
  videoSound = { clock: elementClock(element), element };
  return videoSound;
}

/** Ends the video's own sound; the song carries on if it was playing when the video started (a tap, so iOS allows it). */
export function stopVideoSound(resumeSong = true): void {
  const element = videoAudio;
  videoAudio = null;
  videoSound = null;
  if (element) {
    element.pause();
    element.removeAttribute('src');
    element.load(); // drops the connection, so the rest of the file isn't downloaded for nothing
  }
  if (resumeSong && resumeSongAfter) void audioEngine.play().catch(() => {});
  resumeSongAfter = false;
}

/** The song started again by other means (lock screen, another device, a skip): the video's sound must not play over it. */
audioEngine.subscribe((state) => {
  if (videoAudio && (state.status === 'playing' || state.status === 'loading')) {
    resumeSongAfter = false;
    stopVideoSound(false);
  }
});
