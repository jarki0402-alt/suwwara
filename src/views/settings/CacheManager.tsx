import { useCallback, useEffect, useState } from 'react';
import { Switch } from '../../components/Switch/Switch';
import { useToast } from '../../components/Toast/ToastProvider';
import { AudioCache } from '../../audio-engine/AudioCache';
import { CACHE_RETENTION_OPTIONS_DAYS } from '../../audio-engine/cachePolicy';
import { downloadManager, type DownloadRecord } from '../../downloads/downloadManager';
import { OFFLINE_QUOTA_OPTIONS_MB } from '../../downloads/downloadPolicy';
import { clearRuntimeCaches } from '../../pwa/storageEstimate';
import { useInstallPrompt } from '../../pwa/useInstallPrompt';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatBytes } from '../../utils/formatBytes';
import { OptionSegments } from './OptionSegments';
import { SettingsRow } from './SettingsRow';
import styles from './SettingsView.module.css';

const quotaLabel = (megabytes: number) => (megabytes >= 1024 ? `${megabytes / 1024} GB` : `${megabytes} MB`);
const QUOTA_OPTIONS = OFFLINE_QUOTA_OPTIONS_MB.map((value) => ({ value, label: quotaLabel(value) }));
const RETENTION_OPTIONS = CACHE_RETENTION_OPTIONS_DAYS.map((value) => ({ value, label: value === 0 ? 'Tak pernah' : `${value} hari` }));

/**
 * "Tersimpan Offline" — one card, one quota, one number, for everything kept locally. Under the hood this is
 * still two different mechanisms (deliberate downloads, downloads/downloadManager.ts — never auto-evicted; and
 * the opportunistic cache, audio-engine/AudioCache.ts — auto, LRU-evicted from whatever the downloads don't
 * claim), because they genuinely behave differently: a song downloaded on purpose must never quietly disappear
 * just because a bunch of other songs got casually played and filled the shared budget. They used to also be
 * two separate *settings* (two cards, two quotas) — users found that confusing ("kok ada dua penyimpanan buat
 * hal yang mirip"), since from the outside both are just "songs available offline". This merges the picture
 * back into one: one quota to set, one number. The individual downloaded songs themselves are listed and
 * managed in Koleksi → Diunduh (views/library/DownloadedSongsList.tsx) instead of a second time here — this
 * card only owns the aggregate numbers and the bulk "clear everything" actions.
 */
