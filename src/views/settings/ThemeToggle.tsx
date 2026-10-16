import { Icon } from '../../components/Icon/Icon';
import { useSettingsStore, type PaletteId, type ThemePreference } from '../../stores/settingsStore';
import styles from './ThemeToggle.module.css';

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Sistem' },
  { value: 'light', label: 'Terang' },
  { value: 'dark', label: 'Gelap' },
];

// Swatch = the palette's own light accent on its own paper, so the choice reads the same in either theme.
const PALETTE_OPTIONS: { value: PaletteId; label: string; accent: string; paper: string }[] = [
  { value: 'simple', label: 'Simple', accent: '#e2462a', paper: '#ffffff' },
  { value: 'hutan', label: 'Hutan', accent: '#1e7a4f', paper: '#fbfaf7' },
  { value: 'kobalt', label: 'Kobalt', accent: '#2f5bd3', paper: '#ffffff' },
  { value: 'mentari', label: 'Mentari', accent: '#e8a623', paper: '#fffdf8' },
  { value: 'monokrom', label: 'Monokrom', accent: '#0a0a0a', paper: '#ffffff' },
  { value: 'senja', label: 'Senja', accent: '#c93a50', paper: '#fff9f6' },
];

export function ThemeToggle() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const palette = useSettingsStore((state) => state.palette);
  const setPalette = useSettingsStore((state) => state.setPalette);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.iconWrap}>
          <Icon name="theme" size={18} />
        </span>
        <span className={styles.headerText}>
          <span className={styles.title}>Tampilan</span>
          <span className={styles.subtitle}>Pilih tema terang, gelap, atau ikuti sistem, lalu warna aplikasinya.</span>
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
      <div className={styles.palettes} role="radiogroup" aria-label="Warna">
        {PALETTE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={palette === option.value}
            className={[styles.palette, palette === option.value ? styles.paletteActive : ''].join(' ')}
            onClick={() => setPalette(option.value)}
          >
            <span className={styles.swatch} style={{ background: option.paper }} aria-hidden="true">
              <span className={styles.swatchDot} style={{ background: option.accent }} />
            </span>
            <span className={styles.paletteLabel}>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
