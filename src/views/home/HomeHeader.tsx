import { flushSync } from 'react-dom';
import { useAuthStore } from '../../auth/authStore';
import { Icon } from '../../components/Icon/Icon';
import { JamPill } from '../../components/JamIndicator/JamIndicator';
import { msg, useT, type Translate } from '../../i18n/i18n';
import { useUpdateStore } from '../../pwa/updateStore';
import { useJamStore } from '../../stores/jamStore';
import { useUiStore } from '../../stores/uiStore';
import styles from './HomeHeader.module.css';

type Part = 'pagi' | 'siang' | 'sore' | 'malam';

function partOfDay(hour: number): Part {
  if (hour >= 4 && hour < 11) return 'pagi';
  if (hour >= 11 && hour < 15) return 'siang';
  if (hour >= 15 && hour < 18) return 'sore';
  return 'malam';
}

const DAYS = [msg('Minggu'), msg('Senin'), msg('Selasa'), msg('Rabu'), msg('Kamis'), msg('Jumat'), msg('Sabtu')];
const PART_WORD: Record<Part, string> = { pagi: msg('pagi'), siang: msg('siang'), sore: msg('sore'), malam: msg('malam') };
// The greeting as whole phrases: "Selamat siang" and "Selamat sore" are both "Good afternoon", not "Good" + a word.
const GREETING: Record<Part, string> = {
  pagi: msg('Selamat pagi'),
  siang: msg('Selamat siang'),
  sore: msg('Selamat sore'),
  malam: msg('Selamat malam'),
};

/** "Kamis malam" / "Thursday night": the small line above the greeting. Day first in both languages. */
function dayLine(now: Date, t: Translate): string {
  return `${t(DAYS[now.getDay()])} ${t(PART_WORD[partOfDay(now.getHours())])}`;
}

/** The greeting's two lines, shared with the desktop top bar (TopBar), which shows them beside the search. */
export function useHomeGreeting(): { eyebrow: string; title: string } {
  const username = useAuthStore((state) => state.user?.username ?? '');
  const t = useT();
  const now = new Date();
  return {
    eyebrow: dayLine(now, t),
    title: username ? t('Halo, {name}', { name: username }) : t(GREETING[partOfDay(now.getHours())]),
  };
}

/**
 * A personal greeting ("Halo, fajar" under "Kamis malam") on every size since the 2026-11 redesign. On a phone the
 * corner holds Jam (the pill while in one, otherwise a button that opens the Jam sheet so starting one is a tap from
 * home), a shortcut straight into typing a search, and the avatar into Pengaturan; desktop has these in the sidebar
 * and top bar.
 */
export function HomeHeader() {
  const username = useAuthStore((state) => state.user?.username ?? '');
  const setView = useUiStore((state) => state.setView);
  const openJamSheet = useUiStore((state) => state.openJamSheet);
  const inJam = useJamStore((state) => state.role === 'jam');
  const hasUpdate = useUpdateStore((state) => state.status === 'available');
  const t = useT();
  const now = new Date();

  // Cari is rendered in the same click (flushSync) so the field can be focused inside the tap itself — iOS only opens
  // the keyboard for a focus() that happens during the user's gesture, not one a render later.
  const openSearch = () => {
    flushSync(() => setView('search'));
    document.getElementById('search-input')?.focus();
  };

  return (
    <header className={styles.header}>
      <div className={styles.titleBlock}>
        <span className={styles.eyebrow}>{dayLine(now, t)}</span>
        <h1 className={styles.title}>{username ? t('Halo, {name}', { name: username }) : t(GREETING[partOfDay(now.getHours())])}</h1>
      </div>
      <div className={styles.actions}>
        <JamPill inline />
        {!inJam && (
          <button type="button" className={styles.iconButton} onClick={openJamSheet} aria-label={t('Dengar bareng (Jam)')}>
            <Icon name="users" size={20} />
          </button>
        )}
        <button type="button" className={styles.iconButton} onClick={openSearch} aria-label={t('Cari lagu')}>
          <Icon name="search" size={20} />
        </button>
        {/* Pengaturan's way in on a phone since the dock's fourth tab became Jam, so it carries the update dot too. */}
        <button
          type="button"
          className={styles.avatar}
          onClick={() => setView('settings')}
          aria-label={hasUpdate ? t('Pengaturan, ada pembaruan') : t('Pengaturan')}
        >
          {username.charAt(0).toUpperCase() || 'S'}
          {hasUpdate && <span className={styles.updateDot} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
