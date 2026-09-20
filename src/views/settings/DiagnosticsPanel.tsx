import { useSyncExternalStore } from 'react';
import { useToast } from '../../components/Toast/ToastProvider';
import { clearTraces, formatReport, getTraces, subscribeTraces, type LoadTrace } from '../../diagnostics/loadTraces';
import styles from './SettingsView.module.css';

const seconds = (ms: number | undefined): string => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`);

function outcomeLabel(trace: LoadTrace): string {
  switch (trace.outcome) {
    case 'playing':
      return 'bunyi';
    case 'timeout':
      return 'timeout';
    case 'error':
      return `error${trace.mediaErrorCode ? ` ${trace.mediaErrorCode}` : ''}`;
    case 'superseded':
      return 'diganti';
    default:
      return 'memuat…';
  }
}

/**
 * What actually happened, on this device, each time a song was loaded — see loadTraces.ts
 * for why this exists. "Salin" produces plain text meant to be pasted into a chat.
 */
export function DiagnosticsPanel() {
  const traces = useSyncExternalStore(subscribeTraces, getTraces);
  const { showToast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatReport(__APP_BUILD__));
      showToast('Laporan disalin.');
    } catch {
      showToast('Gagal menyalin laporan.');
    }
  };

  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>Diagnostik</span>
      <div className={styles.card}>
        <div className={styles.diagRow}>
          <span className={styles.diagLabel}>Versi</span>
          <span className={styles.diagValue}>{__APP_BUILD__}</span>
        </div>
        {traces.length === 0 ? (
          <p className={styles.diagEmpty}>Putar sebuah lagu — waktu tiap tahap pemuatan akan tercatat di sini.</p>
        ) : (
          <ul className={styles.diagList}>
            {traces.slice(0, 8).map((trace) => (
              <li key={`${trace.songId}-${trace.startedAt}`} className={styles.diagItem}>
                <span className={styles.diagTitle}>
                  {trace.title}
                  {trace.preloaded ? ' · preload' : ''}
                </span>
                <span className={styles.diagStages}>
                  mulai {seconds(trace.stages.loadstart)} · metadata {seconds(trace.stages.loadedmetadata)} · siap {seconds(trace.stages.canplay)} · bunyi{' '}
                  {seconds(trace.stages.playing)} · {outcomeLabel(trace)}
                  {trace.waits > 0 ? ` · menunggu ${trace.waits}×` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.diagActions}>
          <button type="button" className={styles.linkButton} onClick={handleCopy}>
            Salin laporan
          </button>
          {traces.length > 0 && (
            <button type="button" className={styles.linkButton} onClick={clearTraces}>
              Bersihkan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
