import { audioEngine } from '../audio-engine/AudioEngine';
import { currentQueueSnapshot } from '../jam/queueSnapshot';
import { useQueueStore } from '../stores/queueStore';
import { showConnectToast } from './commandHandler';
import { sendCommand } from './connectClient';
import { followedDevice, projectedPosition, useConnectStore } from './connectStore';
import { applyResumePoint, peekResumePoint, setResumePoint } from './sessionHold';
import { suppressFollow } from './sessionSync';

/**
 * What this device's controls do while it is a remote for another device. Transport goes out as a Connect command and
 * is drawn right away (patchDevice) — the other device's own report confirms it a moment later. Queue moves (skip, tap
 * a song) don't come through here at all: they edit the mirrored queue, which the session carries over (sessionSync).
 */

// The volume slider fires on every pixel; the server allows 40 commands per 10s per device.
const VOLUME_SEND_MS = 300;
let volumeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingVolume: number | null = null;

function send(type: string, payload?: unknown): void {
  const device = followedDevice();
  if (!device) return;
  void sendCommand(device.ref, type, payload).then((delivered) => {
    if (!delivered) showConnectToast(`${device.name} tidak terhubung.`);
  });
}

export function remoteSetPlaying(isPlaying: boolean): void {
  const device = followedDevice();
  if (!device) return;
  useConnectStore.getState().patchDevice(device.ref, { isPlaying });
  send(isPlaying ? 'play' : 'pause');
}

export function remoteTogglePlay(): void {
  const device = followedDevice();
  if (device) remoteSetPlaying(!device.state?.isPlaying);
}

export function remoteSeek(positionSec: number): void {
  const device = followedDevice();
  if (!device) return;
  useConnectStore.getState().patchDevice(device.ref, { positionSec });
  send('seek', { positionSec });
}

export function remotePlayhead(): number {
  const device = followedDevice();
  return device ? projectedPosition(device) : 0;
}

export function remoteSetVolume(value: number): void {
  const device = followedDevice();
  if (!device) return;
  useConnectStore.getState().patchDevice(device.ref, { volume: value });
  pendingVolume = value;
  if (volumeTimer) return;
  send('volume', { value });
  pendingVolume = null;
  volumeTimer = setTimeout(function flush() {
    volumeTimer = null;
    if (pendingVolume === null) return;
    send('volume', { value: pendingVolume });
    pendingVolume = null;
    volumeTimer = setTimeout(flush, VOLUME_SEND_MS);
  }, VOLUME_SEND_MS);
}

/**
 * "Putar di sini": the song the other device is playing carries on here from its spot. Must run inside the tap — on
 * iOS that is what allows the audio to start. The other device is paused by the server's one-device-plays rule as
 * soon as this one reports it's playing (connectHub.updateDeviceState).
 */
export function playHere(): void {
  const device = followedDevice();
  const song = useQueueStore.getState().currentSong();
  if (device && song && device.state?.song?.id === song.id) setResumePoint(song.id, projectedPosition(device));
  suppressFollow();
  useConnectStore.getState().control(null);
  if (!song) return;
  audioEngine
    .play()
    // Only does anything when the song was already loaded here (no deferred load consumed the resume point).
    .then(() => applyResumePoint(song.id))
    .catch(() => showConnectToast('Gagal memutar di perangkat ini.'));
}

/** Moves the account's playback to `targetRef` (another device), from wherever it is now. False if it can't be reached. */
export async function moveTo(targetRef: string): Promise<boolean> {
  const { controllingRef, youRef, control } = useConnectStore.getState();
  if (targetRef === youRef) {
    playHere();
    return true;
  }
  if (controllingRef === targetRef) return true;

  if (controllingRef) {
    // Playing on a third device: ask it to hand its queue and spot over.
    const delivered = await sendCommand(controllingRef, 'handoff', { toRef: targetRef });
    if (!delivered) return false;
  } else {
    const song = useQueueStore.getState().currentSong();
    if (!song) return false;
    // Not loaded here yet (shown paused after the app opened): the spot is the one the session remembered.
    const positionSec = audioEngine.getCurrentSong()?.id === song.id ? audioEngine.getCurrentTime() : (peekResumePoint(song.id) ?? 0);
    const delivered = await sendCommand(targetRef, 'transfer', { snapshot: currentQueueSnapshot(), positionSec, isPlaying: true });
    if (!delivered) return false;
    audioEngine.pause();
  }
  suppressFollow();
  control(targetRef);
  return true;
}
