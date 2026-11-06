import { useSyncExternalStore } from 'react';
import { useToast } from '../../components/Toast/ToastProvider';
import { useT, type Translate } from '../../i18n/i18n';
import { clearTraces, formatReport, getTraces, subscribeTraces, type LoadTrace } from '../../diagnostics/loadTraces';
import styles from './SettingsView.module.css';

const seconds = (t: Translate, ms: number | undefined): string => (ms === undefined ? t('belum') : `${(ms / 1000).toFixed(1)}s`);

function outcomeLabel(t: Translate, trace: LoadTrace): string {
  switch (trace.outcome) {
    case 'playing':
      return t('bunyi');
    case 'timeout':
      return 'timeout';
    case 'error':
      return `error${trace.mediaErrorCode ? ` ${trace.mediaErrorCode}` : ''}`;
    case 'superseded':
      return t('diganti');
    default:
      return t('memuat…');
  }
}

/**
 * What actually happened, on this device, each time a song was loaded — see loadTraces.ts
 * for why this exists. "Salin" produces plain text meant to be pasted into a chat.
 */
export function DiagnosticsPanel() {
  const t = useT();
  const traces = useSyncExternalStore(subscribeTraces, getTraces);
  const { showToast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatReport(__APP_BUILD__));
      showToast(t('Laporan disalin.'));
    } catch {
      showToast(t('Gagal menyalin laporan.'));
    }
  };

  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>{t('Diagnostik')}</span>
      <div className={styles.card}>
        <div className={styles.diagRow}>
          <span className={styles.diagLabel}>{t('Versi')}</span>
          <span className={styles.diagValue}>{__APP_BUILD__}</span>
        </div>
        {traces.length === 0 ? (
          <p className={styles.diagEmpty}>{t('Putar sebuah lagu. Waktu tiap tahap pemuatan akan tercatat di sini.')}</p>
        ) : (
          <ul className={styles.diagList}>
            {traces.slice(0, 8).map((trace) => (
              <li key={`${trace.songId}-${trace.startedAt}`} className={styles.diagItem}>
                <span className={styles.diagTitle}>
                  {trace.title}
                  {trace.preloaded ? ' · preload' : ''}
                </span>
                <span className={styles.diagStages}>
                  {t('mulai {start} · metadata {meta} · siap {ready} · bunyi {sound}', {
                    start: seconds(t, trace.stages.loadstart),
                    meta: seconds(t, trace.stages.loadedmetadata),
                    ready: seconds(t, trace.stages.canplay),
                    sound: seconds(t, trace.stages.playing),
                  })}{' '}
                  · {outcomeLabel(t, trace)}
                  {trace.waits > 0 ? ` · ${t('menunggu {n}×', { n: trace.waits })}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.diagActions}>
          <button type="button" className={styles.linkButton} onClick={handleCopy}>
            {t('Salin laporan')}
          </button>
          {traces.length > 0 && (
            <button type="button" className={styles.linkButton} onClick={clearTraces}>
              {t('Bersihkan')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
