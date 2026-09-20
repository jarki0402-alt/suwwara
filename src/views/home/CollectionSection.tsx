import { Icon } from '../../components/Icon/Icon';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';
import cardStyles from './HorizontalSongCard.module.css';
import styles from './CollectionSection.module.css';
import { Shelf } from './Shelf';
import { ShelfCard } from './ShelfCard';

/**
 * Always-visible shortcut row (Liked Songs + any playlists) at the top of Home on a phone — unlike
 * the other Home sections, this never hides itself even with zero data, so the space
 * right under the header isn't just an empty gap before content loads in. Tapping a playlist
 * OPENS it (its songs, with play/shuffle there) rather than starting it, so a wrong tap costs nothing.
 */
export function CollectionSection() {
  const likedSongs = useLibraryStore((state) => state.likedSongs);
  const playlists = useLibraryStore((state) => state.playlists);
  const setView = useUiStore((state) => state.setView);
  const openPlaylist = useUiStore((state) => state.openPlaylist);

  return (
    <Shelf title="Koleksi Kamu" className={styles.collection}>
      <button type="button" className={cardStyles.card} onClick={() => setView('library')}>
        <span className={cardStyles.artWrapper}>
          <span className={styles.likedArt}>
            <Icon name="heart-filled" size={32} />
          </span>
        </span>
        <span className={cardStyles.title}>Lagu Disukai</span>
        <span className={cardStyles.subtitle}>{likedSongs.length} lagu</span>
      </button>

      {playlists.map((playlist) => (
        <ShelfCard
          key={playlist.id}
          title={playlist.name}
          subtitle={`${playlist.songs.length} lagu`}
          images={playlist.songs[0]?.image ?? []}
          onClick={() => openPlaylist(playlist.id)}
        />
      ))}
    </Shelf>
  );
}
