import { useRef, useState } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { cycleRepeat, reorder, toggleShuffle } from '../../jam/jamQueueActions';
import { useQueueStore } from '../../stores/queueStore';
import { useUiStore } from '../../stores/uiStore';
import { QueueItem } from './QueueItem';
import styles from './QueueView.module.css';

const REPEAT_LABEL: Record<'off' | 'all' | 'one', string> = {
  off: 'Ulang',
  all: 'Ulang Semua',
  one: 'Ulang Satu',
};

export function QueueView() {
  const queue = useQueueStore((state) => state.queue);
  const order = useQueueStore((state) => state.order);
  const position = useQueueStore((state) => state.position);
  const shuffle = useQueueStore((state) => state.shuffle);
  const repeatMode = useQueueStore((state) => state.repeatMode);
  const closeQueue = useUiStore((state) => state.closeQueue);

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rowHeightRef = useRef(0);
  const dragStartYRef = useRef(0);
  const dragFromRef = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);

  // Imperative per-pixel updates (matching ProgressBar's setProgress pattern) for the
  // dragged row itself — a React re-render per pointermove would be needless overhead
  // and risks visible lag on a long queue. Only the *target index* (which changes far
  // less often) goes through state, since that's what the other rows' CSS-eased shift
  // depends on.
  const handleDragStart = (pos: number, clientY: number) => {
    const row = rowRefs.current[pos];
    rowHeightRef.current = row?.getBoundingClientRect().height ?? 0;
    dragStartYRef.current = clientY;
    dragFromRef.current = pos;
    setDragIndex(pos);
    setTargetIndex(pos);
  };

  // The list below only renders from the currently-playing song onward (already-played
  // ones drop out of view — see visibleOrder), so all drag state here is in terms of
  // that VISIBLE index, 0 at the currently-playing row. Only handleDragEnd needs to
  // translate back to the store's absolute order-array position before calling reorder.
  const visibleOrder = order.slice(position);

  const handleDragMove = (clientY: number) => {
    const from = dragFromRef.current;
    if (from === null || rowHeightRef.current === 0) return;
    const deltaY = clientY - dragStartYRef.current;

    const draggedRow = rowRefs.current[from];
    if (draggedRow) draggedRow.style.transform = `translateY(${deltaY}px)`;

    const steps = Math.round(deltaY / rowHeightRef.current);
    const nextTarget = Math.min(Math.max(from + steps, 0), visibleOrder.length - 1);
    setTargetIndex((prev) => (prev === nextTarget ? prev : nextTarget));
  };

  const handleDragEnd = () => {
    const from = dragFromRef.current;
    if (from !== null) {
      const draggedRow = rowRefs.current[from];
      if (draggedRow) draggedRow.style.transform = '';
      if (targetIndex !== null && targetIndex !== from) reorder(position + from, position + targetIndex);
    }
    dragFromRef.current = null;
    setDragIndex(null);
    setTargetIndex(null);
  };

  const shiftStyleFor = (pos: number) => {
    if (dragIndex === null || targetIndex === null || pos === dragIndex) return undefined;
    const inRange = dragIndex < targetIndex ? pos > dragIndex && pos <= targetIndex : pos < dragIndex && pos >= targetIndex;
    if (!inRange) return undefined;
    const shift = dragIndex < targetIndex ? -rowHeightRef.current : rowHeightRef.current;
    return { transform: `translateY(${shift}px)`, transition: 'transform 150ms ease' };
  };

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <span className={styles.title}>Antrean Putar</span>
        <button type="button" className={styles.closeButton} onClick={closeQueue} aria-label="Tutup antrean">
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className={styles.controlsRow}>
        <button
          type="button"
          className={[styles.pill, shuffle ? styles.pillActive : ''].join(' ')}
          onClick={toggleShuffle}
        >
          <Icon name="shuffle" size={16} />
          Acak
        </button>
        <button
          type="button"
          className={[styles.pill, repeatMode !== 'off' ? styles.pillActive : ''].join(' ')}
          onClick={cycleRepeat}
        >
          <Icon name={repeatMode === 'one' ? 'repeat-one' : 'repeat'} size={16} />
          {REPEAT_LABEL[repeatMode]}
        </button>
      </div>

      {visibleOrder.length === 0 ? (
        <p className={styles.empty}>Antrean kosong.</p>
      ) : (
        <div className={styles.list}>
          {visibleOrder.map((queueIndex, pos) => {
            const song = queue[queueIndex];
            if (!song) return null;
            const realPosition = position + pos;
            return (
              <QueueItem
                key={`${song.id}-${realPosition}`}
                ref={(el) => {
                  rowRefs.current[pos] = el;
                }}
                song={song}
                position={realPosition}
                isActive={pos === 0}
                isDragging={pos === dragIndex}
                style={shiftStyleFor(pos)}
                onDragStart={(clientY) => handleDragStart(pos, clientY)}
                onDragMove={handleDragMove}
                onDragEnd={handleDragEnd}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
