import { audioEngine } from '../audio-engine/AudioEngine';
import { currentQueueSnapshot } from '../jam/queueSnapshot';
import { useConnectStore } from './connectStore';
import { useJamStore, type QueueSnapshot } from '../stores/jamStore';
import { useQueueStore } from '../stores/queueStore';
import { useSettingsStore } from '../stores/settingsStore';
import { sendCommand } from './connectClient';

export interface RemoteCommand {
  from: string;
  type: string;
  payload: unknown;
}

type ToastFn = (message: string, options?: { action?: { label: string; onClick: () => void } }) => void;
let toast: ToastFn = () => {};
export function setConnectToast(fn: ToastFn): void {
  toast = fn;
}

const RESTART_FROM_BEGINNING_THRESHOLD_SEC = 3;

function deviceName(ref: string): string {
  return useConnectStore.getState().devices.find((device) => device.ref === ref)?.name ?? 'perangkat lain';
}

/**
 * Runs a command another of the account's devices sent to THIS one. It drives the audio
 * engine and the queue directly — the same things the on-screen controls end up calling — so
 * nothing in the playback controller needed to know remote control exists.
 */
export function handleRemoteCommand({ from, type, payload }: RemoteCommand): void {
  // In a Jam the shared room owns the queue and transport; a stray command must not fight it.
  if (useJamStore.getState().role !== 'solo') return;
  const data = (payload ?? {}) as Record<string, unknown>;

  switch (type) {
    case 'play':
      audioEngine.play().catch(promptToResume);
      break;
    case 'pause':
      audioEngine.pause();
      if (data.reason === 'takeover') toast(`Dijeda — sekarang memutar di ${deviceName(from)}.`);
      break;
    case 'toggle':
      audioEngine.togglePlay();
      break;
    case 'next':
      useQueueStore.getState().next();
      break;
    case 'previous':
      if (audioEngine.getCurrentTime() > RESTART_FROM_BEGINNING_THRESHOLD_SEC) audioEngine.seek(0);
      else useQueueStore.getState().previous();
      break;
    case 'seek':
      if (typeof data.positionSec === 'number') audioEngine.seek(data.positionSec);
      break;
    case 'volume':
      if (typeof data.value === 'number') useSettingsStore.getState().setVolume(data.value);
      break;
    case 'transfer':
      applyTransfer(data as { snapshot?: QueueSnapshot; positionSec?: number; isPlaying?: boolean });
      break;
    case 'handoff':
      if (typeof data.toRef === 'string') void handOff(data.toRef);
      break;
  }
}

/** A `play` sent from elsewhere has no tap behind it on this device — a browser may refuse it; ask for one. */
function promptToResume(): void {
  toast('Ketuk untuk melanjutkan audio.', {
    action: {
      label: 'Putar',
      onClick: () => {
        void audioEngine.unlock();
        audioEngine.play().catch(() => {});
      },
    },
  });
}

/** Another device is moving its playback here: load its queue, jump to where it was, and start (or hold) as it was. */
function applyTransfer({ snapshot, positionSec = 0, isPlaying = true }: { snapshot?: QueueSnapshot; positionSec?: number; isPlaying?: boolean }): void {
  if (!snapshot || snapshot.queue.length === 0) return;
  const wantedId = snapshot.queue[snapshot.order[snapshot.position]]?.id;

  const settle = () => {
    if (positionSec > 1) audioEngine.seek(positionSec);
    if (isPlaying) audioEngine.play().catch(promptToResume);
    else audioEngine.pause();
  };

  // Same song already loaded here: nothing to reload, just line the playhead up.
  if (audioEngine.getCurrentSong()?.id === wantedId) {
    useQueueStore.setState(snapshot);
    settle();
    return;
  }

  useQueueStore.setState(snapshot);
  let done = false;
  const unsubscribe = audioEngine.subscribe((state) => {
    if (done || audioEngine.getCurrentSong()?.id !== wantedId) return;
    if (state.status === 'playing') {
      done = true;
      unsubscribe();
      if (positionSec > 1) audioEngine.seek(positionSec);
      if (!isPlaying) audioEngine.pause();
    }
  });
  // If it never gets going (an error, a skip), don't leave the listener behind.
  setTimeout(() => {
    done = true;
    unsubscribe();
  }, 30_000);
}

/** Someone wants this device's playback: hand over the queue and position, then stop here. */
async function handOff(toRef: string): Promise<void> {
  const wasPlaying = useConnectStore.getState().devices.find((device) => device.ref === useConnectStore.getState().youRef)?.state?.isPlaying ?? true;
  const delivered = await sendCommand(toRef, 'transfer', {
    snapshot: currentQueueSnapshot(),
    positionSec: audioEngine.getCurrentTime(),
    isPlaying: wasPlaying,
  });
  if (delivered) audioEngine.pause();
}
