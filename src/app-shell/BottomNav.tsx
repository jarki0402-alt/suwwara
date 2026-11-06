import { JamSidebarCard } from '../components/JamIndicator/JamIndicator';
import { useUpdateStore } from '../pwa/updateStore';
import { useRef, useState } from 'react';
import { LazyImage } from '../components/Image/LazyImage';
import { PlaylistNameDialog } from '../components/PlaylistNameDialog/PlaylistNameDialog';
import { Icon, type IconName } from '../components/Icon/Icon';
import { useLensEnabled } from '../hooks/glassQuality';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useLiquidRim } from '../hooks/useLiquidRim';
import { useLibraryStore } from '../stores/libraryStore';
import { useUiStore, type ViewName } from '../stores/uiStore';
import styles from './BottomNav.module.css';
import { LiquidGlassLensDefs } from './LiquidGlassLens';
import { useLiquidPill } from './useLiquidPill';
import { msg, useT } from '../i18n/i18n';

interface Tab {
  /** A menu to show, or 'jam': the Jam tab opens the Jam sheet over whatever is showing instead of changing menu. */
  view: ViewName | 'jam';
  label: string;
  icon: IconName;
}

// The phone dock keeps Pengaturan (Jam is one tap away from Beranda's header and from Now Playing). The desktop
// sidebar has room for Jam too.
const PHONE_TABS: Tab[] = [
  { view: 'home', label: msg('Beranda'), icon: 'home' },
  { view: 'search', label: msg('Cari'), icon: 'search' },
  { view: 'library', label: msg('Koleksi'), icon: 'library' },
  { view: 'settings', label: msg('Pengaturan'), icon: 'settings' },
];
const DESKTOP_TABS: Tab[] = [...PHONE_TABS.slice(0, 3), { view: 'jam', label: msg('Jam'), icon: 'users' }, PHONE_TABS[3]];

// No bubble ripple on the tabs: the lifted glass pill (useLiquidPill) already answers the press, as in Apple's tab bar,
// and inside the rectangular tab the clipped ripple flashed as a coloured box.
function TabButton({
  tab,
  isActive,
  hasUpdate,
  onSelect,
}: {
  tab: Tab;
  isActive: boolean;
  hasUpdate: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <button type="button" className={[styles.tabButton, isActive ? styles.tabActive : ''].join(' ')} onClick={onSelect}>
      <span className={styles.tabIcon}>
        <Icon name={tab.icon} size={22} />
        {tab.view === 'settings' && hasUpdate && <span className={styles.updateDot} aria-label={t('Ada pembaruan')} />}
      </span>
      <span>{t(tab.label)}</span>
    </button>
  );
}

