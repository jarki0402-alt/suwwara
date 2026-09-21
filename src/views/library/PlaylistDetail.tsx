import { useEffect, useMemo, useState } from 'react';
import { searchSongs } from '../../api/endpoints/search';
import type { Song } from '../../api/types';
import { CollectionHero } from '../../components/CollectionHero/CollectionHero';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog';
import { Icon } from '../../components/Icon/Icon';
import { OptionsMenu } from '../../components/OptionsMenu/OptionsMenu';
import { PlaylistNameDialog } from '../../components/PlaylistNameDialog/PlaylistNameDialog';
import { SongRow } from '../../components/SongRow/SongRow';
import { SongRowActions } from '../../components/SongMenu/SongRowActions';
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
    <div className={styles.detail}>
      <CollectionHero
        kind="Playlist"
        title={playlist.name}
        songs={playlist.songs}
        images={playlist.songs[0]?.image ?? []}
        fallbackIcon="library"
        onBack={onBack}
        extraActions={
          <OptionsMenu
            ariaLabel="Opsi playlist"
            triggerClassName={styles.heroMenuButton}
            items={[
              { key: 'rename', icon: 'edit', label: 'Ganti Nama', onClick: () => setRenameOpen(true) },
              { key: 'delete', icon: 'trash', label: 'Hapus Playlist', onClick: () => setDeleteOpen(true), danger: true, separatorBefore: true },
            ]}
          />
        }
      />

      <div className={styles.detailBody}>
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
                <>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => addSongToPlaylist(playlist.id, song)}
                    aria-label="Tambahkan ke playlist ini"
                  >
                    <Icon name="plus" size={16} />
                  </button>
                  <SongRowActions song={song} />
                </>
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
              trailing={<SongRowActions song={song} onRemoveFromPlaylist={() => removeSongFromPlaylist(playlist.id, song.id)} />}
            />
          ))}
        </div>
      )}

      </div>

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
