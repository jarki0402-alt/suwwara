import type { MouseEvent } from 'react';
import { useState } from 'react';
import { audioEngine } from '../../audio-engine/AudioEngine';
import { joinJamRoom } from '../../jam/joinJam';
import { useToast } from '../Toast/ToastProvider';
import { Icon } from '../Icon/Icon';
import styles from './JoinJamSheet.module.css';
import { useT } from '../../i18n/i18n';

interface JoinJamSheetProps {
  isOpen: boolean;
  roomId: string;
  onClose: () => void;
}

/** Shown when the app opens via a `?jam=<roomId>` share link. The tap on
 * "Gabung" is deliberately what triggers both `audioEngine.unlock()` (must run
 * inside a real user-gesture call stack — iOS autoplay policy) and the actual
 * join request, so a Jam-driven "play" arriving moments later over SSE is
 * allowed to make sound. */
export function JoinJamSheet({ isOpen, roomId, onClose }: JoinJamSheetProps) {
  const t = useT();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const stopPropagation = (event: MouseEvent) => event.stopPropagation();
  // One sentence for the translator, split around {code} afterwards so the room code can still be bold.
  const [beforeCode, afterCode = ''] = t('Kamu bakal dengerin bareng room {code}. Antrean lagu kamu saat ini disimpan dulu dan dikembalikan begitu keluar dari Jam.').split('{code}');

  const handleJoin = async () => {
    void audioEngine.unlock();
    setBusy(true);
    const result = await joinJamRoom(roomId);
    setBusy(false);
    onClose();
    if (result.ok) {
      showToast(t('Gabung Jam!'));
    } else if (result.reason === 'not-found') {
      showToast(t('Room Jam tidak ditemukan. Mungkin sudah berakhir.'), { type: 'error' });
    } else {
      showToast(t('Gagal gabung Jam. Coba lagi.'), { type: 'error' });
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={stopPropagation}>
        <div className={styles.header}>
          <span className={styles.title}>{t('Gabung Jam?')}</span>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label={t('Tutup')}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <p className={styles.description}>
          {beforeCode}
          <strong>{roomId}</strong>
          {afterCode}
        </p>

        <button type="button" className={styles.primaryButton} onClick={handleJoin} disabled={busy}>
          {busy ? t('Gabung...') : t('Gabung')}
        </button>
      </div>
    </div>
  );
}
