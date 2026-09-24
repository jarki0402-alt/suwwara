import { useEffect } from 'react';

const SEEK_STEP_SEC = 5;
const VOLUME_STEP = 0.05;

interface KeyboardShortcutHandlers {
  hasSong: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeekBy: (deltaSec: number) => void;
  onVolumeBy: (delta: number) => void;
}

/** Keys that mean something to the element itself (typing, activating a focused button) must never also control playback. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, button, a, [role="button"], [role="slider"], [role="menuitem"]') !== null;
}

/**
 * Spotify-style desktop keys: Space play/pause, ←/→ seek 5s, Ctrl/⌘ + ←/→ previous/next, Ctrl/⌘ + ↑/↓ volume.
 * Space and the arrows are left alone while focus is on a control that already uses them (a focused button's own
 * Space-to-click, the seek slider's arrows, a text field), otherwise pressing Space on a button would both click it
 * and toggle playback.
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const { hasSong, onTogglePlay, onNext, onPrevious, onSeekBy, onVolumeBy } = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.repeat && event.code === 'Space') return;
      if (isInteractiveTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;

      if (event.code === 'Space' && !modifier && !event.shiftKey) {
        if (!hasSong) return;
        event.preventDefault(); // otherwise the page scrolls
        onTogglePlay();
        return;
      }
      if (!hasSong) return;
      if (event.code === 'ArrowRight') {
        event.preventDefault();
        if (modifier) onNext();
        else onSeekBy(SEEK_STEP_SEC);
      } else if (event.code === 'ArrowLeft') {
        event.preventDefault();
        if (modifier) onPrevious();
        else onSeekBy(-SEEK_STEP_SEC);
      } else if (modifier && event.code === 'ArrowUp') {
        event.preventDefault();
        onVolumeBy(VOLUME_STEP);
      } else if (modifier && event.code === 'ArrowDown') {
        event.preventDefault();
        onVolumeBy(-VOLUME_STEP);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasSong, onTogglePlay, onNext, onPrevious, onSeekBy, onVolumeBy]);
}
