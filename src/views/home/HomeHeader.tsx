import { flushSync } from 'react-dom';
import { useAuthStore } from '../../auth/authStore';
import { Icon } from '../../components/Icon/Icon';
import { JamPill } from '../../components/JamIndicator/JamIndicator';
import { useUiStore } from '../../stores/uiStore';
import styles from './HomeHeader.module.css';

function greeting(hour: number): string {
  if (hour >= 4 && hour < 11) return 'Selamat pagi';
  if (hour >= 11 && hour < 15) return 'Selamat siang';
  if (hour >= 15 && hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/**
 * Apple Music's large "Beranda" title on a phone, Spotify's time-of-day greeting on desktop — one header, the breakpoint
 * picks the line (the hidden one is display:none, so a screen reader only hears the visible one). On a phone the
 * corner holds the Jam pill (while in one), a shortcut straight into typing a search, and the avatar into Pengaturan;
 * desktop has all three in the sidebar and top bar.
 */
export function HomeHeader() {
  const username = useAuthStore((state) => state.user?.username ?? '');
  const setView = useUiStore((state) => state.setView);

  // Cari is rendered in the same click (flushSync) so the field can be focused inside the tap itself — iOS only opens
  // the keyboard for a focus() that happens during the user's gesture, not one a render later.
  const openSearch = () => {
    flushSync(() => setView('search'));
    document.getElementById('search-input')?.focus();
  };

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>
        <span className={styles.phoneTitle}>Beranda</span>
        <span className={styles.desktopTitle}>{greeting(new Date().getHours())}</span>
      </h1>
      <div className={styles.actions}>
        <JamPill inline />
        <button type="button" className={styles.searchButton} onClick={openSearch} aria-label="Cari lagu">
          <Icon name="search" size={18} />
        </button>
        <button type="button" className={styles.avatar} onClick={() => setView('settings')} aria-label="Pengaturan">
          {username.charAt(0).toUpperCase() || 'S'}
        </button>
      </div>
    </header>
  );
}
