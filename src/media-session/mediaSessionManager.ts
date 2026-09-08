import type { Song } from '../api/types';
import { bestImageUrl, primaryArtistNames } from '../api/mappers';

export interface MediaSessionHandlers {
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek?: (timeSec: number) => void;
}

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

export function setMediaSessionMetadata(song: Song): void {
  if (!isSupported()) return;
  try {
    const artwork = [
      { src: bestImageUrl(song.image, '150x150'), sizes: '150x150', type: 'image/jpeg' },
      { src: bestImageUrl(song.image, '500x500'), sizes: '500x500', type: 'image/jpeg' },
    ].filter((art) => art.src.length > 0);

    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name,
      artist: primaryArtistNames(song),
      album: song.album?.name ?? '',
      artwork,
    });
  } catch {
    // MediaMetadata construction can throw on partial/older implementations — non-fatal.
  }
}

export function setMediaSessionPlaybackState(state: 'playing' | 'paused' | 'none'): void {
  if (!isSupported()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    // ignore
  }
}

export function setMediaSessionPositionState(duration: number, position: number, playbackRate = 1): void {
  if (!isSupported() || typeof navigator.mediaSession.setPositionState !== 'function') return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration, position: Math.min(Math.max(position, 0), duration), playbackRate });
  } catch {
    // setPositionState support is uneven on iOS — never let it break playback.
  }
}

// Deliberately NOT registering seekforward/seekbackward.
// Furthermore, registering 'seekto' on iOS Safari explicitly causes the lock screen
// to replace the 'previoustrack' and 'nexttrack' buttons with 15s/10s skip buttons
// because it assumes the media is a long-form podcast or audiobook. To preserve the
// proper |>> and <<| track skip buttons, we must NOT register 'seekto' on iOS.
const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const HANDLED_ACTIONS: MediaSessionAction[] = ['play', 'pause', 'previoustrack', 'nexttrack'];
if (!isIOS) {
  HANDLED_ACTIONS.push('seekto');
}

export function bindMediaSessionHandlers(handlers: MediaSessionHandlers): () => void {
  if (!isSupported()) return () => {};

  const actionHandlerMap: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: () => handlers.onPlay(),
    pause: () => handlers.onPause(),
    previoustrack: () => handlers.onPrevious(),
    nexttrack: () => handlers.onNext(),
  };

  if (handlers.onSeek) {
    const onSeek = handlers.onSeek;
    actionHandlerMap.seekto = (details) => {
      if (typeof details.seekTime === 'number') onSeek(details.seekTime);
    };
  }

  for (const action of HANDLED_ACTIONS) {
    const handler = actionHandlerMap[action];
    if (!handler) continue;
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Individual action support is uneven across browsers (esp. older iOS Safari) — skip and continue.
    }
  }

  return () => {
    for (const action of HANDLED_ACTIONS) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // ignore
      }
    }
  };
}
