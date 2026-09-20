import { useEffect, useMemo, useState } from 'react';
import { searchSongs } from '../../api/endpoints/search';
import type { Song } from '../../api/types';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog';
import { Icon } from '../../components/Icon/Icon';
import { PlaylistNameDialog } from '../../components/PlaylistNameDialog/PlaylistNameDialog';
import { SongRow } from '../../components/SongRow/SongRow';
import { playSongList } from '../../playback/playSongList';
import { useLibraryStore, type UserPlaylist } from '../../stores/libraryStore';
import { debounce } from '../../utils/debounce';
import styles from './LibraryView.module.css';

interface PlaylistDetailProps {
  playlist: UserPlaylist;
  onBack: () => void;
}

export function PlaylistDetail({ playlist, onBack }: PlaylistDetailProps) {
  const removeSongFromPlaylist = useLibraryStore((state) => state.removeSongFromPlaylist);
  const addSongToPlaylist = useLibraryStore((state) => state.addSongToPlaylist);
  const deletePlaylist = useLibraryStore((state) => state.deletePlaylist);
  const renamePlaylist = useLibraryStore((state) => state.renamePlaylist);

  const [query, setQuery] = useState('');
  const [addResults, setAddResults] = useState<Song[]>([]);
  const [isRenameOpen, setRenameOpen] = useState(false);
  const [isDeleteOpen, setDeleteOpen] = useState(false);

  const runSearch = useMemo(
    () =>
      debounce((value: string) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          setAddResults([]);
          return;
        }
        searchSongs(trimmed)
          .then((response) => setAddResults(response.songs))
          .catch(() => setAddResults([]));
      }, 350),
    [],
  );

  useEffect(() => {
    runSearch(query);
    return () => runSearch.cancel();
  }, [query, runSearch]);

  const handleConfirmRename = (name: string) => {
    renamePlaylist(playlist.id, name);
    setRenameOpen(false);
  };

  const handleConfirmDelete = () => {
    deletePlaylist(playlist.id);
    setDeleteOpen(false);
    onBack();
  };

  return (
    <div>
      <div className={styles.detailHeader}>
        <button type="button" className={styles.iconButton} onClick={onBack} aria-label="Kembali">
          <Icon name="chevron-left" size={18} />
        </button>
        <span className={styles.detailTitle}>{playlist.name}</span>
        <button type="button" className={styles.iconButton} onClick={() => setRenameOpen(true)} aria-label="Ganti nama playlist">
          <Icon name="more" size={18} />
        </button>
      </div>

      <div className={styles.addSongBox}>
        <Icon name="search" size={16} />
        <input
          className={styles.addSongInput}
          placeholder="Tambah lagu ke playlist ini"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {query.trim().length > 0 && addResults.length > 0 && (
        <div className={styles.addSongResults}>
          {addResults.map((song) => (
            <SongRow
              key={song.id}
              song={song}
              onClick={() => addSongToPlaylist(playlist.id, song)}
              trailing={
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => addSongToPlaylist(playlist.id, song)}
                  aria-label="Tambahkan ke playlist"
                >
                  <Icon name="plus" size={16} />
                </button>
              }
            />
          ))}
        </div>
      )}

      {playlist.songs.length === 0 ? (
        <p className={styles.empty}>Playlist ini masih kosong. Cari lagu di atas untuk menambahkannya.</p>
      ) : (
        <div>
          {playlist.songs.map((song, index) => (
            <SongRow
              key={song.id}
              song={song}
              onClick={() => playSongList(playlist.songs, index)}
              trailing={
                <button
                  type="button"
                  className={styles.iconButton}
                  onClick={() => removeSongFromPlaylist(playlist.id, song.id)}
                  aria-label="Hapus dari playlist"
                >
                  <Icon name="close" size={16} />
                </button>
              }
            />
          ))}
        </div>
      )}

      <button type="button" className={styles.deleteButton} onClick={() => setDeleteOpen(true)}>
        Hapus Playlist
      </button>

      <PlaylistNameDialog
        isOpen={isRenameOpen}
        title="Ganti Nama Playlist"
        confirmLabel="Simpan"
        initialValue={playlist.name}
        onConfirm={handleConfirmRename}
        onClose={() => setRenameOpen(false)}
      />

      <ConfirmDialog
        isOpen={isDeleteOpen}
        title="Hapus Playlist?"
        description={`Playlist "${playlist.name}" akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.`}
        confirmLabel="Hapus"
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
