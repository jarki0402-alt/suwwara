import type { MouseEvent } from 'react';
import type { Song } from '../../api/types';
import { useLibraryStore } from '../../stores/libraryStore';
import { Icon } from '../Icon/Icon';
import styles from './LikeButton.module.css';

/** `size` is the icon's; 20 is the app's standard control icon (same as ⋯ beside it), 24 for the big Now Playing sheet. */
export function LikeButton({ song, size = 20 }: { song: Song; size?: number }) {
  const isLiked = useLibraryStore((state) => state.isLiked(song.id));
  const toggleLike = useLibraryStore((state) => state.toggleLike);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toggleLike(song);
  };

  return (
    <button type="button" className={styles.button} onClick={handleClick} aria-label={isLiked ? 'Hapus dari lagu disukai' : 'Tambahkan ke lagu disukai'}>
      <Icon name={isLiked ? 'heart-filled' : 'heart'} size={size} className={isLiked ? styles.liked : undefined} />
    </button>
  );
}
