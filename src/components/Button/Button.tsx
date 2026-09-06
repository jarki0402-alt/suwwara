import type { ButtonHTMLAttributes, ReactNode } from 'react';
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

export function Button({ variant = 'secondary', size = 'md', fullWidth, className, children, ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], SIZE_CLASS[size], fullWidth ? styles.fullWidth : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
