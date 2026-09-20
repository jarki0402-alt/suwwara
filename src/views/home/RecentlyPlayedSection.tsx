import { useMemo } from 'react';
import { getCachedSongs } from '../../api/songCache';
import { playSongRadio } from '../../playback/playSongRadio';
import { useHistoryStore } from '../../stores/historyStore';
import { HorizontalSongCard } from './HorizontalSongCard';
import { Shelf } from './Shelf';

const MAX_ITEMS = 15;

export function RecentlyPlayedSection() {
  const events = useHistoryStore((state) => state.events);

  const songs = useMemo(() => {
    const seen = new Set<string>();
    const orderedIds: string[] = [];
    for (let i = events.length - 1; i >= 0 && orderedIds.length < MAX_ITEMS; i--) {
      const id = events[i].songId;
      if (seen.has(id)) continue;
      seen.add(id);
      orderedIds.push(id);
    }
    return getCachedSongs(orderedIds);
  }, [events]);

  return (
    <Shelf
      title="Baru Diputar"
      hint="Lanjutkan mendengarkan dari trek terakhir"
      emptyText={songs.length === 0 ? 'Lagu yang kamu putar akan muncul di sini.' : undefined}
    >
      {songs.map((song) => (
        <HorizontalSongCard key={song.id} song={song} onClick={() => playSongRadio(song)} />
      ))}
    </Shelf>
  );
}
