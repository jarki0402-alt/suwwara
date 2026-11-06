import { Icon } from '../../components/Icon/Icon';
import { setLanguageChoice, useLanguageStore, useT, type LanguageChoice } from '../../i18n/i18n';
import styles from './ThemeToggle.module.css';

// Each language named in itself, as everywhere else: someone who can't read the current language still finds theirs.
const LANGUAGE_NAMES: Record<Exclude<LanguageChoice, 'auto'>, string> = { id: 'Indonesia', en: 'English' };

/** Pengaturan → Bahasa. Synced across the account's devices (profileSync), newest choice wins. */
export function LanguageSetting() {
  const t = useT();
  const choice = useLanguageStore((state) => state.choice);
  const options: { value: LanguageChoice; label: string }[] = [
    { value: 'auto', label: t('Otomatis') },
    { value: 'id', label: LANGUAGE_NAMES.id },
    { value: 'en', label: LANGUAGE_NAMES.en },
  ];

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.iconWrap}>
          <Icon name="language" size={18} />
        </span>
        <span className={styles.headerText}>
          <span className={styles.title}>{t('Bahasa')}</span>
          <span className={styles.subtitle}>{t('Otomatis mengikuti bahasa perangkatmu. Judul lagu dan lirik tidak diterjemahkan.')}</span>
        </span>
      </div>
      <div className={styles.segmented} role="radiogroup" aria-label={t('Bahasa')}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={choice === option.value}
            className={[styles.segment, choice === option.value ? styles.segmentActive : ''].join(' ')}
            onClick={() => void setLanguageChoice(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
