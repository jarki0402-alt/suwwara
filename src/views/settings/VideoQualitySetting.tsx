import { Icon } from '../../components/Icon/Icon';
import { useT } from '../../i18n/i18n';
import { useSettingsStore } from '../../stores/settingsStore';
import type { VideoQuality } from '../../video/musicVideo';
import styles from './ThemeToggle.module.css';

/**
 * Pengaturan → Kualitas video. Only the ceiling: within it the picture follows the connection on its own (VideoSurface).
 * With Data Saver on, Hemat data is forced and shown as such, so the two switches never contradict each other.
 */
export function VideoQualitySetting() {
  const t = useT();
  const quality = useSettingsStore((state) => state.videoQuality);
  const dataSaver = useSettingsStore((state) => state.dataSaver);
  const setQuality = useSettingsStore((state) => state.setVideoQuality);
  const shown: VideoQuality = dataSaver ? 'saver' : quality;
  const options: { value: VideoQuality; label: string }[] = [
    { value: 'auto', label: t('Otomatis') },
    { value: 'saver', label: t('Hemat data') },
    { value: 'high', label: t('Tinggi') },
  ];
  const subtitle = dataSaver
    ? t('Data Saver aktif: video maksimal 480p.')
    : shown === 'high'
      ? t('Sampai 1080p kalau internet kuat. Pakai kuota lebih banyak.')
      : shown === 'saver'
        ? t('Maksimal 480p, paling hemat kuota.')
        : t('Mengikuti kecepatan internet, sampai 720p.');

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.iconWrap}>
          <Icon name="video" size={18} />
        </span>
        <span className={styles.headerText}>
          <span className={styles.title}>{t('Kualitas video')}</span>
          <span className={styles.subtitle}>{subtitle}</span>
        </span>
      </div>
      <div className={styles.segmented} role="radiogroup" aria-label={t('Kualitas video')}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={shown === option.value}
            disabled={dataSaver}
            className={[styles.segment, shown === option.value ? styles.segmentActive : ''].join(' ')}
            onClick={() => setQuality(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
