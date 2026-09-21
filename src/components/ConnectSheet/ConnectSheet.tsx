import { useEffect, useRef, type MouseEvent } from 'react';
import { audioEngine } from '../../audio-engine/AudioEngine';
import { sendCommand } from '../../connect/connectClient';
import { useConnectStore } from '../../connect/connectStore';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { currentQueueSnapshot } from '../../jam/queueSnapshot';
import { usePlayback } from '../../playback/PlaybackContext';
import { useJamStore } from '../../stores/jamStore';
import { useUiStore } from '../../stores/uiStore';
import { Icon } from '../Icon/Icon';
import { useToast } from '../Toast/ToastProvider';
import sheetStyles from '../JamSheet/JamSheet.module.css';
import styles from './ConnectSheet.module.css';

/**
 * The device list itself — this device, plus every other device on the account that is online right now. From
 * here a device can be steered ("Kontrol"), or playback can be moved to it ("Putar di sana") or pulled from it
 * ("Putar di sini"). Shown in two shells (see ConnectSheet below).
 *
 * `closeAfterAction`: the phone's sheet covers the page, so it closes once you have picked something; the desktop
 * panel sits beside the page and stays put (the player bar already shows who is being steered).
 */
function ConnectBody({ closeAfterAction }: { closeAfterAction: boolean }) {
  const { showToast } = useToast();
  const { currentSong, playbackState } = usePlayback();
  const closeSheet = useUiStore((state) => state.closeConnectSheet);
  const devices = useConnectStore((state) => state.devices);
  const youRef = useConnectStore((state) => state.youRef);
  const controllingRef = useConnectStore((state) => state.controllingRef);
  const control = useConnectStore((state) => state.control);
  const inJam = useJamStore((state) => state.role !== 'solo');

  const others = devices.filter((device) => device.ref !== youRef);
  const self = devices.find((device) => device.ref === youRef);
  const close = () => {
    if (closeAfterAction) closeSheet();
  };

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
    <div className={styles.body}>
      {inJam && <p className={styles.note}>Kontrol jarak jauh dimatikan selama kamu ada di sebuah Jam.</p>}

      <button
        type="button"
        className={[styles.row, controllingRef === null ? styles.rowActive : ''].join(' ')}
        onClick={() => {
          control(null);
          close();
        }}
      >
        <Icon name="devices" size={20} />
        <span className={styles.rowText}>
          <span className={styles.rowTitle}>Perangkat ini{self ? ` · ${self.name}` : ''}</span>
          <span className={styles.rowSub}>{currentSong ? currentSong.name : 'Belum ada lagu'}</span>
        </span>
      </button>

      {others.length === 0 ? (
        <p className={styles.empty}>Belum ada perangkat lain yang aktif. Masuk dengan akun yang sama di perangkat lain — ia akan muncul di sini.</p>
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
  );
}

/**
 * "Perangkat" (Spotify's Connect). On desktop it is a panel docked to the right edge — the same column Now Playing
 * uses, with the page making room for it (AppShell) — so devices can be managed without covering what you are
 * doing. On a phone it is a sheet from the bottom.
 */
export function ConnectSheet() {
  const isDesktop = useIsDesktop();
  const close = useUiStore((state) => state.closeConnectSheet);
  const panelRef = useRef<HTMLElement>(null);
  const stop = (event: MouseEvent) => event.stopPropagation();

  // The panel stops above whichever player bar is showing (MiniPlayer, or RemoteBar while steering another device —
  // they differ in height), or runs to the bottom when there is none.
  useEffect(() => {
    if (!isDesktop) return;
    const panel = panelRef.current;
    const bar = document.querySelector<HTMLElement>('[data-player-bar]');
    if (!panel) return;
    const apply = () => {
      panel.style.bottom = `${bar?.offsetHeight ?? 0}px`;
    };
    apply();
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDesktop, close]);

  if (isDesktop) {
    return (
      <aside ref={panelRef} className={styles.panel} aria-label="Perangkat">
        <div className={sheetStyles.header}>
          <span className={sheetStyles.title}>Perangkat</span>
          <button type="button" className={sheetStyles.closeButton} onClick={close} aria-label="Tutup">
            <Icon name="close" size={18} />
          </button>
        </div>
        <ConnectBody closeAfterAction={false} />
      </aside>
    );
  }

  return (
    <div className={sheetStyles.overlay} onClick={close}>
      <div className={sheetStyles.sheet} onClick={stop}>
        <div className={sheetStyles.header}>
          <span className={sheetStyles.title}>Perangkat</span>
          <button type="button" className={sheetStyles.closeButton} onClick={close} aria-label="Tutup">
            <Icon name="close" size={18} />
          </button>
        </div>
        <ConnectBody closeAfterAction />
      </div>
    </div>
  );
}
