import { checkForUpdate, applyUpdate } from '../../pwa/registerSW';
import { useUpdateStore } from '../../pwa/updateStore';
import { usePlayerStore } from '../../stores/playerStore';
import { SettingsRow } from './SettingsRow';
import styles from './SettingsView.module.css';

const time = (ms: number) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

/**
 * "Cek pembaruan" — the new-version toast disappears after a few seconds, so this is the place that always knows:
 * it reports the state (checking / latest / available / failed) and stays that way until the update is applied.
 */
export function UpdateRow() {
  const status = useUpdateStore((state) => state.status);
  const checkedAt = useUpdateStore((state) => state.checkedAt);
  const isPlaying = usePlayerStore((state) => state.currentSongId !== null);

  const subtitle = (() => {
    switch (status) {
      case 'checking':
        return 'Memeriksa versi terbaru…';
      case 'available':
        return isPlaying ? 'Versi baru tersedia — memuat ulang menghentikan lagu sebentar.' : 'Versi baru tersedia.';
      case 'latest':
        return `Sudah versi terbaru${checkedAt ? ` · diperiksa ${time(checkedAt)}` : ''}`;
      case 'error':
        return 'Belum bisa memeriksa — periksa koneksi, lalu coba lagi.';
      case 'unsupported':
        return 'Pembaruan otomatis tidak aktif di sini (hanya di versi terpasang).';
      default:
        return `Versi ${__APP_BUILD__}`;
    }
  })();

  const label = status === 'available' ? 'Perbarui' : status === 'checking' ? 'Memeriksa…' : status === 'idle' ? 'Periksa' : 'Periksa lagi';

  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>Aplikasi</span>
      <div className={styles.card}>
        <SettingsRow
          icon="refresh"
          title={status === 'available' ? 'Pembaruan tersedia' : 'Cek pembaruan'}
          subtitle={subtitle}
          onClick={status === 'checking' ? undefined : status === 'available' ? applyUpdate : () => void checkForUpdate()}
          control={<span className={status === 'available' ? styles.linkButtonStrong : styles.linkButton}>{label}</span>}
        />
      </div>
    </div>
  );
}
