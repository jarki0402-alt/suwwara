import { useState } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';
import { LikedSongsList } from './LikedSongsList';
import { PlaylistDetail } from './PlaylistDetail';
import { PlaylistsList } from './PlaylistsList';
import styles from './LibraryView.module.css';

type Tab = 'liked' | 'playlists';

export function LibraryView() {
  const [tab, setTab] = useState<Tab>('liked');
  // Lifted to uiStore (not local state) so the desktop sidebar's playlist
  // list (BottomNav) can open a specific playlist's detail view directly.
  const selectedPlaylistId = useUiStore((state) => state.selectedPlaylistId);
  const openPlaylist = useUiStore((state) => state.openPlaylist);
  const closePlaylist = useUiStore((state) => state.closePlaylist);
  const playlists = useLibraryStore((state) => state.playlists);
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null;

  if (selectedPlaylist) {
    return (
      <div className={styles.view}>
        <PlaylistDetail playlist={selectedPlaylist} onBack={closePlaylist} />
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <h1 className={styles.pageTitle}>Koleksi</h1>
      <div className={styles.tabs}>
        <button
          type="button"
          className={[styles.tab, tab === 'liked' ? styles.tabActive : ''].join(' ')}
          onClick={() => setTab('liked')}
        >
          Lagu Disukai
        </button>
        <button
          type="button"
          className={[styles.tab, tab === 'playlists' ? styles.tabActive : ''].join(' ')}
          onClick={() => setTab('playlists')}
        >
          Playlist
        </button>
      </div>

      {tab === 'liked' ? <LikedSongsList /> : <PlaylistsList onSelectPlaylist={openPlaylist} />}
    </div>
  );
}
