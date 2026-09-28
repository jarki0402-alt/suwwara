import { useState } from 'react';
import { isRunningInstalled } from '../../pwa/detectPlatform';
import { Icon } from '../Icon/Icon';
import styles from './InstallBanner.module.css';

const DISMISSED_KEY = 'suwwara-install-banner-dismissed';

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** A quiet pointer to /install on Home for anyone still using Suwwara in a browser tab; closing it is for good. */
export function InstallBanner() {
  const [hidden, setHidden] = useState(() => isRunningInstalled() || wasDismissed());
  if (hidden) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode / blocked storage: it just comes back next visit.
    }
    setHidden(true);
  };

  return (
    <div className={styles.banner}>
      <img src="/icons/icon-192.png" alt="" className={styles.icon} />
      <span className={styles.text}>
        <span className={styles.title}>Pasang Suwwara</span>
        <span className={styles.subtitle}>Buka dari layar utama, layar penuh tanpa bar browser.</span>
      </span>
      <a className={styles.action} href="/install">
        Pasang
      </a>
      <button type="button" className={styles.close} onClick={dismiss} aria-label="Tutup">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
