import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  /** `dialog`: a small centred card (a question, a name). `sheet`: rises from the bottom on a phone (a list to pick from). */
  variant?: 'dialog' | 'sheet';
  children: ReactNode;
}

/**
 * The one shell for every small popup (new playlist, delete, add to playlist), so they look alike.
 *
 * Rendered through a portal into <body>: a `position: fixed` overlay is trapped by the stacking context
 * of whatever it is nested in, and these popups are opened from inside the bottom nav, list rows and
 * animated views — which is exactly why they used to slide UNDER the mini player and the bottom nav on a
 * phone. In <body> they are above everything, whoever opened them.
 */
export function Modal({ isOpen, onClose, label, variant = 'dialog', children }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    // React events bubble through portals to the React parent (a song row that opened this would play on
    // every tap inside the popup) — so both layers stop them here.
    <div
      className={[styles.overlay, variant === 'sheet' ? styles.overlaySheet : ''].join(' ')}
      data-overlay=""
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className={[styles.panel, variant === 'sheet' ? styles.panelSheet : ''].join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        {variant === 'sheet' && <span className={styles.grabber} aria-hidden="true" />}
        {children}
      </div>
    </div>,
    document.body,
  );
}
