import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { describeThisDevice } from '../../auth/deviceInfo';
import { useConnectStore, type RemoteDevice } from '../../connect/connectStore';
import { deviceIcon } from '../../connect/deviceIcon';
import { moveTo } from '../../connect/remote';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { usePlayback } from '../../playback/PlaybackContext';
import { useJamStore } from '../../stores/jamStore';
import { useUiStore } from '../../stores/uiStore';
import { Icon } from '../Icon/Icon';
import { useToast } from '../Toast/ToastProvider';
import sheetStyles from '../JamSheet/JamSheet.module.css';
import styles from './ConnectSheet.module.css';

interface Choice {
  ref: string;
  name: string;
  icon: ReturnType<typeof deviceIcon>;
  sub: string;
  disabled: boolean;
}

function describeRemote(device: RemoteDevice): { sub: string; disabled: boolean } {
  if (device.state?.inJam) return { sub: 'Sedang di Jam', disabled: true };
  if (device.state?.song && !device.state.followingRef) return { sub: `${device.state.isPlaying ? 'Memutar' : 'Dijeda'} · ${device.state.song.name}`, disabled: false };
  return { sub: 'Siap memutar', disabled: false };
}

/**
 * Spotify's device picker. On top, where the account's music is playing right now (this device, or the one this
 * device is a remote for); under it every other device that is online, and one tap moves the music there — queue,
 * song and spot included. Shown in two shells (see ConnectSheet below).
 *
 * `closeAfterAction`: the phone's sheet covers the page, so it closes once you have picked something; the desktop
 * panel sits beside the page and stays put.
 */
function ConnectBody({ closeAfterAction }: { closeAfterAction: boolean }) {
  const { showToast } = useToast();
  const { currentSong, playbackState, remoteDevice } = usePlayback();
  const closeSheet = useUiStore((state) => state.closeConnectSheet);
  const devices = useConnectStore((state) => state.devices);
  const youRef = useConnectStore((state) => state.youRef);
  const inJam = useJamStore((state) => state.role !== 'solo');
  const [busyRef, setBusyRef] = useState<string | null>(null);

  const self = describeThisDevice();
  const selfName = devices.find((device) => device.ref === youRef)?.name ?? self.name;
  const hasMusic = currentSong !== null;

  // Where the sound is: the followed device, else this one once it has a song.
  const active = remoteDevice
    ? { ref: remoteDevice.ref, name: remoteDevice.name, icon: deviceIcon(remoteDevice.kind), isPlaying: remoteDevice.state?.isPlaying ?? false }
    : hasMusic
      ? { ref: youRef, name: `Perangkat ini · ${selfName}`, icon: deviceIcon(self.kind), isPlaying: playbackState.status === 'playing' || playbackState.status === 'loading' }
      : null;

  const choices: Choice[] = [];
  if (remoteDevice) choices.push({ ref: youRef ?? 'self', name: `Perangkat ini · ${selfName}`, icon: deviceIcon(self.kind), sub: 'Putar di sini', disabled: false });
  for (const device of devices) {
    if (device.ref === youRef || device.ref === active?.ref) continue;
    choices.push({ ref: device.ref, name: device.name, icon: deviceIcon(device.kind), ...describeRemote(device) });
  }

  const handlePick = async (choice: Choice) => {
    if (busyRef) return;
    setBusyRef(choice.ref);
    const moved = await moveTo(choice.ref === 'self' ? (youRef ?? '') : choice.ref);
    setBusyRef(null);
    if (!moved) {
      showToast(`${choice.name} tidak terhubung.`, { type: 'error' });
      return;
    }
    if (closeAfterAction) closeSheet();
  };

  return (
    <div className={styles.body}>
      {inJam && <p className={styles.note}>Selama kamu di Jam, musik tidak bisa dipindah ke perangkat lain.</p>}

      {active && currentSong && (
        <div className={styles.current}>
          <span className={styles.currentIcon}>
            <Icon name={active.icon} size={22} />
          </span>
          <span className={styles.rowText}>
            <span className={styles.currentLabel}>
              <Icon name="speaker" size={13} />
              {active.isPlaying ? 'Sedang memutar di' : 'Dijeda di'}
            </span>
            <span className={styles.currentName}>{active.name}</span>
            <span className={styles.rowSub}>{currentSong.name}</span>
          </span>
        </div>
      )}

      {choices.length > 0 ? (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>{hasMusic ? 'Pindahkan ke' : 'Perangkat aktif'}</span>
          <div className={styles.list}>
            {choices.map((choice) => (
              <button
                key={choice.ref}
                type="button"
                className={styles.row}
                disabled={inJam || choice.disabled || !hasMusic || (busyRef !== null && busyRef !== choice.ref)}
                onClick={() => void handlePick(choice)}
              >
                <span className={styles.rowIcon}>
                  <Icon name={choice.icon} size={20} />
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{choice.name}</span>
                  <span className={styles.rowSub}>{choice.sub}</span>
                </span>
                {busyRef === choice.ref && <Icon name="spinner" size={18} className={styles.spinner} />}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className={styles.empty}>Belum ada perangkat lain yang aktif. Buka Suwwara dengan akun yang sama di HP, tablet, atau laptop, lalu perangkat itu akan muncul di sini.</p>
      )}

      {/* Only beside a list there is something to tap; under the "no other device yet" text it just repeated it. */}
      {choices.length > 0 && (
        <p className={styles.footnote}>
          {hasMusic
            ? 'Ketuk perangkat untuk memindahkan musik ke sana, lanjut dari detik yang sama. Perangkatnya harus sedang membuka Suwwara.'
            : 'Putar lagu dulu, lalu pilih di perangkat mana musiknya diputar.'}
        </p>
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

  // The panel stops above the player bar when one is showing, or runs to the bottom when there is none.
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
      <div className={[sheetStyles.sheet, styles.sheetSolid].join(' ')} onClick={stop}>
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
