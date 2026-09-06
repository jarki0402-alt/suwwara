import styles from './Switch.module.css';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}

export function Switch({ checked, onChange, ariaLabel }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={[styles.track, checked ? styles.trackOn : ''].join(' ')}
      onClick={() => onChange(!checked)}
    >
      <span className={[styles.thumb, checked ? styles.thumbOn : ''].join(' ')} />
    </button>
  );
}
