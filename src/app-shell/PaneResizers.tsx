import type { KeyboardEvent, PointerEvent } from 'react';
import { useEffect, useRef } from 'react';
import { useUiStore } from '../stores/uiStore';
import { currentPaneWidth, resetPaneWidth, savePaneWidths, setPaneWidth, type Pane } from './paneWidths';
import styles from './PaneResizers.module.css';
import { msg, useT } from '../i18n/i18n';

const KEYBOARD_STEP_PX = 16;

function Handle({ pane, label }: { pane: Pane; label: string }) {
  const t = useT();
  const frame = useRef<number | null>(null);
  // Ends the drag in progress, if any. The page-wide resize cursor (the is-resizing class) used to be removed only by a
  // pointerup on the handle, which does not always come: the button released outside the window, the window losing
  // focus mid-drag, the panel (and so its handle) closing mid-drag. The cursor then stayed "col-resize" for good.
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    endDrag.current?.();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    document.documentElement.classList.add('is-resizing');

    const onMove = (move: globalThis.PointerEvent) => {
      // One layout per frame however fast the pointer reports.
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        setPaneWidth(pane, pane === 'sidebar' ? move.clientX : window.innerWidth - move.clientX);
      });
    };
    const onUp = () => {
      if (endDrag.current !== onUp) return;
      endDrag.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      handle.removeEventListener('lostpointercapture', onUp);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('blur', onUp);
      document.documentElement.classList.remove('is-resizing');
      savePaneWidths();
    };
    endDrag.current = onUp;
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
    // Any of these also means the drag is over.
    handle.addEventListener('lostpointercapture', onUp);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('blur', onUp);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The right-hand panel grows when its left edge moves left, so the arrows mean the opposite there.
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    setPaneWidth(pane, currentPaneWidth(pane) + direction * KEYBOARD_STEP_PX * (pane === 'sidebar' ? 1 : -1));
    savePaneWidths();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t(label)}
      tabIndex={0}
      className={[styles.handle, pane === 'sidebar' ? styles.sidebarHandle : styles.panelHandle].join(' ')}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => resetPaneWidth(pane)}
      title={t('Seret untuk mengubah lebar, klik dua kali untuk mengembalikan')}
    />
  );
}

/** The draggable dividers between the sidebar / main column / Now Playing panel (desktop only). */
export function PaneResizers({ panelOpen }: { panelOpen: boolean }) {
  // Fullscreen Now Playing covers the whole window: there are no panes to resize, and the handles showed through as
  // thin vertical lines across the stage.
  const isFullscreen = useUiStore((state) => state.isNowPlayingFullscreen);
  if (isFullscreen) return null;
  return (
    <>
      <Handle pane="sidebar" label={msg('Ubah lebar sidebar')} />
      {panelOpen && <Handle pane="panel" label={msg('Ubah lebar panel kanan')} />}
    </>
  );
}
