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

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'password', 'number', 'url', 'tel', 'date', 'time', '']);

/**
 * Where Space types a character, so it must stay a space: text fields, text areas, selects, editable text. Everywhere
 * else Space is play/pause (see below).
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

/** Arrow keys that mean something to the element itself (a slider, a text caret, a menu) must not also seek. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, button, a, [role="button"], [role="slider"], [role="menuitem"]') !== null;
}

/**
 * Spotify-style desktop keys: Space play/pause, ←/→ seek 5s, Ctrl/⌘ + ←/→ previous/next, Ctrl/⌘ + ↑/↓ volume.
 *
 * Space is play/pause wherever focus is, except while typing. It used to step aside whenever focus sat on any button,
 * link or slider, and since clicking something leaves it focused, Space after a click pressed that same button again
 * (skipped a song, reopened a menu) instead of pausing. Now the focused control's own Space press is cancelled: on
 * keydown here, which runs first (capture), and on keyup, where a button's Space click actually fires. Enter still
 * activates a focused button. The arrows keep stepping aside for controls that use them (the seek slider, menus).
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const { hasSong, onTogglePlay, onNext, onPrevious, onSeekBy, onVolumeBy } = handlers;

  useEffect(() => {
    const isPlaySpace = (event: KeyboardEvent) =>
      event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !isTypingTarget(event.target);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const modifier = event.ctrlKey || event.metaKey;

      if (isPlaySpace(event)) {
        if (!hasSong) return;
        // Cancels the page scroll and the focused control's own Space press, and keeps it from reaching that control's
        // own key handlers (a lyric line seeks on Space).
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) onTogglePlay();
        return;
      }
      if (isInteractiveTarget(event.target)) return;
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
    // A focused button clicks on Space's keyup, not keydown: cancel that too.
    const onKeyUp = (event: KeyboardEvent) => {
      if (hasSong && isPlaySpace(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [hasSong, onTogglePlay, onNext, onPrevious, onSeekBy, onVolumeBy]);
}
