import type { MouseEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { getLinkRequestStatus, requestLinkCode } from '../../api/authClient';
import { describeThisDevice } from '../../auth/deviceInfo';
import { resyncAfterLink } from '../../sync/librarySync';
import { useUiStore } from '../../stores/uiStore';
import { Icon } from '../Icon/Icon';
import { useToast } from '../Toast/ToastProvider';
import styles from '../PairDeviceSheet/PairDeviceSheet.module.css';

const POLL_MS = 1500;

/**
 * The NEW device (typically the laptop) shows a QR; the phone scans it inside the app and
 * approves — the same model as WhatsApp Web's "Linked devices". This side just waits: it polls
 * until the request is approved, then pulls the (now merged) library of the account it joined.
 */
export function LinkDeviceSheet({ onClose }: { onClose: () => void }) {
  const { showToast } = useToast();
  const bumpLinkedDevices = useUiStore((state) => state.bumpLinkedDevices);
  const [code, setCode] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const create = useCallback(async () => {
    setCode(null);
    setQr(null);
    setExpired(false);
    setFailed(false);
    try {
      const info = describeThisDevice();
      const result = await requestLinkCode(info.name, info.kind);
      // A link, not the bare code: scanned with an ordinary camera it still opens the app, and
      // the in-app scanner accepts both forms.
      const url = `${window.location.origin}${window.location.pathname}?link=${result.code}`;
      setQr(await QRCode.toDataURL(url, { margin: 1, width: 240 }));
      setCode(result.code);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void create();
  }, [create, attempt]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const status = await getLinkRequestStatus(code);
        if (cancelled) return;
        if (status === 'approved') {
          clearInterval(timer);
          await resyncAfterLink();
          bumpLinkedDevices();
          showToast('Terhubung — library sudah disinkronkan.');
          onClose();
        } else if (status === 'expired') {
          clearInterval(timer);
          setExpired(true);
        }
      } catch {
        // a missed poll is fine; the next one tries again
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [code, bumpLinkedDevices, onClose, showToast]);

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={stopPropagation}>
        <div className={styles.header}>
          <span className={styles.title}>Tautkan ke Perangkat Lain</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Tutup">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className={styles.body}>
          {failed ? (
            <>
              <p className={styles.description}>Kode belum bisa dibuat. Periksa koneksi lalu coba lagi.</p>
              <button type="button" className={styles.primaryButton} onClick={() => setAttempt((value) => value + 1)}>
                Coba lagi
              </button>
            </>
          ) : expired ? (
            <>
              <p className={styles.description}>Kode kedaluwarsa.</p>
              <button type="button" className={styles.primaryButton} onClick={() => setAttempt((value) => value + 1)}>
                Buat kode baru
              </button>
            </>
          ) : (
            <>
              {qr ? <img src={qr} alt={`Kode QR untuk menautkan perangkat: ${code}`} className={styles.qr} /> : <p className={styles.description}>Membuat kode…</p>}
              {code && <div className={styles.code}>{code}</div>}
              <p className={styles.expiryNote}>
                Di perangkat yang sudah berisi data (HP): buka Suwwara → Pengaturan → Perangkat → <strong>Pindai QR</strong>, arahkan ke kode ini. Berlaku 2 menit.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
