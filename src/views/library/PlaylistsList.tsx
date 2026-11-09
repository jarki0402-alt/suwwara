import { useState } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { PlaylistNameDialog } from '../../components/PlaylistNameDialog/PlaylistNameDialog';
import { SpotifyImportSheet } from '../../components/SpotifyImport/SpotifyImportSheet';
import { useSpotifyImportStore } from '../../import/spotifyImport';
import { useT } from '../../i18n/i18n';
import { useLibraryStore } from '../../stores/libraryStore';
import styles from './LibraryView.module.css';

interface PlaylistsListProps {
  onSelectPlaylist: (playlistId: string) => void;
}

export function PlaylistsList({ onSelectPlaylist }: PlaylistsListProps) {
  const t = useT();
  const playlists = useLibraryStore((state) => state.playlists);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [isImportOpen, setImportOpen] = useState(false);
  const importStatus = useSpotifyImportStore((state) => (state.importId ? state.status : null));
  const importFinished = useSpotifyImportStore((state) => state.finished);

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
        <span className={styles.cardTitle}>{t('Playlist Baru')}</span>
        {/* Empty second line matching .cardSubtitle's height below a real playlist's
            song count — keeps both card shapes exactly the same total height. */}
        <span className={styles.cardSubtitle} aria-hidden="true">
          {'\u00a0'}
        </span>
      </button>
      <button type="button" className={styles.createCard} onClick={() => setImportOpen(true)}>
        <div className={styles.createCardArt}>
          <Icon name="download" size={22} />
        </div>
        <span className={styles.cardTitle}>{t('Impor dari Spotify')}</span>
        <span className={styles.cardSubtitle}>
          {importStatus && !importFinished
            ? t('{done} dari {total} lagu', { done: importStatus.done, total: importStatus.total })
            : importFinished
              ? t('Impor selesai')
              : '\u00a0'}
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
          <span className={styles.cardSubtitle}>{t('{n} lagu', { n: playlist.songs.length })}</span>
        </button>
      ))}

      <SpotifyImportSheet isOpen={isImportOpen} onClose={() => setImportOpen(false)} />
      <PlaylistNameDialog
        isOpen={isCreateOpen}
        title={t('Playlist Baru')}
        confirmLabel={t('Buat')}
        onConfirm={handleConfirmCreate}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}
