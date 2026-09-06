import { forwardRef, useImperativeHandle, useRef, useState, type PointerEvent } from 'react';
import styles from './ProgressBar.module.css';

export interface ProgressBarHandle {
  /** Imperative update path — called from the shared frameTicker rAF loop, never via React state/re-render. */
  setProgress: (fraction: number) => void;
}

interface ProgressBarProps {
  onSeekFraction?: (fraction: number) => void;
  ariaLabel?: string;
  /** Thin, non-interactive rendering for tight spaces (e.g. MiniPlayer) — the full-size
   * touch target/drag thumb only makes sense where seeking is actually offered. */
  compact?: boolean;
}

export const ProgressBar = forwardRef<ProgressBarHandle, ProgressBarProps>(function ProgressBar(
  { onSeekFraction, ariaLabel, compact },
  ref,
) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const applyFraction = (fraction: number) => {
    const clamped = Math.min(Math.max(fraction, 0), 1);
    if (fillRef.current) fillRef.current.style.width = `${clamped * 100}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${clamped * 100}%`;
  };

  useImperativeHandle(ref, () => ({
    setProgress(fraction: number) {
      // While the user is dragging, the frameTicker's live position pushes would
      // otherwise fight the thumb the user is actively moving — ignore them until release.
      if (isDraggingRef.current) return;
      applyFraction(fraction);
    },
  }));

  const fractionFromEvent = (clientX: number): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width === 0) return 0;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onSeekFraction) return;
    isDraggingRef.current = true;
    setIsDragging(true);
    trackRef.current?.setPointerCapture(event.pointerId);
    applyFraction(fractionFromEvent(event.clientX));
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    applyFraction(fractionFromEvent(event.clientX));
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    onSeekFraction?.(fractionFromEvent(event.clientX));
  };

  return (
    <div
      ref={trackRef}
      className={[styles.track, compact ? styles.compact : '', isDragging ? styles.dragging : ''].join(' ')}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      role="slider"
      aria-label={ariaLabel ?? 'Posisi lagu'}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div ref={fillRef} className={styles.fill} />
      <div ref={thumbRef} className={styles.thumb} />
    </div>
  );
});
