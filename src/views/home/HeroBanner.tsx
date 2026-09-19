import { bestImageUrl, primaryArtistNames } from '../../api/mappers';
import { Icon } from '../../components/Icon/Icon';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { playSongRadio } from '../../playback/playSongRadio';
import { useTrendingSongs } from '../../recommendation/useTrendingSongs';
import styles from './HeroBanner.module.css';

/**
 * Full-bleed "featured track" banner at the top of Home — the app's biggest
 * single piece of album art, using the #1 trending track as the pick. Purely
 * a visual anchor + one-tap play shortcut; TopChartSection right below it
 * still lists the full top chart including this same track, so nothing here
 * is otherwise unreachable.
 */
export function HeroBanner() {
  const { songs, isLoading } = useTrendingSongs(1);
  const song = songs[0];

  if (isLoading) return <Skeleton width="100%" height={260} borderRadius="var(--radius-lg)" className={styles.skeleton} />;
  if (!song) return null;

  const backdropUrl = bestImageUrl(song.image, '500x500');

  return (
    <button type="button" className={styles.banner} onClick={() => playSongRadio(song)}>
      {backdropUrl && <img src={backdropUrl} alt="" aria-hidden="true" className={styles.backdrop} />}
      <span className={styles.scrim} aria-hidden="true" />
      <span className={styles.content}>
        <span className={styles.eyebrow}>Lagi ramai diputar</span>
        <span className={styles.title}>{song.name}</span>
        <span className={styles.subtitle}>{primaryArtistNames(song)}</span>
      </span>
      <span className={styles.playButton} aria-hidden="true">
        <Icon name="play" size={24} />
      </span>
    </button>
  );
}
