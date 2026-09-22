import { useState } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';
import { DownloadedSongsList } from './DownloadedSongsList';
import { LikedSongsList } from './LikedSongsList';
import { PlaylistDetail } from './PlaylistDetail';
import { PlaylistsList } from './PlaylistsList';
import styles from './LibraryView.module.css';

type Tab = 'liked' | 'playlists' | 'downloaded';

export function LibraryView() {
  const [tab, setTab] = useState<Tab>('liked');
  // Lifted to uiStore (not local state) so the desktop sidebar's playlist
  // list (BottomNav) can open a specific playlist's detail view directly.
  const selectedPlaylistId = useUiStore((state) => state.selectedPlaylistId);
  const openPlaylist = useUiStore((state) => state.openPlaylist);
  const closePlaylist = useUiStore((state) => state.closePlaylist);
  const playlists = useLibraryStore((state) => state.playlists);
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null;

  // No padded wrapper: the playlist's banner runs edge to edge, and PlaylistDetail pads its own body.
  if (selectedPlaylist) return <PlaylistDetail playlist={selectedPlaylist} onBack={closePlaylist} />;

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
        <button
          type="button"
          className={[styles.tab, tab === 'downloaded' ? styles.tabActive : ''].join(' ')}
          onClick={() => setTab('downloaded')}
        >
          Diunduh
        </button>
      </div>

      {tab === 'liked' ? <LikedSongsList /> : tab === 'playlists' ? <PlaylistsList onSelectPlaylist={openPlaylist} /> : <DownloadedSongsList />}
    </div>
  );
}
