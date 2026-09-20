import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../Modal/Modal';
import modal from '../Modal/Modal.module.css';

interface PlaylistNameDialogProps {
  isOpen: boolean;
  title: string;
  confirmLabel: string;
  initialValue?: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
}

/** Replaces `window.prompt` for playlist create/rename, in the app's own popup shell (Modal). */
export function PlaylistNameDialog({ isOpen, title, confirmLabel, initialValue = '', onConfirm, onClose }: PlaylistNameDialogProps) {
  const [name, setName] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) setName(initialValue);
  }, [isOpen, initialValue]);

  // The input only exists once Modal has mounted it, so focus after the open render, not during it.
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const trimmed = name.trim();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed.length > 0) onConfirm(trimmed);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} label={title}>
      <form style={{ display: 'contents' }} onSubmit={handleSubmit}>
        <span className={modal.title}>{title}</span>
        <input
          ref={inputRef}
          className={modal.input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nama playlist"
          maxLength={80}
          aria-label="Nama playlist"
        />
        <div className={modal.actions}>
          <button type="button" className={[modal.button, modal.buttonQuiet].join(' ')} onClick={onClose}>
            Batal
          </button>
          <button type="submit" className={[modal.button, modal.buttonPrimary].join(' ')} disabled={trimmed.length === 0}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
