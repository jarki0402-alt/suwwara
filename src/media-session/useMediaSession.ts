import { useEffect } from 'react';
import type { Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import { frameTicker } from '../audio-engine/frameTicker';
import { bindMediaSessionHandlers, setMediaSessionMetadata, setMediaSessionPlaybackState, setMediaSessionPositionState } from './mediaSessionManager';

interface UseMediaSessionOptions {
  song: Song | null;
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (timeSec: number) => void;
}

/** Wires the lock-screen / notification-bar media controls to playback actions. */
export function useMediaSession(options: UseMediaSessionOptions): void {
  const { song, isPlaying, onPlay, onPause, onNext, onPrevious, onSeek } = options;

  useEffect(() => {
    if (song) setMediaSessionMetadata(song);
  }, [song]);

  useEffect(() => {
    setMediaSessionPlaybackState(song ? (isPlaying ? 'playing' : 'paused') : 'none');
  }, [song, isPlaying]);

  useEffect(
    () => bindMediaSessionHandlers({ onPlay, onPause, onNext, onPrevious, onSeek }),
    [onPlay, onPause, onNext, onPrevious, onSeek],
  );

  useEffect(() => {
    if (!song || !isPlaying) return;
    // The OS lock-screen scrubber interpolates position on its own between
    // updates (using duration/position/playbackRate) — it doesn't need a fresh
    // value every animation frame, and that native-bridge call is one of the
    // pricier things this app does per frame on a phone.
    let lastUpdateMs = 0;
    return frameTicker.subscribe((timestampMs) => {
      if (timestampMs - lastUpdateMs < 1000) return;
      lastUpdateMs = timestampMs;
      setMediaSessionPositionState(audioEngine.getDuration(), audioEngine.getCurrentTime());
    });
  }, [song, isPlaying]);
}
