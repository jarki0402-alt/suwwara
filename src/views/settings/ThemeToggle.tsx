import { Icon } from '../../components/Icon/Icon';
import { useSettingsStore, type ThemePreference } from '../../stores/settingsStore';
import styles from './ThemeToggle.module.css';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Sistem' },
  { value: 'light', label: 'Terang' },
  { value: 'dark', label: 'Gelap' },
];

export function ThemeToggle() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.iconWrap}>
          <Icon name="theme" size={18} />
        </span>
        <span className={styles.headerText}>
          <span className={styles.title}>Tampilan</span>
          <span className={styles.subtitle}>Pilih tema terang, gelap, atau ikuti pengaturan sistem.</span>
        </span>
      </div>
      <div className={styles.segmented} role="radiogroup" aria-label="Tampilan">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={theme === option.value}
            className={[styles.segment, theme === option.value ? styles.segmentActive : ''].join(' ')}
            onClick={() => setTheme(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
