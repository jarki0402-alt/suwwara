import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useT } from '../../i18n/i18n';
import { usePlayerStore } from '../../stores/playerStore';
import styles from './ConnectionBanner.module.css';

// The song still loading after this long is a connection that can't keep up, not the ~2s an ordinary start takes on
// the 1-vCPU server (a resolve in line behind another adds a little more).
const SLOW_AFTER_MS = 5000;
// "Kembali online" is a moment, not a state: it shows this long and goes.
const BACK_ONLINE_MS = 2500;

type State = 'offline' | 'slow' | 'online' | null;

/**
 * The connection, as a full-width strip along the bottom edge of the app (Spotify's place for it): red while there's no
 * internet, orange while the song is held up by a slow one, green for a moment when it's back. A state that lasts, so
 * not a toast that would be gone while the problem isn't; icon and words as well as the colour, so it reads without
 * the colour too. Everything on the bottom edge moves up while it shows (data-connection, see the CSS).
 */
export function ConnectionBanner() {
  const t = useT();
  const online = useOnlineStatus();
  const buffering = usePlayerStore((state) => state.isBuffering);
  const [slow, setSlow] = useState(false);
  const [backOnline, setBackOnline] = useState(false);

  useEffect(() => {
    if (!online || !buffering) return;
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [online, buffering]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onOnline = () => {
      setBackOnline(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setBackOnline(false), BACK_ONLINE_MS);
    };
    const onOffline = () => {
      if (timer) clearTimeout(timer);
      setBackOnline(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const state: State = !online ? 'offline' : slow && buffering ? 'slow' : backOnline ? 'online' : null;

  useEffect(() => {
    if (state) document.documentElement.dataset.connection = state;
    else delete document.documentElement.dataset.connection;
  }, [state]);
  useEffect(() => () => void delete document.documentElement.dataset.connection, []);

  if (!state) return null;

  const content: Record<Exclude<State, null>, { icon: IconName; title: string; sub?: string }> = {
    offline: { icon: 'wifi-off', title: t('Tidak ada koneksi internet'), sub: t('Lagu yang tersimpan tetap bisa diputar.') },
    slow: { icon: 'spinner', title: t('Koneksi lambat, lagu sedang dimuat…') },
    online: { icon: 'check', title: t('Kembali online') },
  };
  const { icon, title, sub } = content[state];

  return (
    <div
      className={[styles.banner, styles[state]].join(' ')}
      role={state === 'offline' ? 'alert' : 'status'}
    >
      <Icon name={icon} size={18} className={state === 'slow' ? styles.spin : undefined} />
      <span className={styles.title}>{title}</span>
      {sub && <span className={styles.sub}>· {sub}</span>}
    </div>
  );
}
