import { Icon } from '../../components/Icon/Icon';
import { useGlassTier } from '../../hooks/glassQuality';
import { msg, useT } from '../../i18n/i18n';
import { useSettingsStore, type GlassMode, type GlassTier } from '../../stores/settingsStore';
import toggleStyles from './ThemeToggle.module.css';
import styles from './GlassSlider.module.css';

const MODES: { value: GlassMode; label: string }[] = [
  { value: 'auto', label: msg('Otomatis') },
  { value: 'full', label: msg('Penuh') },
  { value: 'lite', label: msg('Ringan') },
  { value: 'off', label: msg('Mati') },
];

const TIER_NOTE: Record<GlassTier, string> = {
  full: msg('kaca penuh dengan pembiasan'),
  lite: msg('kaca ringan tanpa pembiasan'),
  off: msg('kaca dimatikan'),
};

export function GlassSlider() {
  const t = useT();
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
          <span className={toggleStyles.title}>{t('Liquid Glass')}</span>
          <span className={toggleStyles.subtitle}>{t('Pilih efek kaca, lalu atur seberapa bening kaca di tombol, pemutar, dan menu.')}</span>
        </span>
      </div>
      <div className={toggleStyles.segmented} role="radiogroup" aria-label={t('Efek Kaca')}>
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={glassMode === mode.value}
            className={[toggleStyles.segment, glassMode === mode.value ? toggleStyles.segmentActive : ''].join(' ')}
            onClick={() => setGlassMode(mode.value)}
          >
            {t(mode.label)}
          </button>
        ))}
      </div>
      <span className={styles.modeNote}>
        {glassMode === 'auto'
          ? t('Menyesuaikan kemampuan perangkat ini. Sekarang: {note}.', { note: t(TIER_NOTE[tier]) })
          : glassMode === 'off'
            ? t('Paling hemat baterai: kaca jadi warna solid tanpa blur.')
            : glassMode === 'lite'
              ? t('Blur dan kilap kaca tanpa pembiasan, ringan untuk HP apa pun.')
              : t('Selalu dengan pembiasan, bila browser mendukung. Bisa patah-patah di HP lama.')}
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
          aria-label={t('Transparansi Liquid Glass')}
          aria-valuetext={glassTint < 0.34 ? t('Bening') : glassTint > 0.66 ? t('Berwarna') : t('Sedang')}
        />
        <span className={[styles.swatch, styles.swatchTinted].join(' ')} aria-hidden="true" />
      </div>
      <div className={[styles.labels, tier === 'off' ? styles.sliderDisabled : ''].join(' ')}>
        <span>{t('Bening')}</span>
        <span>{t('Berwarna')}</span>
      </div>
    </div>
  );
}
