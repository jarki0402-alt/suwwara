import { useState } from 'react';
import { getArtistAllSongs, getArtistPage, resolveArtistId, type ArtistPageData } from '../../api/endpoints/artistPage';
import type { Song } from '../../api/types';
import { Icon } from '../../components/Icon/Icon';
import { LikeButton } from '../../components/LikeButton/LikeButton';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { SongRow } from '../../components/SongRow/SongRow';
import { playSongList } from '../../playback/playSongList';
import { useUiStore, type DetailRoute } from '../../stores/uiStore';
import { ArtistInfo } from '../now-playing/ArtistInfo';
import styles from './Detail.module.css';
import { ShelfCard } from './ShelfCard';
import { useLoaded, type Loaded } from './useLoaded';

const POPULAR_COUNT = 5;

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function ArtistView({ route }: { route: Extract<DetailRoute, { type: 'artist' }> }) {
  const closeDetail = useUiStore((state) => state.closeDetail);
  const key = route.artistId ?? `name:${route.name ?? ''}`;

  const page = useLoaded<ArtistPageData>(key, async () => {
    const artistId = route.artistId ?? (route.name ? await resolveArtistId(route.name) : null);
    if (!artistId) throw new Error('artist not found');
    return getArtistPage(artistId);
  });

  if (page.status === 'loading') return <ArtistSkeleton onBack={closeDetail} />;
  if (page.status === 'error') {
    return (
      <div className={styles.view}>
        <div className={styles.hero} style={{ minHeight: 120 }}>
          <button type="button" className={styles.backButton} onClick={closeDetail} aria-label="Kembali">
            <Icon name="chevron-left" size={18} />
          </button>
        </div>
        <p className={styles.status}>Artis ini belum bisa dimuat. Coba lagi sebentar lagi.</p>
      </div>
    );
  }
  return <ArtistPage data={page.data} />;
}

function ArtistSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className={styles.view}>
      <div className={styles.hero}>
        <button type="button" className={styles.backButton} onClick={onBack} aria-label="Kembali">
          <Icon name="chevron-left" size={18} />
        </button>
      </div>
      <div className={styles.skeletonStack}>
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={`artist-skeleton-${index}`} height={56} borderRadius="var(--radius-md)" />
        ))}
      </div>
    </div>
  );
}

function ArtistPage({ data }: { data: ArtistPageData }) {
  const closeDetail = useUiStore((state) => state.closeDetail);
  const openAlbum = useUiStore((state) => state.openAlbum);
  const openArtist = useUiStore((state) => state.openArtist);
  const [showAll, setShowAll] = useState(false);
  const allSongs = useLoaded<Song[]>(showAll ? `all:${data.artistId}` : 'all:idle', () =>
    showAll ? getArtistAllSongs(data.artistId) : Promise.resolve([]),
  );

  const songs: Song[] = showAll && allSongs.status === 'ready' && allSongs.data.length > 0 ? allSongs.data : data.topSongs;
  const visible = showAll ? songs : songs.slice(0, POPULAR_COUNT);
  const canShowMore = data.topSongs.length > 0 || data.albums.length > 0;

  return (
    <div className={styles.view}>
      <div className={styles.hero}>
        {data.banner && <img className={styles.heroImage} src={data.banner} alt="" decoding="async" />}
        <div className={styles.heroScrim} />
        <button type="button" className={styles.backButton} onClick={closeDetail} aria-label="Kembali">
          <Icon name="chevron-left" size={18} />
        </button>
        <h1 className={styles.heroName}>{data.name}</h1>
      </div>

      <div className={styles.body}>
        {songs.length > 0 && (
          <div className={styles.actions}>
            <button type="button" className={styles.playButton} onClick={() => playSongList(songs, 0)} aria-label={`Putar ${data.name}`}>
              <Icon name="play" size={24} />
            </button>
            <button type="button" className={styles.roundButton} onClick={() => playSongList(shuffled(songs), 0)} aria-label="Putar acak">
              <Icon name="shuffle" size={20} />
            </button>
          </div>
        )}

        {data.topSongs.length > 0 && (
          <section>
            <h2 className={styles.sectionTitle}>Populer</h2>
            <div className={showAll ? styles.longList : undefined}>
              {visible.map((song, index) => (
                <div key={song.id} className={styles.rankedRow}>
                  <span className={styles.rank}>{index + 1}</span>
                  <SongRow song={song} onClick={() => playSongList(songs, index)} trailing={<LikeButton song={song} />} />
                </div>
              ))}
            </div>
            {showAll && allSongs.status === 'loading' && (
              <div className={styles.skeletonStack} style={{ padding: 0 }}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={`all-skeleton-${index}`} height={56} borderRadius="var(--radius-md)" />
                ))}
              </div>
            )}
            {canShowMore && (
              <button type="button" className={styles.textButton} onClick={() => setShowAll((value) => !value)}>
                {showAll ? 'Lebih sedikit' : 'Lihat semua lagu'}
              </button>
            )}
          </section>
        )}

        {data.albums.length > 0 && (
          <section>
            <h2 className={styles.sectionTitle}>Album</h2>
            <div className={styles.shelf}>
              {data.albums.map((album) => (
                <ShelfCard key={album.id} title={album.name} meta={[album.year, 'Album'].filter(Boolean).join(' · ')} imageUrl={album.thumbnail} onClick={() => openAlbum(album.id)} />
              ))}
            </div>
          </section>
        )}

        {data.singles.length > 0 && (
          <section>
            <h2 className={styles.sectionTitle}>Single & EP</h2>
            <div className={styles.shelf}>
              {data.singles.map((single) => (
                <ShelfCard key={single.id} title={single.name} meta={[single.year, 'Single'].filter(Boolean).join(' · ')} imageUrl={single.thumbnail} onClick={() => openAlbum(single.id)} />
              ))}
            </div>
          </section>
        )}

        {data.similarArtists.length > 0 && (
          <section>
            <h2 className={styles.sectionTitle}>Artis serupa</h2>
            <div className={styles.shelf}>
              {data.similarArtists.map((similar) => (
                <ShelfCard key={similar.id} round title={similar.name} imageUrl={similar.thumbnail} onClick={() => openArtist({ artistId: similar.id, name: similar.name })} />
              ))}
            </div>
          </section>
        )}

        <ArtistInfo artistName={data.name} />
      </div>
    </div>
  );
}

export type { Loaded };
