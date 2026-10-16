import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useFollowedDevice, type RemoteDevice } from '../connect/connectStore';
import { usePlaybackController } from './usePlaybackController';

type PlaybackControllerValue = ReturnType<typeof usePlaybackController> & {
  /** The device this one is a remote for (its song is what's on screen, its play state is what the buttons show). */
  remoteDevice: RemoteDevice | null;
};

const PlaybackContext = createContext<PlaybackControllerValue | null>(null);

/**
 * usePlaybackController owns live subscriptions (audio engine events, media
 * session handlers, history recording) and must run exactly once — this
 * provider is the single call site, and every other component reads its
 * result via usePlayback() instead of invoking the hook again.
 *
 * While this device is a remote for another one, `playbackState` describes THAT device (playing/paused as it last
 * reported), so every player surface — MiniPlayer, Now Playing, fullscreen — shows the account's playback without
 * knowing remote control exists. The local engine's own state stays available to whoever needs it (useAudioEngine).
 */
export function PlaybackProvider({ children }: { children: ReactNode }) {
  const controller = usePlaybackController();
  const remoteDevice = useFollowedDevice();
  const remoteIsPlaying = remoteDevice?.state?.isPlaying ?? false;
  const remoteDuration = remoteDevice?.state?.durationSec ?? 0;
  const value = useMemo<PlaybackControllerValue>(
    () =>
      remoteDevice
        ? { ...controller, remoteDevice, playbackState: { status: remoteIsPlaying ? 'playing' : 'paused', duration: remoteDuration, error: null } }
        : { ...controller, remoteDevice: null },
    [controller, remoteDevice, remoteIsPlaying, remoteDuration],
  );
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackControllerValue {
  const context = useContext(PlaybackContext);
  if (!context) throw new Error('usePlayback must be used within a PlaybackProvider.');
  return context;
}
