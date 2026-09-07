import type { MouseEvent } from 'react';
import { useState } from 'react';
import QRCode from 'qrcode';
import { generatePairingCode } from '../../api/authClient';
import { useToast } from '../Toast/ToastProvider';
import { Icon } from '../Icon/Icon';
import styles from './PairDeviceSheet.module.css';

interface PairDeviceSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * "Hubungkan Device Lain" — opened from Settings. Generates a short-lived
 * pairing code server-side (server/src/pairing/pairingManager.ts, same
 * 6-hex-char pattern as a Jam room code) and renders it both as text and as
 * a QR encoding a `?pair=<code>` link.
 *
 * Deliberately QR-encodes a URL rather than doing in-app camera scanning:
 * the *other* device's own OS camera app reads the code and opens the link
 * directly — no BarcodeDetector/camera-permission code needed here at all,
 * and it works the same on iOS Safari (which has no BarcodeDetector) as it
 * does on Android/Chrome. See ConfirmPairSheet for the receiving side.
 */
export function PairDeviceSheet({ isOpen, onClose }: PairDeviceSheetProps) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  if (!isOpen) return null;

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();
  const pairUrl = code ? `${window.location.origin}${window.location.pathname}?pair=${code}` : '';

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const result = await generatePairingCode();
      setCode(result.code);
      setQrDataUrl(await QRCode.toDataURL(`${window.location.origin}${window.location.pathname}?pair=${result.code}`, { margin: 1, width: 220 }));
    } catch {
      showToast('Gagal membuat kode. Coba lagi.', { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(pairUrl);
      showToast('Link disalin.');
    } catch {
      showToast('Gagal menyalin link.', { type: 'error' });
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={stopPropagation}>
        <div className={styles.header}>
          <span className={styles.title}>Hubungkan Device Lain</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Tutup">
            <Icon name="close" size={18} />
          </button>
        </div>

        {!code ? (
          <div className={styles.body}>
            <p className={styles.description}>
              Sinkronkan playlist dan lagu favorit ke device lain — tanpa email, tanpa password. Buat kode di sini, lalu
              pindai atau masukkan di device satunya.
            </p>
            <button type="button" className={styles.primaryButton} onClick={handleGenerate} disabled={busy}>
              {busy ? 'Membuat kode...' : 'Buat Kode'}
            </button>
          </div>
        ) : (
          <div className={styles.body}>
            {qrDataUrl && <img src={qrDataUrl} alt={`Kode QR: ${code}`} className={styles.qr} />}
            <div className={styles.code}>{code}</div>
            <p className={styles.expiryNote}>Berlaku 5 menit. Pindai dengan kamera device lain, atau masukkan kodenya manual.</p>

            <div className={styles.linkRow}>
              <span className={styles.linkText}>{pairUrl}</span>
              <button type="button" className={styles.copyButton} onClick={handleCopyLink}>
                Salin
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
