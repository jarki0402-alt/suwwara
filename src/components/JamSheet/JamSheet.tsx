import type { ChangeEvent, MouseEvent } from 'react';
import { useState } from 'react';
import { audioEngine } from '../../audio-engine/AudioEngine';
import { createRoom, endRoom, leaveRoom } from '../../jam/jamClient';
import { joinJamRoom } from '../../jam/joinJam';
import { currentQueueSnapshot } from '../../jam/queueSnapshot';
import { useJamStore } from '../../stores/jamStore';
import { useQueueStore } from '../../stores/queueStore';
import { useToast } from '../Toast/ToastProvider';
import { Icon } from '../Icon/Icon';
import styles from './JamSheet.module.css';

const ROOM_CODE_LENGTH = 6;

interface JamSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Entry point for "Jam" — starting one, sharing the link, and seeing/leaving
 * one already in progress. Follows the same overlay/sheet shape as
 * AddToPlaylistSheet. */
export function JamSheet({ isOpen, onClose }: JamSheetProps) {
  const role = useJamStore((s) => s.role);
  const roomId = useJamStore((s) => s.roomId);
  const clientId = useJamStore((s) => s.clientId);
  const memberCount = useJamStore((s) => s.memberCount);
  const enterJam = useJamStore((s) => s.enterJam);
  const exitJam = useJamStore((s) => s.exitJam);
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState('');

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
      showToast('Gabung Jam!');
      onClose();
    } else if (result.reason === 'not-found') {
      showToast('Kode gak ditemukan — cek lagi kodenya.', { type: 'error' });
    } else {
      showToast('Gagal gabung Jam. Coba lagi.', { type: 'error' });
    }
  };

  const handleStart = async () => {
    setBusy(true);
    try {
      const queueSnapshot = currentQueueSnapshot();
      const newRoomId = await createRoom(clientId, queueSnapshot);
      enterJam({ roomId: newRoomId, isCreator: true, queueSnapshotToRestore: queueSnapshot });
      showToast('Jam dimulai — bagikan link-nya ke teman.');
    } catch {
      showToast('Gagal memulai Jam. Coba lagi.', { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const shareLink = roomId ? `${window.location.origin}${window.location.pathname}?jam=${roomId}` : '';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      showToast('Link disalin.');
    } catch {
      showToast('Gagal menyalin link.', { type: 'error' });
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
      showToast('Keluar dari Jam.');
    }
  };

  const handleEndForEveryone = async () => {
    if (!roomId) return;
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
          <span className={styles.title}>Jam</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Tutup">
            <Icon name="close" size={18} />
          </button>
        </div>

        {role === 'solo' ? (
          <div className={styles.body}>
            <p className={styles.description}>
              Dengerin lagu bareng teman secara real-time — semua orang yang gabung bisa nambah, hapus, atur ulang antrean, dan
              kontrol play/pause/next/back sama-sama.
            </p>
            <button type="button" className={styles.primaryButton} onClick={handleStart} disabled={busy}>
              {busy ? 'Memulai...' : 'Mulai Jam'}
            </button>

            <div className={styles.divider}>
              <span>atau</span>
            </div>

            <p className={styles.joinLabel}>Sudah ada yang mulai Jam? Masukkan kodenya di sini — buka link share
              biasanya cuma nyalain browser, bukan app ini.</p>
            <div className={styles.joinRow}>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                placeholder="KODE"
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
                Gabung
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.body}>
            <div className={styles.roomCode}>{roomId}</div>
            <p className={styles.memberCount}>{memberCount} orang dengerin bareng</p>

            <div className={styles.linkRow}>
              <span className={styles.linkText}>{shareLink}</span>
              <button type="button" className={styles.copyButton} onClick={handleCopyLink}>
                Salin
              </button>
            </div>

            <button type="button" className={styles.secondaryButton} onClick={handleLeave} disabled={busy}>
              Keluar
            </button>
            <button type="button" className={styles.dangerButton} onClick={handleEndForEveryone} disabled={busy}>
              Akhiri Jam untuk Semua
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
