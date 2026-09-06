import type { MouseEvent } from 'react';
import type { Song } from '../../api/types';
import { useLibraryStore } from '../../stores/libraryStore';
import { Icon } from '../Icon/Icon';
import styles from './LikeButton.module.css';

export function LikeButton({ song }: { song: Song }) {
  const isLiked = useLibraryStore((state) => state.isLiked(song.id));
  const toggleLike = useLibraryStore((state) => state.toggleLike);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toggleLike(song);
  };

  return (
    <button type="button" className={styles.button} onClick={handleClick} aria-label={isLiked ? 'Hapus dari lagu disukai' : 'Tambahkan ke lagu disukai'}>
      <Icon name={isLiked ? 'heart-filled' : 'heart'} size={24} className={isLiked ? styles.liked : undefined} />
    </button>
  );
}