export function BottomNav() {
  const t = useT();
  const currentView = useUiStore((state) => state.currentView);
  const setView = useUiStore((state) => state.setView);
  const selectedPlaylistId = useUiStore((state) => state.selectedPlaylistId);
  const openPlaylist = useUiStore((state) => state.openPlaylist);
  const playlists = useLibraryStore((state) => state.playlists);
  const likedCount = useLibraryStore((state) => state.likedSongs.length);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const [isCreating, setIsCreating] = useState(false);
  const hasUpdate = useUpdateStore((state) => state.status === 'available');
  const openJamSheet = useUiStore((state) => state.openJamSheet);
  const isDesktop = useIsDesktop();
  const TABS = isDesktop ? DESKTOP_TABS : PHONE_TABS;
  const activeIndex = selectedPlaylistId ? -1 : TABS.findIndex((tab) => tab.view === currentView);
  const select = (tab: Tab) => (tab.view === 'jam' ? openJamSheet() : setView(tab.view));
  const isCollapsed = useUiStore((state) => state.isDockCollapsed) && !isDesktop;
  const setDockCollapsed = useUiStore((state) => state.setDockCollapsed);
  // The folded orb stands for "the tabs": the current one, or Koleksi while a playlist (which lives
  // there) is open. Search already has its own orb on the right, so it isn't repeated here.
  const orbTab = activeIndex < 0 ? TABS[2] : TABS[activeIndex].view === 'search' ? TABS[0] : TABS[activeIndex];
  const unfoldTo = (tab: Tab) => {
    setDockCollapsed(false);
    select(tab);
  };

  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorFillRef = useRef<HTMLSpanElement>(null);
  const searchOrbRef = useRef<HTMLButtonElement>(null);
  // The desktop sidebar is a solid panel, not floating glass.
  // Pressing the folded tab orb swells the nav itself — that's the glass the orb is.
  const navGlass = useLiquidRim(navRef, !isDesktop, { grow: 0.1 });
  const searchOrbGlass = useLiquidRim(searchOrbRef, !isDesktop, { grow: 0.1 });
  const lens = useLensEnabled();

  // Mobile only: the pill is a thing you can physically push around (Apple's own tab bar does
  // this), not just a by-product of tapping a tab — see useLiquidPill for the spring model.
  const pill = useLiquidPill({
    navRef,
    pillRef: indicatorRef,
    fillRef: indicatorFillRef,
    activeIndex,
    count: TABS.length,
    enabled: !isDesktop && !isCollapsed,
    lens,
    lensClassName: styles.lensOn,
    onSelect: (index) => select(TABS[index]),
  });

  return (
    <>
    <nav
      ref={navRef}
      className={[styles.nav, 'liquid-glass', isCollapsed ? styles.collapsed : ''].join(' ')}
      onPointerDown={pill.onPointerDown}
      onPointerMove={pill.onPointerMove}
      onPointerUp={pill.onPointerUp}
      onPointerCancel={pill.onPointerCancel}
    >
      <LiquidGlassLensDefs />
      {/* Slides behind the active tab (mobile only — see .indicator's own media query) instead of
          each tab getting its own background, so switching tabs reads as one pill gliding across
          rather than a highlight jumping between four separate states. Position is fully
          imperative (useLiquidPill), not a React-rendered inline
          style, so a mid-drag frame is never fought by a parent re-render resetting it. */}
      <span ref={indicatorFillRef} className={styles.indicatorFill} aria-hidden="true" />
      <span ref={indicatorRef} className={styles.indicator} aria-hidden="true" />
      <button
        type="button"
        className={styles.compactTab}
        onClick={() => unfoldTo(orbTab)}
        {...navGlass}
        tabIndex={isCollapsed ? 0 : -1}
        aria-hidden={!isCollapsed}
        aria-label={t(orbTab.label)}
      >
        <Icon name={orbTab.icon} size={24} />
      </button>
      <span className={styles.brand}>
        Suwwara<span className={styles.brandDot}>.</span>
      </span>
      {TABS.map((tab, index) => (
        <TabButton key={tab.view} tab={tab} isActive={index === activeIndex} hasUpdate={hasUpdate} onSelect={() => select(tab)} />
      ))}

      {/* Desktop: "you are in a Jam", under the menu (hidden on phones, which get JamPill in the corner). */}
      <JamSidebarCard />

      {/* Desktop-only "Your Library" style shortcut list (hidden on mobile via
          CSS — see BottomNav.module.css) so playlists are reachable directly
          from the sidebar instead of only through the Koleksi tab's own
          sub-tabs, matching Spotify's persistent library list. */}
      <div className={styles.library}>
        <div className={styles.libraryHeadingRow}>
          <span className={styles.libraryHeading}>{t('Koleksimu')}</span>
          <button type="button" className={styles.addButton} onClick={() => setIsCreating(true)} aria-label={t('Buat playlist baru')}>
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
              <span className={styles.libraryLabel}>{t('Lagu Disukai')}</span>
              <span className={styles.librarySub}>{t('{n} trek', { n: likedCount })}</span>
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
                <span className={styles.librarySub}>{t('Daftar Putar')}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <PlaylistNameDialog
        isOpen={isCreating}
        title={t('Playlist Baru')}
        confirmLabel={t('Buat')}
        onConfirm={(name) => {
          const playlist = createPlaylist(name);
          setIsCreating(false);
          openPlaylist(playlist.id);
        }}
        onClose={() => setIsCreating(false)}
      />
    </nav>
    <button
      type="button"
      ref={searchOrbRef}
      className={[styles.searchOrb, 'liquid-glass', isCollapsed ? styles.searchOrbShown : ''].join(' ')}
      onClick={() => unfoldTo(PHONE_TABS[1])}
      {...searchOrbGlass}
      tabIndex={isCollapsed ? 0 : -1}
      aria-hidden={!isCollapsed}
      aria-label={t('Cari')}
    >
      <Icon name="search" size={24} />
    </button>
    </>
  );
}
