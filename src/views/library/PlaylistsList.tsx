import { useState } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { PlaylistNameDialog } from '../../components/PlaylistNameDialog/PlaylistNameDialog';
import { useLibraryStore } from '../../stores/libraryStore';
import styles from './LibraryView.module.css';

interface PlaylistsListProps {
  onSelectPlaylist: (playlistId: string) => void;
}

export function PlaylistsList({ onSelectPlaylist }: PlaylistsListProps) {
  const playlists = useLibraryStore((state) => state.playlists);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const [isCreateOpen, setCreateOpen] = useState(false);

  const handleConfirmCreate = (name: string) => {
    const playlist = createPlaylist(name);
    setCreateOpen(false);
    onSelectPlaylist(playlist.id);
  };

  return (
    <div className={styles.grid}>
      <button type="button" className={styles.createCard} onClick={() => setCreateOpen(true)}>
        <div className={styles.createCardArt}>
          <Icon name="plus" size={22} />
        </div>
        <span className={styles.cardTitle}>Playlist Baru</span>
        {/* Empty second line matching .cardSubtitle's height below a real playlist's
            song count — keeps both card shapes exactly the same total height. */}
        <span className={styles.cardSubtitle} aria-hidden="true">
          &nbsp;
        </span>
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

      <PlaylistNameDialog
        isOpen={isCreateOpen}
        title="Playlist Baru"
        confirmLabel="Buat"
        onConfirm={handleConfirmCreate}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
