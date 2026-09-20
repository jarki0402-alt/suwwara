import { useState } from 'react';
import { LazyImage } from '../components/Image/LazyImage';
import { PlaylistNameDialog } from '../components/PlaylistNameDialog/PlaylistNameDialog';
import { Icon, type IconName } from '../components/Icon/Icon';
import { useLibraryStore } from '../stores/libraryStore';
import { useUiStore, type ViewName } from '../stores/uiStore';
import styles from './BottomNav.module.css';

const TABS: { view: ViewName; label: string; icon: IconName }[] = [
  { view: 'home', label: 'Beranda', icon: 'home' },
  { view: 'search', label: 'Cari', icon: 'search' },
  { view: 'library', label: 'Koleksi', icon: 'library' },
  { view: 'settings', label: 'Pengaturan', icon: 'settings' },
];

export function BottomNav() {
  const currentView = useUiStore((state) => state.currentView);
  const setView = useUiStore((state) => state.setView);
  const selectedPlaylistId = useUiStore((state) => state.selectedPlaylistId);
  const openPlaylist = useUiStore((state) => state.openPlaylist);
  const playlists = useLibraryStore((state) => state.playlists);
  const likedCount = useLibraryStore((state) => state.likedSongs.length);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const [isCreating, setIsCreating] = useState(false);

  return (
    <nav className={styles.nav}>
      <span className={styles.brand}>Suwwara</span>
      {TABS.map((tab) => (
        <button
          key={tab.view}
          type="button"
          className={[styles.tabButton, currentView === tab.view && !selectedPlaylistId ? styles.tabActive : ''].join(' ')}
          onClick={() => setView(tab.view)}
        >
          <Icon name={tab.icon} size={22} />
          <span>{tab.label}</span>
        </button>
      ))}

      {/* Desktop-only "Your Library" style shortcut list (hidden on mobile via
          CSS — see BottomNav.module.css) so playlists are reachable directly
          from the sidebar instead of only through the Koleksi tab's own
          sub-tabs, matching Spotify's persistent library list. */}
      <div className={styles.library}>
        <div className={styles.libraryHeadingRow}>
          <span className={styles.libraryHeading}>Koleksimu</span>
          <button type="button" className={styles.addButton} onClick={() => setIsCreating(true)} aria-label="Buat playlist baru">
            <Icon name="plus" size={16} />
          </button>
        </div>
        <div className={styles.libraryList}>
          <button
            type="button"
            className={[styles.libraryItem, currentView === 'library' && !selectedPlaylistId ? styles.libraryItemActive : ''].join(' ')}
            onClick={() => setView('library')}
          >
            <span className={styles.libraryLikedIcon}>
              <Icon name="heart-filled" size={20} />
            </span>
            <span className={styles.libraryText}>
              <span className={styles.libraryLabel}>Lagu Disukai</span>
              <span className={styles.librarySub}>{likedCount} trek</span>
            </span>
          </button>
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              className={[styles.libraryItem, selectedPlaylistId === playlist.id ? styles.libraryItemActive : ''].join(' ')}
              onClick={() => openPlaylist(playlist.id)}
            >
              {playlist.songs[0] ? (
                <LazyImage images={playlist.songs[0].image} quality="50x50" alt={playlist.name} className={styles.libraryThumb} />
              ) : (
                <span className={styles.libraryPlaceholderIcon}>
                  <Icon name="library" size={20} />
                </span>
              )}
              <span className={styles.libraryText}>
                <span className={styles.libraryLabel}>{playlist.name}</span>
                <span className={styles.librarySub}>Daftar Putar</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <PlaylistNameDialog
        isOpen={isCreating}
        title="Playlist Baru"
        confirmLabel="Buat"
        onConfirm={(name) => {
          const playlist = createPlaylist(name);
          setIsCreating(false);
          openPlaylist(playlist.id);
        }}
        onClose={() => setIsCreating(false)}
      />
    </nav>
  );
}
