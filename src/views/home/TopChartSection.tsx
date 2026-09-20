import { LikeButton } from '../../components/LikeButton/LikeButton';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { SongRow } from '../../components/SongRow/SongRow';
import { playSongRadio } from '../../playback/playSongRadio';
import { useTrendingSongs } from '../../recommendation/useTrendingSongs';
import sectionStyles from './RecentlyPlayedSection.module.css';
import styles from './TopChartSection.module.css';

const VISIBLE_ROWS = 10;

/** The day's chart as a ranked list (01, 02, …) — quieter and denser than a strip of big covers. */
export function TopChartSection() {
  const { songs, isLoading } = useTrendingSongs(15);

  if (!isLoading && songs.length === 0) return null;

  return (
    <section className={sectionStyles.section}>
      <div className={styles.headingRow}>
        <div>
          <h2 className={styles.heading}>Tangga Lagu Teratas</h2>
          <p className={styles.hint}>Diperbarui setiap hari untuk pendengar di Indonesia</p>
        </div>
        <span className={styles.tag}>Live Chart</span>
      </div>

      <div className={styles.list}>
        {isLoading
          ? Array.from({ length: 5 }).map((_, index) => (
              <div key={`chart-skeleton-${index}`} className={styles.row}>
                <Skeleton height={48} borderRadius="10px" />
              </div>
            ))
          : songs.slice(0, VISIBLE_ROWS).map((song, index) => (
              <div key={song.id} className={styles.row}>
                <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span>
                <SongRow song={song} onClick={() => playSongRadio(song)} trailing={<LikeButton song={song} />} />
              </div>
            ))}
      </div>
    </section>
  );
}
