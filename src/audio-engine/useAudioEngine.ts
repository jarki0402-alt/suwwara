import { useSyncExternalStore } from 'react';
import { audioEngine } from './AudioEngine';
import type { PlaybackState } from './types';

/**
 * Subscribes to the audio engine's coarse playback state only (status/duration/error).
 * Never re-renders on a timer — per-frame progress reads happen via frameTicker instead.
 */
export function useAudioEngine(): PlaybackState {
  return useSyncExternalStore(
    (onStoreChange) => audioEngine.subscribe(onStoreChange),
    () => audioEngine.getSnapshot(),
  );
}
