import type { MouseEvent } from 'react';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

/** Replaces `window.confirm` for destructive actions (delete playlist, etc.) — same
 * bottom-sheet-on-mobile, centered-card-on-desktop shell as PlaylistNameDialog. */
export function ConfirmDialog({ isOpen, title, description, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  if (!isOpen) return null;

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={stopPropagation}>
        <span className={styles.title}>{title}</span>
        <p className={styles.description}>{description}</p>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            Batal
          </button>
          <button type="button" className={styles.dangerButton} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
