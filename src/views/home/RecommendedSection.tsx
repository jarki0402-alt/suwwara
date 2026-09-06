import { useMemo } from 'react';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { playSongRadio } from '../../playback/playSongRadio';
import { useRecommendations } from '../../recommendation/useRecommendations';
import { useQueueStore } from '../../stores/queueStore';
import { HorizontalSongCard } from './HorizontalSongCard';
import styles from './RecentlyPlayedSection.module.css';

export function RecommendedSection() {
  const queue = useQueueStore((state) => state.queue);
  const excludeIds = useMemo(() => queue.map((song) => song.id), [queue]);
  const { songs, isLoading } = useRecommendations(excludeIds);

  if (!isLoading && songs.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Rekomendasi Untukmu</h2>
      <div className={styles.scroller}>
        {isLoading
          ? Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={`rec-skeleton-${index}`} width={132} height={132} borderRadius="14px" />
            ))
          : songs.map((song) => <HorizontalSongCard key={song.id} song={song} onClick={() => playSongRadio(song)} />)}
      </div>
    </section>
  );
}
