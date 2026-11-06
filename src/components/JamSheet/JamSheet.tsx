import type { ChangeEvent, MouseEvent } from 'react';
import { useState } from 'react';
import { audioEngine } from '../../audio-engine/AudioEngine';
import { createRoom, endRoom, leaveRoom } from '../../jam/jamClient';
import { joinJamRoom } from '../../jam/joinJam';
import { jamShareLink } from '../../jam/shareJam';
import { currentQueueSnapshot } from '../../jam/queueSnapshot';
import { useJamStore } from '../../stores/jamStore';
import { useQueueStore } from '../../stores/queueStore';
import { useToast } from '../Toast/ToastProvider';
import { Icon } from '../Icon/Icon';
import { JamAvatars } from '../JamIndicator/JamIndicator';
import styles from './JamSheet.module.css';
import { useT } from '../../i18n/i18n';

const ROOM_CODE_LENGTH = 6;
const END_CONFIRM_MS = 4000;

interface JamSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Entry point for "Jam" — starting one, sharing the link, and seeing/leaving
 * one already in progress. Follows the same overlay/sheet shape as
 * AddToPlaylistSheet. */
export function JamSheet({ isOpen, onClose }: JamSheetProps) {
  const t = useT();
  const role = useJamStore((s) => s.role);
  const roomId = useJamStore((s) => s.roomId);
  const clientId = useJamStore((s) => s.clientId);
  const memberCount = useJamStore((s) => s.memberCount);
  const enterJam = useJamStore((s) => s.enterJam);
  const exitJam = useJamStore((s) => s.exitJam);
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  // "Akhiri Jam untuk Semua" sits right under "Keluar" and takes everyone else out with it, with no way back. One
  // mistaken tap was enough to end a Jam for the whole room (which, to them, looked like being thrown out), so it now
  // asks for a second tap.
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (!isOpen) return null;

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();

  const handleJoinCodeChange = (event: ChangeEvent<HTMLInputElement>) => {
    setJoinCode(event.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, ROOM_CODE_LENGTH));
  };

  const handleJoinByCode = async () => {
    if (joinCode.length !== ROOM_CODE_LENGTH) return;
    void audioEngine.unlock();
    setBusy(true);
    const result = await joinJamRoom(joinCode);
    setBusy(false);
    if (result.ok) {
      showToast(t('Gabung Jam!'));
      onClose();
    } else if (result.reason === 'not-found') {
      showToast(t('Kode gak ditemukan. Cek lagi kodenya.'), { type: 'error' });
    } else {
      showToast(t('Gagal gabung Jam. Coba lagi.'), { type: 'error' });
    }
  };

  const handleStart = async () => {
    setBusy(true);
    try {
      const queueSnapshot = currentQueueSnapshot();
      // The room starts where this device is, playing or not, so starting a Jam never stops the music.
      const status = audioEngine.getSnapshot().status;
      const newRoomId = await createRoom(clientId, queueSnapshot, {
        isPlaying: status === 'playing' || status === 'loading',
        positionSec: audioEngine.getCurrentTime(),
      });
      enterJam({ roomId: newRoomId, isCreator: true, queueSnapshotToRestore: queueSnapshot });
      showToast(t('Jam dimulai. Bagikan link-nya ke teman.'));
    } catch {
      showToast(t('Gagal memulai Jam. Coba lagi.'), { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const shareLink = roomId ? jamShareLink(roomId) : '';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      showToast(t('Link disalin.'));
    } catch {
      showToast(t('Gagal menyalin link.'), { type: 'error' });
    }
  };

  // The OS share sheet (WhatsApp, Messages, ...) — what people actually expect from a
  // "share" button on a phone, and one tap fewer than copy-then-switch-apps-then-paste.
  // Web Share exists on iOS Safari/PWA, Android Chrome and desktop Safari/Edge; anywhere
  // it doesn't, the button simply isn't rendered and "Salin" remains.
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const handleShareLink = async () => {
    try {
      await navigator.share({
        title: t('Dengerin bareng di Suwwara'),
        text: t('Gabung Jam-ku di Suwwara, kode {code}', { code: roomId ?? '' }),
        url: shareLink,
      });
    } catch (error) {
      // Closing the share sheet without picking anything rejects with AbortError —
      // that's the user changing their mind, not a failure worth a toast.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      void handleCopyLink();
    }
  };

  const handleLeave = async () => {
    if (!roomId) return;
    setBusy(true);
    try {
      await leaveRoom(roomId, clientId);
    } finally {
      const snapshot = exitJam();
      if (snapshot) useQueueStore.setState(snapshot);
      setBusy(false);
      onClose();
      showToast(t('Keluar dari Jam.'));
    }
  };

  const handleEndForEveryone = async () => {
    if (!roomId) return;
    if (!confirmEnd) {
      setConfirmEnd(true);
      window.setTimeout(() => setConfirmEnd(false), END_CONFIRM_MS);
      return;
    }
    setConfirmEnd(false);
    setBusy(true);
    try {
      await endRoom(roomId, clientId);
      // The server broadcasts room-closed back to this device too — useJamSync
      // handles the actual local cleanup/restore uniformly for everyone.
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={stopPropagation}>
        <div className={styles.header}>
          <span className={styles.title}>{t('Jam')}</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label={t('Tutup')}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {role === 'solo' ? (
          <div className={styles.body}>
            <p className={styles.description}>
              {t('Dengerin lagu bareng teman secara real-time. Semua orang yang gabung bisa nambah, hapus, atur ulang antrean, dan kontrol play/pause/next/back sama-sama.')}
            </p>
            <button type="button" className={styles.primaryButton} onClick={handleStart} disabled={busy}>
              {busy ? t('Memulai...') : t('Mulai Jam')}
            </button>

            <div className={styles.divider}>
              <span>{t('atau')}</span>
            </div>

            <p className={styles.joinLabel}>
              {t('Sudah ada yang mulai Jam? Masukkan kodenya di sini, karena membuka link share biasanya cuma menyalakan browser, bukan app ini.')}
            </p>
            <div className={styles.joinRow}>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                placeholder={t('KODE')}
                className={styles.joinInput}
                value={joinCode}
                onChange={handleJoinCodeChange}
                maxLength={ROOM_CODE_LENGTH}
              />
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleJoinByCode}
                disabled={busy || joinCode.length !== ROOM_CODE_LENGTH}
              >
                {t('Gabung')}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.body}>
            <div className={styles.people}>
              <JamAvatars count={Math.max(memberCount, 1)} size={36} />
            </div>
            <div className={styles.roomCode}>{roomId}</div>
            <p className={styles.memberCount}>{t('{n} orang dengerin bareng', { n: memberCount })}</p>

            <div className={styles.linkRow}>
              <span className={styles.linkText}>{shareLink}</span>
              {canShare && (
                <button type="button" className={styles.copyButton} onClick={handleShareLink}>
                  {t('Bagikan')}
                </button>
              )}
              <button type="button" className={styles.copyButton} onClick={handleCopyLink}>
                {t('Salin')}
              </button>
            </div>

            <button type="button" className={styles.secondaryButton} onClick={handleLeave} disabled={busy}>
              {t('Keluar')}
            </button>
            <button type="button" className={styles.dangerButton} onClick={handleEndForEveryone} disabled={busy}>
              {confirmEnd ? t('Ketuk lagi untuk mengakhiri') : t('Akhiri Jam untuk Semua')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
