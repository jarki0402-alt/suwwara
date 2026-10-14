import { Icon } from '../../components/Icon/Icon';
import { useGlassTier } from '../../hooks/glassQuality';
import { useSettingsStore, type GlassMode, type GlassTier } from '../../stores/settingsStore';
import toggleStyles from './ThemeToggle.module.css';
import styles from './GlassSlider.module.css';

const MODES: { value: GlassMode; label: string }[] = [
  { value: 'auto', label: 'Otomatis' },
  { value: 'full', label: 'Penuh' },
  { value: 'lite', label: 'Ringan' },
  { value: 'off', label: 'Mati' },
];

const TIER_NOTE: Record<GlassTier, string> = {
  full: 'kaca penuh dengan pembiasan',
  lite: 'kaca ringan tanpa pembiasan',
  off: 'kaca dimatikan',
};

export function GlassSlider() {
  const glassTint = useSettingsStore((state) => state.glassTint);
  const setGlassTint = useSettingsStore((state) => state.setGlassTint);
  const glassMode = useSettingsStore((state) => state.glassMode);
  const setGlassMode = useSettingsStore((state) => state.setGlassMode);
  const tier = useGlassTier();

  return (
    <div className={toggleStyles.wrapper}>
      <div className={toggleStyles.header}>
        <span className={toggleStyles.iconWrap}>
          <Icon name="theme" size={18} />
        </span>
        <span className={toggleStyles.headerText}>
          <span className={toggleStyles.title}>Liquid Glass</span>
          <span className={toggleStyles.subtitle}>Pilih efek kaca, lalu atur seberapa bening kaca di tombol, pemutar, dan menu.</span>
        </span>
      </div>
      <div className={toggleStyles.segmented} role="radiogroup" aria-label="Efek Kaca">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={glassMode === mode.value}
            className={[toggleStyles.segment, glassMode === mode.value ? toggleStyles.segmentActive : ''].join(' ')}
            onClick={() => setGlassMode(mode.value)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <span className={styles.modeNote}>
        {glassMode === 'auto'
          ? `Menyesuaikan kemampuan perangkat ini — sekarang ${TIER_NOTE[tier]}.`
          : glassMode === 'off'
            ? 'Paling hemat baterai: kaca jadi warna solid tanpa blur.'
            : glassMode === 'lite'
              ? 'Blur dan kilap kaca tanpa pembiasan — ringan untuk HP apa pun.'
              : 'Selalu dengan pembiasan, bila browser mendukung. Bisa patah-patah di HP lama.'}
      </span>
      <div className={[styles.sliderRow, tier === 'off' ? styles.sliderDisabled : ''].join(' ')}>
        <span className={[styles.swatch, styles.swatchClear].join(' ')} aria-hidden="true" />
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(glassTint * 100)}
          onChange={(event) => setGlassTint(Number(event.target.value) / 100)}
          disabled={tier === 'off'}
          className={styles.slider}
          style={{ '--fill': `${glassTint * 100}%` } as React.CSSProperties}
          aria-label="Transparansi Liquid Glass"
          aria-valuetext={glassTint < 0.34 ? 'Bening' : glassTint > 0.66 ? 'Berwarna' : 'Sedang'}
        />
        <span className={[styles.swatch, styles.swatchTinted].join(' ')} aria-hidden="true" />
      </div>
      <div className={[styles.labels, tier === 'off' ? styles.sliderDisabled : ''].join(' ')}>
        <span>Bening</span>
        <span>Berwarna</span>
      </div>
    </div>
  );
}
