import type { Song } from '../api/types';
import { useUiStore } from '../stores/uiStore';
import { enterFullscreen, leaveFullscreen } from '../utils/documentFullscreen';
import { startVideoSound, stopVideoSound, type MusicVideo } from './musicVideo';

/**
 * Opens the video filling the screen. Must run inside the tap: that is what lets iOS start the video's own sound
 * (a not-synced cut) and lets the browser go fullscreen (no address bar or system bars on Android).
 */
export function openTheater(song: Song, video: MusicVideo): void {
  if (!video.synced) startVideoSound(video);
  enterFullscreen('video');
  useUiStore.getState().openVideoTheater({ song, video, ownSound: !video.synced });
}

type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void>; unlock?: () => void };

/** Android: once fullscreen, turn to landscape like YouTube's player does. Elsewhere lock() is missing or refuses. */
export function lockLandscape(): void {
  const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as LockableOrientation | undefined;
  void orientation?.lock?.('landscape').catch(() => {});
}

// Whatever closed the theater (its button, Back, Esc, a skip), the same clean-up runs once: here and not in a
// component's unmount, which StrictMode runs twice and which wouldn't know why it unmounted.
useUiStore.subscribe((state, previous) => {
  if (!previous.videoTheater || state.videoTheater) return;
  const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as LockableOrientation | undefined;
  try {
    orientation?.unlock?.();
  } catch {
    // not locked
  }
  leaveFullscreen('video');
  if (previous.videoTheater.ownSound) stopVideoSound(true);
});
