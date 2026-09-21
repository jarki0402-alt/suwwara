import type { MouseEvent } from 'react';
import { useEffect, useState } from 'react';
import { sendCommand } from '../connect/connectClient';
import { projectedPosition, useConnectStore } from '../connect/connectStore';
import { Icon } from '../components/Icon/Icon';
import { useToast } from '../components/Toast/ToastProvider';
import styles from './RemoteBar.module.css';

/**
 * Stands in for the MiniPlayer while this device is steering another one (Spotify Connect
 * style). Deliberately a separate bar rather than a "remote mode" inside the MiniPlayer: the
 * local player, its controller and the audio engine stay exactly as they are, and this bar
 * only ever sends commands and draws what the other device reported.
 */
export function RemoteBar() {
  const { showToast } = useToast();
  const controllingRef = useConnectStore((state) => state.controllingRef);
  const youRef = useConnectStore((state) => state.youRef);
  const device = useConnectStore((state) => state.devices.find((candidate) => candidate.ref === state.controllingRef));
  const control = useConnectStore((state) => state.control);
  // Repaint twice a second to move the playhead — it is projected from the last report, not polled.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 500);
    return () => clearInterval(id);
  }, []);

  if (!controllingRef || !device) return null;
  const state = device.state;
  const song = state?.song ?? null;
  const duration = state?.durationSec ?? 0;
  const position = projectedPosition(device);

  const command = async (type: string, payload?: unknown) => {
    const delivered = await sendCommand(controllingRef, type, payload);
    if (!delivered) showToast(`${device.name} tidak terhubung.`, { type: 'error' });
  };

  const handleSeek = (event: MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    void command('seek', { positionSec: Math.round(ratio * duration) });
  };

  const handleBringHere = async () => {
    if (!youRef) return;
    const delivered = await sendCommand(controllingRef, 'handoff', { toRef: youRef });
    control(null);
    if (!delivered) showToast(`${device.name} tidak terhubung.`, { type: 'error' });
  };

  return (
    <div className={styles.wrapper} data-player-bar="" role="region" aria-label={`Mengontrol ${device.name}`}>
      <div className={styles.deviceLine}>
        <Icon name="devices" size={14} />
        <span>Mengontrol {device.name}</span>
        <span className={styles.spacer} />
        <button type="button" className={styles.linkButton} onClick={() => void handleBringHere()}>
          Putar di sini
        </button>
        <button type="button" className={styles.linkButton} onClick={() => control(null)}>
          Selesai
        </button>
      </div>

      <div className={styles.row}>
        {song?.image ? <img src={song.image} alt="" className={styles.art} /> : <div className={styles.art} />}
        <div className={styles.text}>
          <span className={styles.title}>{song?.name ?? 'Belum ada lagu diputar'}</span>
          <span className={styles.subtitle}>{song?.artist ?? 'Pilih lagu di perangkat itu, atau pindahkan pemutaran ke sini.'}</span>
        </div>
        <div className={styles.controls}>
          <button type="button" className={styles.iconButton} onClick={() => void command('previous')} aria-label="Lagu sebelumnya">
            <Icon name="previous" size={20} />
          </button>
          <button type="button" className={[styles.iconButton, styles.playButton].join(' ')} onClick={() => void command('toggle')} aria-label={state?.isPlaying ? 'Jeda' : 'Putar'}>
            <Icon name={state?.isPlaying ? 'pause' : 'play'} size={20} />
          </button>
          <button type="button" className={styles.iconButton} onClick={() => void command('next')} aria-label="Lagu berikutnya">
            <Icon name="next" size={20} />
          </button>
        </div>
      </div>

      <div className={styles.track} onClick={handleSeek} role="slider" aria-label="Posisi lagu" aria-valuemin={0} aria-valuemax={Math.max(duration, 1)} aria-valuenow={Math.round(position)}>
        <div className={styles.trackRail}>
          <div className={styles.trackFill} style={{ width: `${duration > 0 ? Math.min((position / duration) * 100, 100) : 0}%` }} />
        </div>
      </div>

      {state?.canSetVolume && (
        <div className={styles.volume}>
          <Icon name={state.volume === 0 ? 'volume-mute' : 'volume'} size={16} />
          <input type="range" min={0} max={100} value={Math.round(state.volume * 100)} onChange={(event) => void command('volume', { value: Number(event.target.value) / 100 })} aria-label="Volume perangkat" />
        </div>
      )}
    </div>
  );
}
