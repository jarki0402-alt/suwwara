import { useEffect, useState } from 'react';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { getTopArtistMixes, type ArtistMix } from '../../recommendation/topArtistMix';
import { useUiStore } from '../../stores/uiStore';
import { Shelf } from './Shelf';
import { ShelfCard } from './ShelfCard';

/**
 * "Playlist" per artist the user keeps coming back to (from play history, then liked songs and
 * playlists). Tapping one opens its track list — same page the Dibuat Untukmu tiles open — instead
 * of starting playback. Hidden until there is at least one artist to name, like the other shelves.
 */
export function ArtistMixesSection() {
  const openCollection = useUiStore((state) => state.openCollection);
  const [mixes, setMixes] = useState<ArtistMix[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTopArtistMixes()
      .then((result) => {
        if (!cancelled) setMixes(result);
      })
      .catch(() => {
        if (!cancelled) setMixes([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mixes !== null && mixes.length === 0) return null;

  return (
    <Shelf title="Playlist Artis Favoritmu" hint="Lagu populer dari artis yang sering kamu dengarkan">
      {mixes === null
        ? Array.from({ length: 5 }).map((_, index) => <Skeleton key={`mix-skeleton-${index}`} width={124} height={160} borderRadius="14px" />)
        : mixes.map((mix) => (
            <ShelfCard
              key={mix.artistName}
              title={`Mix ${mix.artistName}`}
              subtitle="Mix artis"
              images={mix.image.length > 0 ? mix.image : (mix.songs[0]?.image ?? [])}
              onClick={() => openCollection(`artist-mix:${mix.artistName}`)}
            />
          ))}
    </Shelf>
  );
}
