import { useMemo } from 'react';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { playSongRadio } from '../../playback/playSongRadio';
import { useRecommendations } from '../../recommendation/useRecommendations';
import { useQueueStore } from '../../stores/queueStore';
import { HorizontalSongCard } from './HorizontalSongCard';
import { Shelf } from './Shelf';

export function RecommendedSection() {
  const queue = useQueueStore((state) => state.queue);
  const excludeIds = useMemo(() => queue.map((song) => song.id), [queue]);
  const { songs, isLoading } = useRecommendations(excludeIds);

  if (!isLoading && songs.length === 0) return null;

  return (
    <Shelf title="Rekomendasi Untukmu">
      {isLoading
        ? Array.from({ length: 5 }).map((_, index) => <Skeleton key={`rec-skeleton-${index}`} width={124} height={160} borderRadius="14px" />)
        : songs.map((song) => <HorizontalSongCard key={song.id} song={song} onClick={() => playSongRadio(song)} />)}
    </Shelf>
  );
}
