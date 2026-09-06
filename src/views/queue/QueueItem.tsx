import { forwardRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { primaryArtistNames } from '../../api/mappers';
import type { Song } from '../../api/types';
import { AddToPlaylistSheet } from '../../components/AddToPlaylistSheet/AddToPlaylistSheet';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { OptionsMenu } from '../../components/OptionsMenu/OptionsMenu';
import { playAtPosition, removeFromQueue, reorder } from '../../jam/jamQueueActions';
import { useLibraryStore } from '../../stores/libraryStore';
import { useQueueStore } from '../../stores/queueStore';
import styles from './QueueItem.module.css';

interface QueueItemProps {
  song: Song;
  position: number;
  isActive: boolean;
  isDragging: boolean;
  style?: CSSProperties;
  onDragStart: (clientY: number) => void;
  onDragMove: (clientY: number) => void;
  onDragEnd: () => void;
}

export const QueueItem = forwardRef<HTMLDivElement, QueueItemProps>(function QueueItem(
  { song, position, isActive, isDragging, style, onDragStart, onDragMove, onDragEnd },
  ref,
) {
  const currentPosition = useQueueStore((state) => state.position);
  const isLiked = useLibraryStore((state) => state.isLiked(song.id));
  const toggleLike = useLibraryStore((state) => state.toggleLike);

  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    onDragStart(event.clientY);
  };
  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => onDragMove(event.clientY);
  const handlePointerUp = () => onDragEnd();

  const handlePlayNext = () => {
    const target = position < currentPosition ? currentPosition : currentPosition + 1;
    reorder(position, target);
  };

  return (
    <div
      ref={ref}
      className={[styles.row, isActive ? styles.active : '', isDragging ? styles.dragging : ''].join(' ')}
      style={style}
    >
      <button
        type="button"
        className={styles.handle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-label="Geser buat urutkan ulang"
      >
        <Icon name="grip" size={16} />
      </button>

      <button type="button" className={styles.main} onClick={() => playAtPosition(position)}>
        <LazyImage images={song.image} quality="50x50" alt={song.name} className={styles.thumb} />
        <span className={styles.text}>
          <span className={styles.title}>{song.name}</span>
          <span className={styles.subtitle}>{primaryArtistNames(song)}</span>
        </span>
      </button>

      <button type="button" className={styles.iconButton} onClick={() => setAddToPlaylistOpen(true)} aria-label="Tambah ke playlist">
        <Icon name="plus" size={16} />
      </button>

      <OptionsMenu
        items={[
          {
            key: 'like',
            icon: isLiked ? 'heart-filled' : 'heart',
            label: isLiked ? 'Batal Sukai' : 'Sukai Lagu',
            onClick: () => toggleLike(song),
          },
          {
            key: 'play-next',
            icon: 'next',
            label: 'Putar Berikutnya',
            onClick: handlePlayNext,
            disabled: position === currentPosition,
          },
          {
            key: 'remove',
            icon: 'trash',
            label: 'Hapus dari Antrean',
            onClick: () => removeFromQueue(position),
            danger: true,
          },
        ]}
      />

      <AddToPlaylistSheet song={song} isOpen={addToPlaylistOpen} onClose={() => setAddToPlaylistOpen(false)} />
    </div>
  );
});
