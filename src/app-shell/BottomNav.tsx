import { JamSidebarCard } from '../components/JamIndicator/JamIndicator';
import { useUpdateStore } from '../pwa/updateStore';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { LazyImage } from '../components/Image/LazyImage';
import { PlaylistNameDialog } from '../components/PlaylistNameDialog/PlaylistNameDialog';
import { Icon, type IconName } from '../components/Icon/Icon';
import { useBubbleRipple } from '../hooks/useBubbleRipple';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useLibraryStore } from '../stores/libraryStore';
import { useUiStore, type ViewName } from '../stores/uiStore';
import styles from './BottomNav.module.css';

const TABS: { view: ViewName; label: string; icon: IconName }[] = [
  { view: 'home', label: 'Beranda', icon: 'home' },
  { view: 'search', label: 'Cari', icon: 'search' },
  { view: 'library', label: 'Koleksi', icon: 'library' },
  { view: 'settings', label: 'Pengaturan', icon: 'settings' },
];

// Own component (not inlined in the TABS.map below) so each tab gets its own ripple-hook
// instance — calling useBubbleRipple directly inside a .map callback would call a variable
// number of hooks from React's perspective.
function TabButton({
  tab,
  isActive,
  hasUpdate,
  onSelect,
}: {
  tab: (typeof TABS)[number];
  isActive: boolean;
  hasUpdate: boolean;
  onSelect: () => void;
}) {
  const ripple = useBubbleRipple<HTMLButtonElement>();
  return (
    <button
      ref={ripple.ref}
      type="button"
      className={[styles.tabButton, 'glass-ripple-host', isActive ? styles.tabActive : ''].join(' ')}
      onClick={onSelect}
      onPointerDown={ripple.onPointerDown}
    >
      <span className={styles.tabIcon}>
        <Icon name={tab.icon} size={22} />
        {tab.view === 'settings' && hasUpdate && <span className={styles.updateDot} aria-label="Ada pembaruan" />}
      </span>
      <span>{tab.label}</span>
    </button>
  );
}

export function BottomNav() {
  const currentView = useUiStore((state) => state.currentView);
  const setView = useUiStore((state) => state.setView);
  const selectedPlaylistId = useUiStore((state) => state.selectedPlaylistId);
  const openPlaylist = useUiStore((state) => state.openPlaylist);
  const playlists = useLibraryStore((state) => state.playlists);
  const likedCount = useLibraryStore((state) => state.likedSongs.length);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const [isCreating, setIsCreating] = useState(false);
  const hasUpdate = useUpdateStore((state) => state.status === 'available');
  const activeIndex = selectedPlaylistId ? -1 : TABS.findIndex((tab) => tab.view === currentView);
  const isDesktop = useIsDesktop();

  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const isDraggingRef = useRef(false);
  const hasMovedRef = useRef(false);
  const dragStartXRef = useRef(0);

  // The pill's resting position (transition re-enabled so it glides there, whether this
  // followed a tap or a drag release below). Skipped while an actual drag is live — the
  // pointermove handler is driving the transform directly in that window.
  const settleIndicator = (index: number) => {
    const el = indicatorRef.current;
    if (!el) return;
    
    const prevIndex = parseInt(el.dataset.prevIndex || '-1');
    el.dataset.prevIndex = index.toString();
    
    // If we're moving from a valid tab to another tab, stretch the pill!
    if (prevIndex !== -1 && prevIndex !== index && index !== -1) {
      el.classList.add(styles.stretching);
      setTimeout(() => {
        el.classList.remove(styles.stretching);
      }, 150); // Matches CSS transition timing
    }

    el.style.transition = '';
    el.style.transform = `translateX(${Math.max(index, 0) * 100}%)`;
    el.style.opacity = index < 0 ? '0' : '1';
  };

  useEffect(() => {
    if (isDraggingRef.current) return;
    settleIndicator(activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  // Mobile only: dragging a finger across the tab row drags the liquid pill along with it
  // (Apple's own tab bar does this — the indicator isn't just a by-product of tapping a tab,
  // it's a thing you can physically push around) instead of only reacting to a completed tap
  // on one button. A plain tap still works exactly as before through each button's own
  // onClick — this only kicks in once the pointer has actually moved past a small threshold,
  // so it never double-fires a view change for an ordinary tap.
  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (isDesktop || event.pointerType === 'mouse') return;
    isDraggingRef.current = true;
    hasMovedRef.current = false;
    dragStartXRef.current = event.clientX;
    navRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!isDraggingRef.current) return;
    if (!hasMovedRef.current && Math.abs(event.clientX - dragStartXRef.current) > 4) {
      hasMovedRef.current = true;
    }
    if (!hasMovedRef.current) return;
    const rect = navRef.current?.getBoundingClientRect();
    const el = indicatorRef.current;
    if (!rect || !el || rect.width === 0) return;
    const indicatorWidth = rect.width / TABS.length;
    const rawLeft = event.clientX - rect.left - indicatorWidth / 2;
    const clampedLeft = Math.min(Math.max(rawLeft, 0), rect.width - indicatorWidth);
    // No transition here — the pill needs to sit exactly under the finger every frame, not
    // ease toward it a beat late. The spring comes back for the settle on release. The slight
    // scaleX while live is the "liquid" stretch — a plain 1:1 follow with no give at all reads
    // as a rigid puck sliding on rails, not a soft blob of glass being pushed around.
    el.style.transition = 'none';
    el.style.transform = `translateX(${clampedLeft}px) scaleX(1.08)`;
    el.style.opacity = '1';
  };

  const endDrag = (event: PointerEvent<HTMLElement>, commit: boolean) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (commit && hasMovedRef.current) {
      const rect = navRef.current?.getBoundingClientRect();
      const fraction = rect && rect.width > 0 ? Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1) : 0;
      const index = Math.min(Math.floor(fraction * TABS.length), TABS.length - 1);
      const tab = TABS[index];
      if (tab) setView(tab.view);
      settleIndicator(index);
    } else {
      settleIndicator(activeIndex);
    }
    hasMovedRef.current = false;
  };

  return (
    <nav
      ref={navRef}
      className={styles.nav}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
    >
      {/* Slides behind the active tab (mobile only — see .indicator's own media query) instead of
          each tab getting its own background, so switching tabs reads as one pill gliding across
          rather than a highlight jumping between four separate states. Position is fully
          imperative (see settleIndicator/handlePointerMove above), not a React-rendered inline
          style, so a mid-drag frame is never fought by a parent re-render resetting it. */}
      <span ref={indicatorRef} className={styles.indicator} aria-hidden="true" />
      <span className={styles.brand}>Suwwara</span>
      {TABS.map((tab, index) => (
        <TabButton key={tab.view} tab={tab} isActive={index === activeIndex} hasUpdate={hasUpdate} onSelect={() => setView(tab.view)} />
      ))}

      {/* Desktop: "you are in a Jam", under the menu (hidden on phones, which get JamPill in the corner). */}
      <JamSidebarCard />

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
              <Icon name="heart-filled" size={22} />
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
                  <Icon name="library" size={22} />
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
