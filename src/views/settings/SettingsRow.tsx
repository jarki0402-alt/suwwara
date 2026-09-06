import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon/Icon';
import styles from './SettingsView.module.css';

interface SettingsRowProps {
  icon: IconName;
  title: string;
  subtitle?: string;
  control?: ReactNode;
  onClick?: () => void;
}

export function SettingsRow({ icon, title, subtitle, control, onClick }: SettingsRowProps) {
  const content = (
    <>
      <span className={styles.iconWrap}>
        <Icon name={icon} size={18} />
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{title}</span>
        {subtitle && <span className={styles.rowSubtitle}>{subtitle}</span>}
      </span>
      {control && <span className={styles.rowControl}>{control}</span>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={styles.rowButton} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={styles.row}>{content}</div>;
}
