import type { MouseEvent } from 'react';
import type { Song } from '../../api/types';
import { useLibraryStore } from '../../stores/libraryStore';
import { Icon } from '../Icon/Icon';
import { useToast } from '../Toast/ToastProvider';
import styles from './AddToPlaylistSheet.module.css';

interface AddToPlaylistSheetProps {
  song: Song;
  isOpen: boolean;
  onClose: () => void;
}

/** Reusable bottom sheet for adding a song to an existing (or brand new) playlist — first
 * used from the queue's per-row "+" button, but self-contained enough to call from anywhere. */
export function AddToPlaylistSheet({ song, isOpen, onClose }: AddToPlaylistSheetProps) {
  const playlists = useLibraryStore((state) => state.playlists);
  const addSongToPlaylist = useLibraryStore((state) => state.addSongToPlaylist);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const { showToast } = useToast();

  if (!isOpen) return null;

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  const handleAdd = (playlistId: string, playlistName: string) => {
    addSongToPlaylist(playlistId, song);
    showToast(`Ditambahkan ke "${playlistName}".`);
    onClose();
  };

  const handleCreate = () => {
    const name = window.prompt('Nama playlist baru:', 'Playlist Baru');
    if (name === null) return;
    const playlist = createPlaylist(name);
    addSongToPlaylist(playlist.id, song);
    showToast(`Dibuat & ditambahkan ke "${playlist.name}".`);
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={stopPropagation}>
        <div className={styles.header}>
          <span className={styles.title}>Tambah ke Playlist</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Tutup">
            <Icon name="close" size={18} />
          </button>
        </div>

        <button type="button" className={styles.createRow} onClick={handleCreate}>
          <span className={styles.createIcon}>
            <Icon name="plus" size={18} />
          </span>
          Playlist Baru
        </button>

        <div className={styles.list}>
          {playlists.length === 0 ? (
            <p className={styles.empty}>Belum ada playlist — buat satu di atas.</p>
          ) : (
            playlists.map((playlist) => {
              const alreadyIn = playlist.songs.some((s) => s.id === song.id);
              return (
                <button
                  key={playlist.id}
                  type="button"
                  className={styles.playlistRow}
                  onClick={() => handleAdd(playlist.id, playlist.name)}
                  disabled={alreadyIn}
                >
                  <span className={styles.playlistName}>{playlist.name}</span>
                  <span className={styles.playlistMeta}>{alreadyIn ? 'Sudah ada' : `${playlist.songs.length} lagu`}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
