import { useState } from 'react';
import { checkForUpdate, applyUpdate } from '../../pwa/registerSW';
import { useUpdateStore } from '../../pwa/updateStore';
import { intlLocale, useT } from '../../i18n/i18n';
import { usePlayerStore } from '../../stores/playerStore';
import { SettingsRow } from './SettingsRow';
import styles from './SettingsView.module.css';

const time = (ms: number) => new Date(ms).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });

/**
 * "Cek pembaruan" — the new-version toast disappears after a few seconds, so this is the place that always knows:
 * it reports the state (checking / latest / available / failed) and stays that way until the update is applied.
 */
export function UpdateRow() {
  const t = useT();
  const status = useUpdateStore((state) => state.status);
  const checkedAt = useUpdateStore((state) => state.checkedAt);
  const isPlaying = usePlayerStore((state) => state.currentSongId !== null);
  // Own local flag, not part of UpdateStatus: applyUpdate() ends in a page reload (see its own fallback timer), so
  // this only ever needs to cover the gap between the tap and that reload actually happening — without it, that gap
  // looked exactly like the tap did nothing at all.
  const [applying, setApplying] = useState(false);

  const subtitle = applying
    ? t('Memuat ulang…')
    : (() => {
        switch (status) {
          case 'checking':
            return t('Memeriksa versi terbaru…');
          case 'available':
            return isPlaying ? t('Versi baru tersedia. Memuat ulang menghentikan lagu sebentar.') : t('Versi baru tersedia.');
          case 'latest':
            return checkedAt ? t('Sudah versi terbaru · diperiksa {time}', { time: time(checkedAt) }) : t('Sudah versi terbaru');
          case 'error':
            return t('Belum bisa memeriksa. Periksa koneksi, lalu coba lagi.');
          case 'unsupported':
            return t('Pembaruan otomatis tidak aktif di sini (hanya di versi terpasang).');
          default:
            return t('Versi {version}', { version: __APP_BUILD__ });
        }
      })();

  const label = applying ? t('Memperbarui…') : status === 'available' ? t('Perbarui') : status === 'checking' ? t('Memeriksa…') : status === 'idle' ? t('Periksa') : t('Periksa lagi');

  const handleApply = () => {
    setApplying(true); // the page reloads shortly after this — no need to ever set it back to false
    applyUpdate();
  };

  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>{t('Aplikasi')}</span>
      <div className={styles.card}>
        <SettingsRow
          icon="refresh"
          title={status === 'available' ? t('Pembaruan tersedia') : t('Cek pembaruan')}
          subtitle={subtitle}
          onClick={applying || status === 'checking' ? undefined : status === 'available' ? handleApply : () => void checkForUpdate()}
          control={<span className={status === 'available' ? styles.linkButtonStrong : styles.linkButton}>{label}</span>}
        />
      </div>
    </div>
  );
}
