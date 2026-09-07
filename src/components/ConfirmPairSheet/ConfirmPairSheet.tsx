import type { MouseEvent } from 'react';
import { useState } from 'react';
import { confirmPairingCode } from '../../api/authClient';
import { useToast } from '../Toast/ToastProvider';
import { Icon } from '../Icon/Icon';
import styles from './ConfirmPairSheet.module.css';

interface ConfirmPairSheetProps {
  isOpen: boolean;
  code: string;
  onClose: () => void;
}

/** Shown when the app opens via a `?pair=<code>` link (scanned QR, or a pasted/typed link) — mirrors JoinJamSheet. */
export function ConfirmPairSheet({ isOpen, code, onClose }: ConfirmPairSheetProps) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  const handleConfirm = async () => {
    setBusy(true);
    const result = await confirmPairingCode(code);
    setBusy(false);
    onClose();
    if (result.ok) {
      showToast('Device terhubung — playlist akan sinkron sebentar lagi.');
      window.location.reload(); // simplest way to re-hydrate library from the now-shared account
    } else {
      showToast('Kode sudah kedaluwarsa atau tidak ditemukan.', { type: 'error' });
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={stopPropagation}>
        <div className={styles.header}>
          <span className={styles.title}>Hubungkan Device Ini?</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Tutup">
            <Icon name="close" size={18} />
          </button>
        </div>

        <p className={styles.description}>
          Device ini bakal pakai playlist dan lagu favorit yang sama dengan device yang bikin kode <strong>{code}</strong>.
          Data lokal yang mungkin sudah ada di device ini tidak akan dipindahkan.
        </p>

        <button type="button" className={styles.primaryButton} onClick={handleConfirm} disabled={busy}>
          {busy ? 'Menghubungkan...' : 'Hubungkan'}
        </button>
      </div>
    </div>
  );
}
