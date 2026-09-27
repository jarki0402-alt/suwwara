import { useBubbleRipple } from '../../hooks/useBubbleRipple';
import styles from './Switch.module.css';

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}

export function Switch({ checked, onChange, ariaLabel }: SwitchProps) {
  const ripple = useBubbleRipple<HTMLButtonElement>();
  return (
    <button
      ref={ripple.ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={[styles.track, 'glass-ripple-host', checked ? styles.trackOn : ''].join(' ')}
      onClick={() => onChange(!checked)}
      onPointerDown={ripple.onPointerDown}
    >
      <span className={[styles.thumb, checked ? styles.thumbOn : ''].join(' ')} />
    </button>
  );
}
