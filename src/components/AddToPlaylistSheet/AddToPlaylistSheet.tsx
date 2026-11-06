import { useState } from 'react';
import type { Song } from '../../api/types';
import { useT } from '../../i18n/i18n';
import { useLibraryStore } from '../../stores/libraryStore';
import { Icon } from '../Icon/Icon';
import { LazyImage } from '../Image/LazyImage';
import { Modal } from '../Modal/Modal';
import modal from '../Modal/Modal.module.css';
import { PlaylistNameDialog } from '../PlaylistNameDialog/PlaylistNameDialog';
import { useToast } from '../Toast/ToastProvider';
import styles from './AddToPlaylistSheet.module.css';

interface AddToPlaylistSheetProps {
  song: Song;
  isOpen: boolean;
  onClose: () => void;
}

/** Reusable popup for adding a song to an existing (or brand new) playlist — self-contained enough to call from anywhere. */
export function AddToPlaylistSheet({ song, isOpen, onClose }: AddToPlaylistSheetProps) {
  const playlists = useLibraryStore((state) => state.playlists);
  const addSongToPlaylist = useLibraryStore((state) => state.addSongToPlaylist);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const t = useT();
  const { showToast } = useToast();
  const [isCreateOpen, setCreateOpen] = useState(false);

  const handleAdd = (playlistId: string, playlistName: string) => {
    addSongToPlaylist(playlistId, song);
    showToast(t('Ditambahkan ke "{name}".', { name: playlistName }));
    onClose();
  };

  const handleConfirmCreate = (name: string) => {
    const playlist = createPlaylist(name);
    addSongToPlaylist(playlist.id, song);
    showToast(t('Dibuat & ditambahkan ke "{name}".', { name: playlist.name }));
    setCreateOpen(false);
    onClose();
  };

  return (
    <>
      <Modal isOpen={isOpen && !isCreateOpen} onClose={onClose} label={t('Simpan ke playlist')} variant="sheet">
        <span className={modal.title}>{t('Simpan ke playlist')}</span>

        <div className={styles.list}>
          <button type="button" className={styles.row} onClick={() => setCreateOpen(true)}>
            <span className={[styles.thumb, styles.thumbNew].join(' ')}>
              <Icon name="plus" size={18} />
            </span>
            <span className={styles.name}>{t('Playlist baru')}</span>
          </button>

          {playlists.map((playlist) => {
            const alreadyIn = playlist.songs.some((s) => s.id === song.id);
            return (
              <button key={playlist.id} type="button" className={styles.row} onClick={() => handleAdd(playlist.id, playlist.name)} disabled={alreadyIn}>
                {playlist.songs[0] ? (
                  <LazyImage images={playlist.songs[0].image} quality="50x50" alt="" className={styles.thumb} />
                ) : (
                  <span className={styles.thumb}>
                    <Icon name="library" size={18} />
                  </span>
                )}
                <span className={styles.name}>{playlist.name}</span>
                <span className={styles.meta}>{alreadyIn ? t('Sudah ada') : t('{n} lagu', { n: playlist.songs.length })}</span>
              </button>
            );
          })}
        </div>
      </Modal>

      <PlaylistNameDialog
        isOpen={isOpen && isCreateOpen}
        title={t('Playlist baru')}
        confirmLabel={t('Buat')}
        onConfirm={handleConfirmCreate}
        onClose={() => setCreateOpen(false)}
      />
    </>
  );
}
