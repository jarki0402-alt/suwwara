import { useToast } from '../../components/Toast/ToastProvider';
import { useJamStore } from '../../stores/jamStore';
import { useHistoryStore } from '../../stores/historyStore';
import { useUiStore } from '../../stores/uiStore';
import { useT } from '../../i18n/i18n';
import { CacheManager } from './CacheManager';
import { DataSaverToggle } from './DataSaverToggle';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { AccountSection } from './AccountSection';
import { UpdateRow } from './UpdateRow';
import { SettingsRow } from './SettingsRow';
import styles from './SettingsView.module.css';
import { FullscreenSettings } from './FullscreenSettings';
import { GlassSlider } from './GlassSlider';
import { LanguageSetting } from './LanguageSetting';
import { ThemeToggle } from './ThemeToggle';

export function SettingsView() {
  const t = useT();
  const clearHistory = useHistoryStore((state) => state.clear);
  const { showToast } = useToast();
  const jamRole = useJamStore((state) => state.role);
  const jamMemberCount = useJamStore((state) => state.memberCount);
  const openJamSheet = useUiStore((state) => state.openJamSheet);

  const handleClearHistory = () => {
    clearHistory();
    showToast(t('Riwayat putar dibersihkan.'));
  };

  return (
    <div className={styles.view}>
      <h1 className={styles.pageTitle}>{t('Pengaturan')}</h1>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>{t('Tampilan')}</span>
        <LanguageSetting />
        <ThemeToggle />
        <GlassSlider />
        <FullscreenSettings />
      </div>

      <UpdateRow />

      <div className={styles.section}>
        <span className={styles.sectionTitle}>{t('Pemutaran')}</span>
        <div className={styles.card}>
          <DataSaverToggle />
          <SettingsRow
            icon="pulse"
            title={t('Jam')}
            subtitle={jamRole === 'jam' ? t('Aktif · {n} orang dengerin bareng', { n: jamMemberCount }) : t('Dengerin lagu bareng teman, real-time.')}
            onClick={openJamSheet}
            control={<span className={styles.linkButton}>{jamRole === 'jam' ? t('Kelola') : t('Mulai')}</span>}
          />
        </div>
      </div>

      <AccountSection />

      <CacheManager />

      <DiagnosticsPanel />

      <div className={styles.section}>
        <span className={styles.sectionTitle}>{t('Data')}</span>
        <div className={styles.card}>
          <SettingsRow
            icon="clock"
            title={t('Riwayat Putar')}
            subtitle={t('Digunakan untuk menghasilkan rekomendasi lagu untukmu.')}
            onClick={handleClearHistory}
            control={<span className={styles.linkButton}>{t('Hapus')}</span>}
          />
        </div>
      </div>

      <p className={styles.appInfo}>{t('Suwwara · diputar tanpa iklan, dibuat untuk kamu dan teman-teman.')}</p>
    </div>
  );
}
