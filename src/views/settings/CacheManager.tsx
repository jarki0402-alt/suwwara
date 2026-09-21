import { useCallback, useEffect, useState } from 'react';
import { AudioCache } from '../../audio-engine/AudioCache';
import { CACHE_LIMIT_OPTIONS_MB, CACHE_RETENTION_OPTIONS_DAYS } from '../../audio-engine/cachePolicy';
import { useToast } from '../../components/Toast/ToastProvider';
import { clearRuntimeCaches } from '../../pwa/storageEstimate';
import { useInstallPrompt } from '../../pwa/useInstallPrompt';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatBytes } from '../../utils/formatBytes';
import { OptionSegments } from './OptionSegments';
import { SettingsRow } from './SettingsRow';
import styles from './SettingsView.module.css';

const limitLabel = (megabytes: number) => (megabytes >= 1024 ? `${megabytes / 1024} GB` : `${megabytes} MB`);
const LIMIT_OPTIONS = CACHE_LIMIT_OPTIONS_MB.map((value) => ({ value, label: limitLabel(value) }));
const RETENTION_OPTIONS = CACHE_RETENTION_OPTIONS_DAYS.map((value) => ({ value, label: value === 0 ? 'Tak pernah' : `${value} hari` }));

export function CacheManager() {
  const [songs, setSongs] = useState<{ count: number; bytes: number } | null>(null);
  const { canInstall, isInstalled, isIOS, promptInstall } = useInstallPrompt();
  const { showToast } = useToast();
  const limitMB = useSettingsStore((state) => state.audioCacheMB);
  const retentionDays = useSettingsStore((state) => state.audioCacheDays);
  const setLimitMB = useSettingsStore((state) => state.setAudioCacheMB);
  const setRetentionDays = useSettingsStore((state) => state.setAudioCacheDays);

  const refresh = useCallback(async () => {
    setSongs(await AudioCache.usage());
  }, []);

  useEffect(() => {
    void AudioCache.usage().then(setSongs);
  }, []);

  // A new budget or window applies at once: what no longer fits is dropped now, not at the next download.
  const applyLimits = async () => {
    await AudioCache.enforceLimits();
    await refresh();
  };

  const handleLimit = (value: number) => {
    setLimitMB(value);
    void applyLimits();
  };

  const handleRetention = (value: number) => {
    setRetentionDays(value);
    void applyLimits();
  };

  const handleClearCache = async () => {
    await Promise.all([clearRuntimeCaches(), AudioCache.clear()]);
    showToast('Cache lagu & gambar offline berhasil dibersihkan.');
    await refresh();
  };

  const supported = AudioCache.isSupported;
  const usedPercent = songs ? Math.min(100, (songs.bytes / (limitMB * 1024 * 1024)) * 100) : 0;

  return (
    <>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Penyimpanan</span>
        <div className={styles.card}>
          <SettingsRow
            icon="database"
            title="Lagu Offline"
            subtitle={
              !supported
                ? 'Tidak dipakai di iPhone/iPad — Apple tidak mengizinkan memutar dari penyimpanan perangkat.'
                : songs
                  ? `${formatBytes(songs.bytes)} terpakai dari batas ${limitLabel(limitMB)}`
                  : 'Informasi penyimpanan tidak tersedia di browser ini.'
            }
          />
          {supported && songs && (
            <div className={styles.storageBarTrack}>
              <div className={styles.storageBarFill} style={{ width: `${usedPercent}%` }} />
            </div>
          )}
          {supported && (
            <>
              <OptionSegments
                title="Batas cache lagu"
                subtitle="Kalau penuh, lagu yang paling lama tidak diputar dihapus lebih dulu."
                options={LIMIT_OPTIONS}
                value={limitMB}
                onChange={handleLimit}
              />
              <OptionSegments
                title="Hapus lagu yang tak diputar selama"
                subtitle="Otomatis, dihitung dari terakhir kali lagu itu diputar."
                options={RETENTION_OPTIONS}
                value={retentionDays}
                onChange={handleRetention}
              />
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