export function CacheManager() {
  const [cacheUsage, setCacheUsage] = useState<{ count: number; bytes: number } | null>(null);
  const [downloads, setDownloads] = useState<DownloadRecord[] | null>(null);
  const { canInstall, isInstalled, isIOS, promptInstall } = useInstallPrompt();
  const { showToast } = useToast();

  const localAudioEnabled = useSettingsStore((state) => state.localAudioEnabled);
  const setLocalAudioEnabled = useSettingsStore((state) => state.setLocalAudioEnabled);
  const localAudioFailureCount = useSettingsStore((state) => state.localAudioFailureCount);
  const quotaMB = useSettingsStore((state) => state.offlineQuotaMB);
  const setQuotaMB = useSettingsStore((state) => state.setOfflineQuotaMB);
  const retentionDays = useSettingsStore((state) => state.audioCacheDays);
  const setRetentionDays = useSettingsStore((state) => state.setAudioCacheDays);

  const refresh = useCallback(() => {
    void AudioCache.usage().then(setCacheUsage);
    void downloadManager.list().then(setDownloads);
  }, []);

  useEffect(() => {
    // Opening this screen is also a fine moment to reconcile the shared quota — picks up anything a background
    // download/prefetch changed since the numbers were last read, before the user looks at them.
    void AudioCache.enforceLimits().then(refresh);
    // A download finishing (or being removed) anywhere else — Now Playing, a song's own "⋯" menu, Koleksi →
    // Diunduh — should update these numbers right away rather than only the next time this screen is opened.
    return downloadManager.subscribe(refresh);
  }, [refresh]);

  const supported = AudioCache.isSupported;

  const handleQuota = (value: number) => {
    setQuotaMB(value);
    void AudioCache.enforceLimits().then(refresh);
  };
  const handleRetention = (value: number) => {
    setRetentionDays(value);
    void AudioCache.enforceLimits().then(refresh);
  };

  const handleClearDownloads = async () => {
    await downloadManager.clearAll();
    showToast('Semua unduhan offline dihapus.');
    refresh();
  };
  const handleClearCache = async () => {
    await Promise.all([clearRuntimeCaches(), AudioCache.clear()]);
    showToast('Cache lagu sementara & gambar offline berhasil dibersihkan.');
    refresh();
  };

  const downloadedBytes = downloads?.reduce((sum, record) => sum + record.size, 0) ?? 0;
  const cacheBytes = cacheUsage?.bytes ?? 0;
  const combinedBytes = downloadedBytes + cacheBytes;
  const usedPercent = Math.min(100, (combinedBytes / (quotaMB * 1024 * 1024)) * 100);
  const nothingStored = downloads?.length === 0 && cacheBytes === 0;

  return (
    <>
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Tersimpan Offline</span>
        <div className={styles.card}>
          {!supported ? (
            <SettingsRow icon="database" title="Lagu Offline" subtitle="Tidak tersedia di browser ini." />
          ) : (
            <>
              <SettingsRow
                icon="download"
                title="Simpan lagu di perangkat"
                subtitle={
                  localAudioEnabled
                    ? 'Percepat pemutaran & aktifkan mode offline dengan lagu yang tersimpan.'
                    : `Dinonaktifkan otomatis setelah pemutaran gagal ${localAudioFailureCount}× berturut-turut di perangkat ini. Nyalakan lagi kalau mau coba ulang.`
                }
                control={<Switch checked={localAudioEnabled} onChange={setLocalAudioEnabled} ariaLabel="Simpan lagu di perangkat" />}
              />

              <SettingsRow
                icon="database"
                title="Penyimpanan"
                subtitle={
                  downloads
                    ? `${formatBytes(combinedBytes)} terpakai dari batas ${quotaLabel(quotaMB)}. ${downloads.length} lagu diunduh, sisanya cache sementara dari lagu yang baru diputar.`
                    : 'Memuat…'
                }
              />
              <div className={styles.storageBarTrack}>
                <div className={styles.storageBarFill} style={{ width: `${usedPercent}%` }} />
              </div>
              <OptionSegments
                title="Batas penyimpanan offline"
                subtitle="Unduhan baru ditolak begitu batas ini tercapai. Cache sementara mengecil sendiri duluan untuk kasih ruang."
                options={QUOTA_OPTIONS}
                value={quotaMB}
                onChange={handleQuota}
              />
              <OptionSegments
                title="Hapus cache sementara kalau gak diputar selama"
                subtitle="Cuma berlaku ke cache sementara. Lagu yang kamu unduh gak pernah kena ini, hilang cuma kalau kamu hapus sendiri."
                options={RETENTION_OPTIONS}
                value={retentionDays}
                onChange={handleRetention}
              />

              {nothingStored ? (
                <p className={styles.diagEmpty}>Belum ada lagu tersimpan offline. Putar sebuah lagu, atau buka menu "⋯" dan pilih "Unduh untuk Offline" biar pasti tersimpan.</p>
              ) : (
                <p className={styles.diagEmpty}>Lihat & kelola lagu yang diunduh satu-satu di Koleksi → Diunduh.</p>
              )}

              {cacheBytes > 0 && <SettingsRow icon="trash" title="Hapus Cache Sementara" onClick={() => void handleClearCache()} />}
              {downloads && downloads.length > 0 && <SettingsRow icon="trash" title="Hapus Semua Unduhan" onClick={() => void handleClearDownloads()} />}
            </>
          )}
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
