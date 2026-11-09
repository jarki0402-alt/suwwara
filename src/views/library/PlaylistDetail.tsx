import { useEffect, useMemo, useState } from 'react';
import { SearchClearButton } from '../../components/SearchClearButton/SearchClearButton';
import { searchSongs } from '../../api/endpoints/search';
import type { Song } from '../../api/types';
import { CollectionHero } from '../../components/CollectionHero/CollectionHero';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog';
import { Icon } from '../../components/Icon/Icon';
import { OptionsMenu } from '../../components/OptionsMenu/OptionsMenu';
import { PlaylistNameDialog } from '../../components/PlaylistNameDialog/PlaylistNameDialog';
import { SongRow, SongTable } from '../../components/SongRow/SongRow';
import { SongRowActions } from '../../components/SongMenu/SongRowActions';
import { useT } from '../../i18n/i18n';
import { useToast } from '../../components/Toast/ToastProvider';
import { playSongList } from '../../playback/playSongList';
import { useLibraryStore, type UserPlaylist } from '../../stores/libraryStore';
import { debounce } from '../../utils/debounce';
import styles from './LibraryView.module.css';

interface PlaylistDetailProps {
  playlist: UserPlaylist;
  onBack: () => void;
}

export function PlaylistDetail({ playlist, onBack }: PlaylistDetailProps) {
  const t = useT();
  const removeSongFromPlaylist = useLibraryStore((state) => state.removeSongFromPlaylist);
  const addSongToPlaylist = useLibraryStore((state) => state.addSongToPlaylist);
  const deletePlaylist = useLibraryStore((state) => state.deletePlaylist);
  const renamePlaylist = useLibraryStore((state) => state.renamePlaylist);

  const { showToast } = useToast();
  const inPlaylist = useMemo(() => new Set(playlist.songs.map((song) => song.id)), [playlist.songs]);
  // Says where it went, since the result row stays where it is; a second tap on the same song does nothing (the
  // button is a grey check by then).
  const addSong = (song: Song) => {
    if (inPlaylist.has(song.id)) return;
    addSongToPlaylist(playlist.id, song);
    showToast(t('Ditambahkan ke {name}', { name: playlist.name }));
  };
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
        kind={t('Playlist')}
        title={playlist.name}
        songs={playlist.songs}
        images={playlist.songs[0]?.image ?? []}
        fallbackIcon="library"
        onBack={onBack}
        extraActions={
          <OptionsMenu
            ariaLabel={t('Opsi playlist')}
            triggerClassName={styles.heroMenuButton}
            items={[
              { key: 'rename', icon: 'edit', label: t('Ganti Nama'), onClick: () => setRenameOpen(true) },
              { key: 'delete', icon: 'trash', label: t('Hapus Playlist'), onClick: () => setDeleteOpen(true), danger: true, separatorBefore: true },
            ]}
          />
        }
      />

      <div className={styles.detailBody}>
      <div className={styles.addSongBox}>
        <Icon name="search" size={16} />
        <input
          className={styles.addSongInput}
          placeholder={t('Tambah lagu ke playlist ini')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && <SearchClearButton onClear={() => setQuery('')} />}
      </div>

      {query.trim().length > 0 && addResults.length > 0 && (
        <div className={styles.addSongResults}>
          {addResults.map((song) => {
            const added = inPlaylist.has(song.id);
            return (
            <SongRow
              key={song.id}
              song={song}
              onClick={() => addSong(song)}
              trailing={
                <>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      addSong(song);
                    }}
                    disabled={added}
                    aria-label={added ? t('Sudah ada di playlist ini') : t('Tambahkan ke playlist ini')}
                  >
                    <Icon name={added ? 'check' : 'plus'} size={20} />
                  </button>
                  <SongRowActions song={song} />
                </>
              }
            />
            );
          })}
        </div>
      )}

      {playlist.songs.length === 0 ? (
        <p className={styles.empty}>{t('Playlist ini masih kosong. Cari lagu di atas untuk menambahkannya.')}</p>
      ) : (
        <SongTable>
          {playlist.songs.map((song, index) => (
            <SongRow
              key={song.id}
              song={song}
              table={{ addedAt: song.addedAt }}
              onClick={() => playSongList(playlist.songs, index)}
              trailing={<SongRowActions song={song} onRemoveFromPlaylist={() => removeSongFromPlaylist(playlist.id, song.id)} />}
            />
          ))}
        </SongTable>
      )}

      </div>

      <PlaylistNameDialog
        isOpen={isRenameOpen}
        title={t('Ganti Nama Playlist')}
        confirmLabel={t('Simpan')}
        initialValue={playlist.name}
        onConfirm={handleConfirmRename}
        onClose={() => setRenameOpen(false)}
      />

      <ConfirmDialog
        isOpen={isDeleteOpen}
        title={t('Hapus Playlist?')}
        description={t('Playlist "{name}" akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.', { name: playlist.name })}
        confirmLabel={t('Hapus')}
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
