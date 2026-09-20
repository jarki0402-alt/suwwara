import { Modal } from '../Modal/Modal';
import modal from '../Modal/Modal.module.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

/** Replaces `window.confirm` for destructive actions (delete playlist, etc.), in the app's own popup shell (Modal). */
export function ConfirmDialog({ isOpen, title, description, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} label={title}>
      <span className={modal.title}>{title}</span>
      <p className={modal.text}>{description}</p>
      <div className={modal.actions}>
        <button type="button" className={[modal.button, modal.buttonQuiet].join(' ')} onClick={onClose}>
          Batal
        </button>
        <button type="button" className={[modal.button, modal.buttonDanger].join(' ')} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
