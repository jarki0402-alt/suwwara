import type { MouseEvent } from 'react';
import type { Song } from '../../api/types';
import { useT } from '../../i18n/i18n';
import { useLibraryStore } from '../../stores/libraryStore';
import { usePodcastStore } from '../../podcast/podcastStore';
import { songToEpisode } from '../../podcast/playEpisode';
import { Icon } from '../Icon/Icon';
import styles from './LikeButton.module.css';

/** `size` is the icon's; 20 is the app's standard control icon (same as ⋯ beside it), 24 for the big Now Playing sheet. */
export function LikeButton({ song, size = 20 }: { song: Song; size?: number }) {
  // A podcast episode is saved for later instead: Lagu Disukai is music, and an hour-long story in it would play in
  // the middle of a liked-songs shuffle.
  if (song.kind === 'episode') return <SaveEpisodeButton song={song} size={size} />;
  return <SongLikeButton song={song} size={size} />;
}

function SaveEpisodeButton({ song, size }: { song: Song; size: number }) {
  const t = useT();
  const isSaved = usePodcastStore((state) => state.isSaved(song.id));
  const toggleSaved = usePodcastStore((state) => state.toggleSaved);
  return (
    <button
      type="button"
      className={styles.button}
      onClick={(event) => {
        event.stopPropagation();
        toggleSaved(songToEpisode(song));
      }}
      aria-label={isSaved ? t('Hapus dari simpanan') : t('Simpan untuk nanti')}
      aria-pressed={isSaved}
    >
      <Icon name={isSaved ? 'check' : 'plus'} size={size} className={isSaved ? styles.liked : undefined} />
    </button>
  );
}

function SongLikeButton({ song, size }: { song: Song; size: number }) {
  const t = useT();
  const isLiked = useLibraryStore((state) => state.isLiked(song.id));
  const toggleLike = useLibraryStore((state) => state.toggleLike);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toggleLike(song);
  };

  return (
    <button type="button" className={styles.button} onClick={handleClick} aria-label={isLiked ? t('Hapus dari lagu disukai') : t('Tambahkan ke lagu disukai')}>
      <Icon name={isLiked ? 'heart-filled' : 'heart'} size={size} className={isLiked ? styles.liked : undefined} />
    </button>
  );
}
