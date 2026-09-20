import type { KeyboardEvent, PointerEvent } from 'react';
import { useRef } from 'react';
import { currentPaneWidth, resetPaneWidth, savePaneWidths, setPaneWidth, type Pane } from './paneWidths';
import styles from './PaneResizers.module.css';

const KEYBOARD_STEP_PX = 16;

function Handle({ pane, label }: { pane: Pane; label: string }) {
  const frame = useRef<number | null>(null);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
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
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      document.documentElement.classList.remove('is-resizing');
      savePaneWidths();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
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
      aria-label={label}
      tabIndex={0}
      className={[styles.handle, pane === 'sidebar' ? styles.sidebarHandle : styles.panelHandle].join(' ')}
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => resetPaneWidth(pane)}
      title="Seret untuk mengubah lebar — klik dua kali untuk mengembalikan"
    />
  );
}

/** The draggable dividers between the sidebar / main column / Now Playing panel (desktop only). */
export function PaneResizers({ panelOpen }: { panelOpen: boolean }) {
  return (
    <>
      <Handle pane="sidebar" label="Ubah lebar sidebar" />
      {panelOpen && <Handle pane="panel" label="Ubah lebar panel Sedang Diputar" />}
    </>
  );
}
