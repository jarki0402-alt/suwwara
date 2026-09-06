import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { useLibraryStore } from '../../stores/libraryStore';
import styles from './LibraryView.module.css';

interface PlaylistsListProps {
  onSelectPlaylist: (playlistId: string) => void;
}

export function PlaylistsList({ onSelectPlaylist }: PlaylistsListProps) {
  const playlists = useLibraryStore((state) => state.playlists);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);

  const handleCreate = () => {
    const name = window.prompt('Nama playlist baru:', 'Playlist Baru');
    if (name === null) return;
    const playlist = createPlaylist(name);
    onSelectPlaylist(playlist.id);
  };

  return (
    <div className={styles.grid}>
      <button type="button" className={styles.createCard} onClick={handleCreate}>
        <Icon name="plus" size={22} />
        <span>Playlist Baru</span>
      </button>
      {playlists.map((playlist) => (
        <button key={playlist.id} type="button" className={styles.card} onClick={() => onSelectPlaylist(playlist.id)}>
          <div className={styles.cardArt}>
            {playlist.songs[0] ? (
              <LazyImage images={playlist.songs[0].image} quality="150x150" alt={playlist.name} className={styles.art} />
            ) : (
              <div className={styles.artPlaceholder} />
            )}
          </div>
          <span className={styles.cardTitle}>{playlist.name}</span>
          <span className={styles.cardSubtitle}>{playlist.songs.length} lagu</span>
        </button>
      ))}
    </div>
  );
}
