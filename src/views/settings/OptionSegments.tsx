import styles from './OptionSegments.module.css';

interface OptionSegmentsProps {
  title: string;
  subtitle: string;
  options: readonly { value: number; label: string }[];
  value: number;
  onChange: (value: number) => void;
}

/** A titled row of mutually exclusive choices — same look as the theme picker, for settings that have more than three. */
export function OptionSegments({ title, subtitle, options, value, onChange }: OptionSegmentsProps) {
  return (
    <div className={styles.wrapper}>
      <div>
        <span className={styles.title}>{title}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </div>
      <div className={styles.segmented} role="radiogroup" aria-label={title}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={[styles.segment, value === option.value ? styles.segmentActive : ''].join(' ')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
