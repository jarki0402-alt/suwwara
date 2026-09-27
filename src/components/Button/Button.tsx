import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useBubbleRipple } from '../../hooks/useBubbleRipple';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'icon';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  children?: ReactNode;
}

const SIZE_CLASS: Record<Size, string> = {
  sm: styles.sizeSm,
  md: '',
  lg: styles.sizeLg,
};

export function Button({ variant = 'secondary', size = 'md', fullWidth, className, children, onPointerDown, ...rest }: ButtonProps) {
  const ripple = useBubbleRipple<HTMLButtonElement>();
  const classes = [styles.button, styles[variant], SIZE_CLASS[size], fullWidth ? styles.fullWidth : '', 'glass-ripple-host', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ripple.ref}
      className={classes}
      onPointerDown={(event) => {
        ripple.onPointerDown(event);
        onPointerDown?.(event);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
