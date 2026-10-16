import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { enterAppFullscreenOnFirstInput, isFullscreenSupported, toggleAppFullscreen } from '../utils/documentFullscreen';

/** A key typed into a field is text, not a shortcut. */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') !== null);
}

/**
 * Whole-app fullscreen and the installed desktop app's window look, wired once in AppShell.
 * - F toggles fullscreen (like a video player); "Buka dalam layar penuh" arms it for the first click or key.
 * - data-wco on <html> while the installed app draws its own title bar (Window Controls Overlay, Chrome/Edge desktop):
 *   CSS then moves everything below the window buttons (--titlebar-height, see global.css). Read from the display
 *   mode itself, so it also drops when the user collapses the overlay or the window goes fullscreen.
 */
export function useAppFullscreen(): void {
  useEffect(() => {
    if (!isFullscreenSupported || !useSettingsStore.getState().openInFullscreen) return;
    return enterAppFullscreenOnFirstInput();
  }, []);

  useEffect(() => {
    if (!isFullscreenSupported) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyF' || event.repeat || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      event.preventDefault();
      toggleAppFullscreen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(display-mode: window-controls-overlay)');
    const apply = () => document.documentElement.toggleAttribute('data-wco', query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
}
