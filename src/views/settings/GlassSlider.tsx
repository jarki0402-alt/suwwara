import { Icon } from '../../components/Icon/Icon';
import { useSettingsStore } from '../../stores/settingsStore';
import toggleStyles from './ThemeToggle.module.css';
import styles from './GlassSlider.module.css';

export function GlassSlider() {
  const glassTint = useSettingsStore((state) => state.glassTint);
  const setGlassTint = useSettingsStore((state) => state.setGlassTint);

  return (
    <div className={toggleStyles.wrapper}>
      <div className={toggleStyles.header}>
        <span className={toggleStyles.iconWrap}>
          <Icon name="theme" size={18} />
        </span>
        <span className={toggleStyles.headerText}>
          <span className={toggleStyles.title}>Liquid Glass</span>
          <span className={toggleStyles.subtitle}>Atur seberapa bening kaca di tombol, pemutar, dan menu.</span>
        </span>
      </div>
      <div className={styles.sliderRow}>
        <span className={[styles.swatch, styles.swatchClear].join(' ')} aria-hidden="true" />
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(glassTint * 100)}
          onChange={(event) => setGlassTint(Number(event.target.value) / 100)}
          className={styles.slider}
          style={{ '--fill': `${glassTint * 100}%` } as React.CSSProperties}
          aria-label="Transparansi Liquid Glass"
          aria-valuetext={glassTint < 0.34 ? 'Bening' : glassTint > 0.66 ? 'Berwarna' : 'Sedang'}
        />
        <span className={[styles.swatch, styles.swatchTinted].join(' ')} aria-hidden="true" />
      </div>
      <div className={styles.labels}>
        <span>Bening</span>
        <span>Berwarna</span>
      </div>
    </div>
  );
}
