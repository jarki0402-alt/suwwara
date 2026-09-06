import { Skeleton } from '../../components/Skeleton/Skeleton';
import { playSongRadio } from '../../playback/playSongRadio';
import { useTrendingSongs } from '../../recommendation/useTrendingSongs';
import { HorizontalSongCard } from './HorizontalSongCard';
import styles from './RecentlyPlayedSection.module.css';

export function TopChartSection() {
  const { songs, isLoading } = useTrendingSongs(15);

  if (!isLoading && songs.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Top Chart Hari Ini</h2>
      <div className={styles.scroller}>
        {isLoading
          ? Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={`chart-skeleton-${index}`} width={136} height={136} borderRadius="14px" />
            ))
          : songs.map((song, index) => (
              <HorizontalSongCard key={song.id} song={song} rank={index + 1} onClick={() => playSongRadio(song)} />
            ))}
      </div>
    </section>
  );
}
