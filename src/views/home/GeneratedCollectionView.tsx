import type { ImageVariant, Song } from '../../api/types';
import { CollectionHero } from '../../components/CollectionHero/CollectionHero';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { SongRow } from '../../components/SongRow/SongRow';
import { SongRowActions } from '../../components/SongMenu/SongRowActions';
import { playSongList } from '../../playback/playSongList';
import { useUiStore } from '../../stores/uiStore';
import styles from './GeneratedCollectionView.module.css';

interface GeneratedCollectionViewProps {
  title: string;
  description: string;
  /** "Mix", "Chart", … — the small label above the title. */
  kind: string;
  songs: Song[];
  /** The collection's own art (an artist's photo); when absent, its first song's cover is used. */
  cover?: ImageVariant[];
  isLoading: boolean;
  onBack: () => void;
  /** Set for an artist mix: the name in the header then links to that artist's page. */
  artistName?: string;
}

/**
 * Read-only "made for you" track list (Temuan Mingguan, Lagi Viral di
 * Indonesia, Mix {artist}) — deliberately not a real UserPlaylist (no rename/delete/add),
 * since these are auto-generated and regenerate on their own schedule rather
 * than being something the user curates. Shares its header (CollectionHero) with
 * PlaylistDetail so both read as the same kind of screen.
 */
export function GeneratedCollectionView({ title, description, kind, songs, cover, isLoading, onBack, artistName }: GeneratedCollectionViewProps) {
  const openArtist = useUiStore((state) => state.openArtist);
  const images = cover && cover.length > 0 ? cover : (songs[0]?.image ?? []);

  return (
    <div className={styles.view}>
      <CollectionHero
        kind={kind}
        title={title}
        onTitleClick={artistName ? () => openArtist({ name: artistName }) : undefined}
        description={description}
        songs={songs}
        images={images}
        fallbackIcon="pulse"
        onBack={onBack}
        isLoading={isLoading}
      />

      <div className={styles.list}>
        {isLoading ? (
          <div className={styles.skeletonList}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={`gen-skeleton-${index}`} height={56} borderRadius="var(--radius-md)" />
            ))}
          </div>
        ) : songs.length === 0 ? (
          <p className={styles.empty}>Belum cukup data untuk bagian ini — coba dengarkan beberapa lagu dulu.</p>
        ) : (
          songs.map((song, index) => (
            <SongRow key={song.id} song={song} onClick={() => playSongList(songs, index)} trailing={<SongRowActions song={song} />} />
          ))
        )}
      </div>
    </div>
  );
}
