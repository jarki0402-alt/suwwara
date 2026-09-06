import { createContext, useContext, type ReactNode } from 'react';
import { usePlaybackController } from './usePlaybackController';

type PlaybackControllerValue = ReturnType<typeof usePlaybackController>;

const PlaybackContext = createContext<PlaybackControllerValue | null>(null);

/**
 * usePlaybackController owns live subscriptions (audio engine events, media
 * session handlers, history recording) and must run exactly once — this
 * provider is the single call site, and every other component reads its
 * result via usePlayback() instead of invoking the hook again.
 */
export function PlaybackProvider({ children }: { children: ReactNode }) {
  const controller = usePlaybackController();
  return <PlaybackContext.Provider value={controller}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): PlaybackControllerValue {
  const context = useContext(PlaybackContext);
  if (!context) throw new Error('usePlayback must be used within a PlaybackProvider.');
  return context;
}
