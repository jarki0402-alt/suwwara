import { useState } from 'react';
import { useT } from '../../i18n/i18n';
import { useUiStore } from '../../stores/uiStore';
import { DownloadedSongsList } from './DownloadedSongsList';
import { PlaylistsList } from './PlaylistsList';
import styles from './LibraryView.module.css';

// Koleksi opens on the playlists, with Lagu Disukai as the first of them (like Spotify's library), not on a tab of its own.
type Tab = 'playlists' | 'downloaded';

export function LibraryView() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('playlists');
  // Lifted to uiStore (not local state) so the desktop sidebar's playlist
  // list (BottomNav) can open a specific playlist's detail view directly.
  const openPlaylist = useUiStore((state) => state.openPlaylist);


  return (
    <div className={styles.view}>
      <h1 className={styles.pageTitle}>{t('Koleksi')}</h1>
      <div className={styles.tabs}>
        <button
          type="button"
          className={[styles.tab, tab === 'playlists' ? styles.tabActive : ''].join(' ')}
          onClick={() => setTab('playlists')}
        >
          {t('Playlist')}
        </button>
        <button
          type="button"
          className={[styles.tab, tab === 'downloaded' ? styles.tabActive : ''].join(' ')}
          onClick={() => setTab('downloaded')}
        >
          {t('Diunduh')}
        </button>
      </div>

      {tab === 'playlists' ? <PlaylistsList onSelectPlaylist={openPlaylist} /> : <DownloadedSongsList />}
    </div>
  );
}
