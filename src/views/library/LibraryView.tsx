import { useState } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import { LikedSongsList } from './LikedSongsList';
import { PlaylistDetail } from './PlaylistDetail';
import { PlaylistsList } from './PlaylistsList';
import styles from './LibraryView.module.css';

type Tab = 'liked' | 'playlists';

export function LibraryView() {
  const [tab, setTab] = useState<Tab>('liked');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const playlists = useLibraryStore((state) => state.playlists);
  const selectedPlaylist = playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null;

  if (selectedPlaylist) {
    return (
      <div className={styles.view}>
        <PlaylistDetail playlist={selectedPlaylist} onBack={() => setSelectedPlaylistId(null)} />
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

      {tab === 'liked' ? <LikedSongsList /> : <PlaylistsList onSelectPlaylist={setSelectedPlaylistId} />}
    </div>
  );
}
