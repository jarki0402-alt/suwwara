import { useToast } from '../../components/Toast/ToastProvider';
import { useJamStore } from '../../stores/jamStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useUiStore } from '../../stores/uiStore';
import { CacheManager } from './CacheManager';
import { DataSaverToggle } from './DataSaverToggle';
import { SettingsRow } from './SettingsRow';
import styles from './SettingsView.module.css';
import { ThemeToggle } from './ThemeToggle';

export function SettingsView() {
  const clearHistory = useHistoryStore((state) => state.clear);
  const { showToast } = useToast();
  const jamRole = useJamStore((state) => state.role);
  const jamMemberCount = useJamStore((state) => state.memberCount);
  const openJamSheet = useUiStore((state) => state.openJamSheet);

  const handleClearHistory = () => {
    clearHistory();
    showToast('Riwayat putar dibersihkan.');
  };

  return (
    <div className={styles.view}>
      <h1 className={styles.pageTitle}>Pengaturan</h1>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Tampilan</span>
        <ThemeToggle />
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Pemutaran</span>
        <div className={styles.card}>
          <DataSaverToggle />
          <SettingsRow
            icon="pulse"
            title="Jam"
            subtitle={jamRole === 'jam' ? `Aktif — ${jamMemberCount} orang dengerin bareng` : 'Dengerin lagu bareng teman, real-time.'}
            onClick={openJamSheet}
            control={<span className={styles.linkButton}>{jamRole === 'jam' ? 'Kelola' : 'Mulai'}</span>}
          />
        </div>
      </div>

      <CacheManager />

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Data</span>
        <div className={styles.card}>
          <SettingsRow
            icon="clock"
            title="Riwayat Putar"
            subtitle="Digunakan untuk menghasilkan rekomendasi lagu untukmu."
            onClick={handleClearHistory}
            control={<span className={styles.linkButton}>Hapus</span>}
          />
        </div>
      </div>

      <p className={styles.appInfo}>Suwwara &middot; diputar tanpa iklan, dibuat untuk kamu dan teman-teman.</p>
    </div>
  );
}
