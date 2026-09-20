import type { Song } from '../../api/types';
import { Icon } from '../../components/Icon/Icon';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { SongRow } from '../../components/SongRow/SongRow';
import { playSongList } from '../../playback/playSongList';
import { useUiStore } from '../../stores/uiStore';
import styles from './GeneratedCollectionView.module.css';

interface GeneratedCollectionViewProps {
  title: string;
  description: string;
  songs: Song[];
  isLoading: boolean;
  onBack: () => void;
  /** Set for an artist mix: the name in the header then links to that artist's page. */
  artistName?: string;
}

/**
 * Read-only "made for you" track list (Temuan Mingguan, Lagi Viral di
 * Indonesia) — deliberately not a real UserPlaylist (no rename/delete/add),
 * since these are auto-generated and regenerate on their own schedule rather
 * than being something the user curates. Mirrors PlaylistDetail's layout
 * (LibraryView.module.css) closely enough that it reads as the same kind of
 * screen, just without the editing affordances that don't apply here.
 */
export function GeneratedCollectionView({ title, description, songs, isLoading, onBack, artistName }: GeneratedCollectionViewProps) {
  const openArtist = useUiStore((state) => state.openArtist);
  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <button type="button" className={styles.iconButton} onClick={onBack} aria-label="Kembali">
          <Icon name="chevron-left" size={18} />
        </button>
        {artistName ? (
          <button type="button" className={[styles.title, styles.titleLink].join(' ')} onClick={() => openArtist({ name: artistName })}>
            {title}
          </button>
        ) : (
          <span className={styles.title}>{title}</span>
        )}
        <span className={styles.headerSpacer} />
      </div>

      <p className={styles.description}>{description}</p>

      {!isLoading && songs.length > 0 && (
        <button type="button" className={styles.playAllButton} onClick={() => playSongList(songs, 0)}>
          <Icon name="play" size={18} />
          Putar Semua
        </button>
      )}

      {isLoading ? (
        <div className={styles.skeletonList}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`gen-skeleton-${index}`} height={56} borderRadius="var(--radius-md)" />
          ))}
        </div>
      ) : songs.length === 0 ? (
        <p className={styles.empty}>Belum cukup data untuk bagian ini — coba dengarkan beberapa lagu dulu.</p>
      ) : (
        <div>
          {songs.map((song, index) => (
            <SongRow key={song.id} song={song} onClick={() => playSongList(songs, index)} />
          ))}
        </div>
      )}
    </div>
  );
}
