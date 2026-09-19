import type { Song } from '../../api/types';
import { primaryArtistNames } from '../../api/mappers';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import styles from './HorizontalSongCard.module.css';

interface HorizontalSongCardProps {
  song: Song;
  onClick: () => void;
  rank?: number;
}

export function HorizontalSongCard({ song, onClick, rank }: HorizontalSongCardProps) {
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <span className={styles.artWrapper}>
        <LazyImage images={song.image} quality="150x150" alt={song.name} className={styles.art} />
        {/* Painted before the rank badge (later in DOM = on top for two
            same-stacking-level absolute siblings) so the hover dim doesn't
            wash out the badge's number — it stays crisp on top instead of
            getting darkened along with the artwork underneath it. */}
        <span className={styles.playOverlay} aria-hidden="true">
          <Icon name="play" size={18} />
        </span>
        {rank !== undefined && <span className={styles.rankBadge}>{rank}</span>}
      </span>
      <span className={styles.title}>{song.name}</span>
      <span className={styles.subtitle}>{primaryArtistNames(song)}</span>
    </button>
  );
}
