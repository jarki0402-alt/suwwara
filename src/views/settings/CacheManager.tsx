import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast/ToastProvider';
import { clearRuntimeCaches, getStorageEstimate, type StorageEstimateResult } from '../../pwa/storageEstimate';
import { useInstallPrompt } from '../../pwa/useInstallPrompt';
import { SettingsRow } from './SettingsRow';
import styles from './SettingsView.module.css';

function toMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function CacheManager() {
  const [estimate, setEstimate] = useState<StorageEstimateResult | null>(null);
  const { canInstall, isInstalled, isIOS, promptInstall } = useInstallPrompt();
  const { showToast } = useToast();

  useEffect(() => {
    void getStorageEstimate().then(setEstimate);
  }, []);

  const handleClearCache = async () => {
    await clearRuntimeCaches();
    showToast('Cache lagu & gambar offline berhasil dibersihkan.');
    setEstimate(await getStorageEstimate());
  };

  const usagePercent =
    estimate && estimate.quotaBytes > 0 ? Math.min(100, (estimate.usageBytes / estimate.quotaBytes) * 100) : 0;

  return (
    <>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Penyimpanan</span>
        <div className={styles.card}>
          <SettingsRow
            icon="database"
            title="Cache Offline"
            subtitle={
              estimate
                ? `${toMegabytes(estimate.usageBytes)} MB terpakai dari ${toMegabytes(estimate.quotaBytes)} MB tersedia.`
                : 'Informasi penyimpanan tidak tersedia di browser ini.'
            }
          />
          {estimate && (
            <>
              <div className={styles.storageBarTrack}>
                <div className={styles.storageBarFill} style={{ width: `${usagePercent}%` }} />
              </div>
              <div className={styles.storageCaption}>Lagu &amp; gambar yang baru diputar disimpan agar bisa diputar ulang offline.</div>
            </>
          )}
          <SettingsRow icon="trash" title="Bersihkan Cache" onClick={() => void handleClearCache()} />
        </div>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionTitle}>Instalasi</span>
        <div className={styles.card}>
          {isInstalled ? (
            <SettingsRow icon="check" title="Sudah Terpasang" subtitle="Suwwara sudah terpasang di perangkatmu." />
          ) : canInstall ? (
            <SettingsRow
              icon="download"
              title="Pasang ke Layar Utama"
              subtitle="Akses Suwwara seperti aplikasi native, tanpa browser."
              onClick={() => void promptInstall()}
            />
          ) : isIOS ? (
            <SettingsRow
              icon="download"
              title="Pasang ke Layar Utama"
              subtitle={'Ketuk tombol Share di Safari, lalu pilih "Add to Home Screen".'}
            />
          ) : (
            <SettingsRow icon="download" title="Pasang ke Layar Utama" subtitle="Opsi ini muncul otomatis jika browser mendukungnya." />
          )}
        </div>
      </div>
    </>
  );
}
