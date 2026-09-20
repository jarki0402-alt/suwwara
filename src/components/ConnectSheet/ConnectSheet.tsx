import type { MouseEvent } from 'react';
import { audioEngine } from '../../audio-engine/AudioEngine';
import { sendCommand } from '../../connect/connectClient';
import { useConnectStore } from '../../connect/connectStore';
import { currentQueueSnapshot } from '../../jam/queueSnapshot';
import { usePlayback } from '../../playback/PlaybackContext';
import { useJamStore } from '../../stores/jamStore';
import { useUiStore } from '../../stores/uiStore';
import { Icon } from '../Icon/Icon';
import { useToast } from '../Toast/ToastProvider';
import sheetStyles from '../PairDeviceSheet/PairDeviceSheet.module.css';
import styles from './ConnectSheet.module.css';

/**
 * Settings-free "Perangkat" picker (Spotify's Connect list): this device, plus every other
 * device on the account that is online right now. From here a device can be steered
 * ("Kontrol"), or playback can be moved to it ("Putar di sana") or pulled from it ("Putar di sini").
 */
export function ConnectSheet() {
  const { showToast } = useToast();
  const { currentSong, playbackState } = usePlayback();
  const close = useUiStore((state) => state.closeConnectSheet);
  const devices = useConnectStore((state) => state.devices);
  const youRef = useConnectStore((state) => state.youRef);
  const controllingRef = useConnectStore((state) => state.controllingRef);
  const control = useConnectStore((state) => state.control);
  const inJam = useJamStore((state) => state.role !== 'solo');

  const others = devices.filter((device) => device.ref !== youRef);
  const self = devices.find((device) => device.ref === youRef);
  const stop = (event: MouseEvent) => event.stopPropagation();

  const notReachable = (name: string) => showToast(`${name} tidak terhubung.`, { type: 'error' });

  const handleControl = (ref: string) => {
    control(ref);
    close();
  };

  /** Move what this device is playing to `ref`, then stop here. */
  const handlePlayThere = async (ref: string, name: string) => {
    if (!currentSong) return;
    const delivered = await sendCommand(ref, 'transfer', {
      snapshot: currentQueueSnapshot(),
      positionSec: audioEngine.getCurrentTime(),
      isPlaying: playbackState.status === 'playing' || playbackState.status === 'loading',
    });
    if (!delivered) return notReachable(name);
    audioEngine.pause();
    control(ref);
    close();
  };

  /** Ask `ref` to hand its queue and position over to this device. */
  const handlePlayHere = async (ref: string, name: string) => {
    if (!youRef) return;
    const delivered = await sendCommand(ref, 'handoff', { toRef: youRef });
    if (!delivered) return notReachable(name);
    control(null);
    close();
  };

  return (
    <div className={sheetStyles.overlay} onClick={close}>
      <div className={sheetStyles.sheet} onClick={stop}>
        <div className={sheetStyles.header}>
          <span className={sheetStyles.title}>Perangkat</span>
          <button type="button" className={sheetStyles.closeButton} onClick={close} aria-label="Tutup">
            <Icon name="close" size={18} />
          </button>
        </div>

        {inJam && <p className={styles.note}>Kontrol jarak jauh dimatikan selama kamu ada di sebuah Jam.</p>}

        <button type="button" className={[styles.row, controllingRef === null ? styles.rowActive : ''].join(' ')} onClick={() => { control(null); close(); }}>
          <Icon name="devices" size={20} />
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>Perangkat ini{self ? ` · ${self.name}` : ''}</span>
            <span className={styles.rowSub}>{currentSong ? currentSong.name : 'Belum ada lagu'}</span>
          </span>
        </button>

        {others.length === 0 ? (
          <p className={styles.empty}>Belum ada perangkat lain yang aktif. Buka Suwwara di perangkat lain yang sudah tertaut — ia akan muncul di sini.</p>
        ) : (
          others.map((device) => (
            <div key={device.ref} className={[styles.device, controllingRef === device.ref ? styles.rowActive : ''].join(' ')}>
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{device.name}</span>
                <span className={styles.rowSub}>
                  {device.state?.song ? `${device.state.isPlaying ? 'Memutar' : 'Dijeda'} · ${device.state.song.name}` : 'Aktif · tidak memutar apa pun'}
                </span>
              </span>
              <span className={styles.actions}>
                <button type="button" className={styles.action} disabled={inJam} onClick={() => handleControl(device.ref)}>
                  Kontrol
                </button>
                {device.state?.song && (
                  <button type="button" className={styles.action} disabled={inJam} onClick={() => void handlePlayHere(device.ref, device.name)}>
                    Putar di sini
                  </button>
                )}
                {currentSong && (
                  <button type="button" className={styles.action} disabled={inJam} onClick={() => void handlePlayThere(device.ref, device.name)}>
                    Putar di sana
                  </button>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
