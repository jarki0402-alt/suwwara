import { useState } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { PlaylistNameDialog } from '../../components/PlaylistNameDialog/PlaylistNameDialog';
import { SpotifyImportSheet } from '../../components/SpotifyImport/SpotifyImportSheet';
import { useSpotifyImportStore } from '../../import/spotifyImport';
import { useT } from '../../i18n/i18n';
import { useLibraryStore } from '../../stores/libraryStore';
import { LIKED_SONGS_ID } from '../../stores/uiStore';
import styles from './LibraryView.module.css';

interface PlaylistsListProps {
  onSelectPlaylist: (playlistId: string) => void;
}

export function PlaylistsList({ onSelectPlaylist }: PlaylistsListProps) {
  const t = useT();
  const playlists = useLibraryStore((state) => state.playlists);
  const likedCount = useLibraryStore((state) => state.likedSongs.length);
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

  const importLabel =
    importStatus && !importFinished
      ? t('Mengimpor {done} dari {total} lagu', { done: importStatus.done, total: importStatus.total })
      : importFinished
        ? t('Impor selesai')
        : t('Impor dari Spotify');

  return (
    <>
    {/* Actions above the grid, so the grid holds only what is in the library (it used to mix "new" and "import" in as
        if they were empty playlists). */}
    <div className={styles.actionsRow}>
      <button type="button" className={styles.actionPill} onClick={() => setCreateOpen(true)}>
        <Icon name="plus" size={16} />
        {t('Playlist baru')}
      </button>
      <button type="button" className={styles.actionPill} onClick={() => setImportOpen(true)}>
        <Icon name="download" size={16} />
        {importLabel}
      </button>
    </div>
    <div className={styles.grid}>
      {/* Lagu Disukai first, as a playlist among the playlists (its own page: LikedSongsList with onBack). */}
      <button type="button" className={styles.card} onClick={() => onSelectPlaylist(LIKED_SONGS_ID)}>
        <div className={[styles.cardArt, styles.likedArt].join(' ')}>
          <Icon name="heart-filled" size={44} />
        </div>
        <span className={styles.cardTitle}>{t('Lagu Disukai')}</span>
        <span className={styles.cardSubtitle}>{t('{n} lagu', { n: likedCount })}</span>
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
    </>
  );
}
