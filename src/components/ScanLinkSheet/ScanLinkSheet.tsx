import type { MouseEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { approveLinkRequest, getLinkRequestInfo } from '../../api/authClient';
import { useUiStore } from '../../stores/uiStore';
import { Icon } from '../Icon/Icon';
import { useToast } from '../Toast/ToastProvider';
import sheetStyles from '../PairDeviceSheet/PairDeviceSheet.module.css';
import { extractLinkCode, startQrScanner } from './qrScanner';
import styles from './ScanLinkSheet.module.css';

type Step =
  | { name: 'scanning' }
  | { name: 'looking-up' }
  | { name: 'confirm'; code: string; deviceName: string }
  | { name: 'approving' };

/**
 * The device that already holds the data (the phone) scans the QR another device is showing
 * and approves. Nothing is linked until the person taps "Tautkan" after seeing WHICH device
 * is asking — scanning alone never grants access.
 */
export function ScanLinkSheet({ prefillCode, onClose }: { prefillCode: string | null; onClose: () => void }) {
  const { showToast } = useToast();
  const bumpLinkedDevices = useUiStore((state) => state.bumpLinkedDevices);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [step, setStep] = useState<Step>(prefillCode ? { name: 'looking-up' } : { name: 'scanning' });
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const handledRef = useRef(false);

  const lookUp = useCallback(async (code: string) => {
    if (handledRef.current) return;
    handledRef.current = true;
    setError(null);
    setStep({ name: 'looking-up' });
    try {
      const info = await getLinkRequestInfo(code);
      setStep({ name: 'confirm', code, deviceName: info.deviceName });
    } catch (lookupError) {
      handledRef.current = false;
      setError(lookupError instanceof Error ? lookupError.message : 'Kode tidak ditemukan atau sudah kedaluwarsa.');
      setStep({ name: 'scanning' });
    }
  }, []);

  useEffect(() => {
    if (prefillCode) void lookUp(prefillCode);
  }, [prefillCode, lookUp]);

  // The camera runs only while the sheet is waiting for a code; it's released as soon as one is found.
  useEffect(() => {
    if (step.name !== 'scanning' || !videoRef.current) return;
    let stopper: { stop: () => void } | null = null;
    let cancelled = false;
    startQrScanner(videoRef.current, (text) => {
      const code = extractLinkCode(text);
      if (code) void lookUp(code);
    })
      .then((handle) => {
        if (cancelled) handle.stop();
        else stopper = handle;
      })
      .catch(() => {
        if (!cancelled) setError('Kamera tidak bisa dibuka. Izinkan akses kamera, atau masukkan kode di bawah.');
      });
    return () => {
      cancelled = true;
      stopper?.stop();
    };
  }, [step.name, lookUp]);

  const handleApprove = async () => {
    if (step.name !== 'confirm') return;
    const { code, deviceName } = step;
    setStep({ name: 'approving' });
    try {
      await approveLinkRequest(code);
      bumpLinkedDevices();
      showToast(`${deviceName} tertaut — library digabung.`);
      onClose();
    } catch (approveError) {
      handledRef.current = false;
      setError(approveError instanceof Error ? approveError.message : 'Gagal menautkan perangkat.');
      setStep({ name: 'scanning' });
    }
  };

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  return (
    <div className={sheetStyles.overlay} onClick={onClose}>
      <div className={sheetStyles.sheet} onClick={stopPropagation}>
        <div className={sheetStyles.header}>
          <span className={sheetStyles.title}>Pindai QR</span>
          <button type="button" className={sheetStyles.closeButton} onClick={onClose} aria-label="Tutup">
            <Icon name="close" size={18} />
          </button>
        </div>

        {step.name === 'confirm' || step.name === 'approving' ? (
          <div className={sheetStyles.body}>
            <p className={sheetStyles.description}>
              Tautkan <strong>{step.name === 'confirm' ? step.deviceName : 'perangkat'}</strong> ke akun ini? Perangkat itu akan melihat dan bisa mengubah lagu disukai dan playlist kamu, dan library-nya
              sendiri digabung ke sini. Hanya lanjutkan kalau kamu sendiri yang membuka layar QR tadi.
            </p>
            <button type="button" className={sheetStyles.primaryButton} onClick={handleApprove} disabled={step.name === 'approving'}>
              {step.name === 'approving' ? 'Menautkan…' : 'Tautkan'}
            </button>
          </div>
        ) : (
          <div className={sheetStyles.body}>
            <div className={styles.videoWrap}>
              <video ref={videoRef} className={styles.video} muted playsInline />
              <div className={styles.frame} />
            </div>
            <p className={sheetStyles.expiryNote}>Arahkan kamera ke QR yang tampil di perangkat baru (Pengaturan → Perangkat → Tampilkan QR).</p>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.manualRow}>
              <input
                className={styles.input}
                value={manual}
                onChange={(event) => setManual(event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 8))}
                placeholder="Atau ketik kodenya"
                inputMode="text"
                autoCapitalize="characters"
                aria-label="Kode tautan"
              />
              <button type="button" className={styles.secondaryButton} disabled={manual.length !== 8 || step.name === 'looking-up'} onClick={() => void lookUp(manual.toUpperCase())}>
                Lanjut
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
