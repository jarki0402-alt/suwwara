import type { FormEvent, MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './PlaylistNameDialog.module.css';

interface PlaylistNameDialogProps {
  isOpen: boolean;
  title: string;
  confirmLabel: string;
  initialValue?: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
}

/** Replaces `window.prompt` for playlist create/rename — same bottom-sheet-on-mobile,
 * centered-card-on-desktop shell as ConfirmPairSheet/JoinJamSheet, so it reads as part of
 * the app instead of a native browser dialog. */
export function PlaylistNameDialog({ isOpen, title, confirmLabel, initialValue = '', onConfirm, onClose }: PlaylistNameDialogProps) {
  const [name, setName] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) setName(initialValue);
  }, [isOpen, initialValue]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  const trimmed = name.trim();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed.length === 0) return;
    onConfirm(trimmed);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <form className={styles.sheet} onClick={stopPropagation} onSubmit={handleSubmit}>
        <div className={styles.badge}>
          <Icon name="library" size={22} />
        </div>

        <span className={styles.title}>{title}</span>

        <input
          ref={inputRef}
          className={styles.input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nama playlist"
          maxLength={80}
          aria-label={title}
        />

        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            Batal
          </button>
          <button type="submit" className={styles.confirmButton} disabled={trimmed.length === 0}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
