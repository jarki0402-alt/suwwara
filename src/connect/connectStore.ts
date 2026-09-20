import { create } from 'zustand';

export interface RemoteState {
  song: { id: string; name: string; artist: string; image: string } | null;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  canSetVolume: boolean;
}

export interface RemoteDevice {
  ref: string;
  name: string;
  kind: string;
  state: RemoteState | null;
  /** Local clock time this state arrived — remote positions are projected from it (never from another device's clock). */
  receivedAt: number;
}

interface ConnectState {
  connected: boolean;
  youRef: string | null;
  devices: RemoteDevice[];
  /** Non-null while this device is acting as the remote control for that device. */
  controllingRef: string | null;
  setConnected: (connected: boolean) => void;
  setDevices: (youRef: string, devices: Omit<RemoteDevice, 'receivedAt'>[]) => void;
  control: (ref: string | null) => void;
  reset: () => void;
}

/** Ephemeral (never persisted): who is online right now and who this device is steering. */
export const useConnectStore = create<ConnectState>((set) => ({
  connected: false,
  youRef: null,
  devices: [],
  controllingRef: null,
  setConnected: (connected) => set(connected ? { connected } : { connected, devices: [], controllingRef: null }),
  setDevices: (youRef, devices) => {
    const receivedAt = Date.now();
    set({ youRef, devices: devices.map((device) => ({ ...device, receivedAt })) });
  },
  control: (ref) => set({ controllingRef: ref }),
  reset: () => set({ connected: false, youRef: null, devices: [], controllingRef: null }),
}));

/** The playhead of a remote device right now, projected from when its state arrived. */
export function projectedPosition(device: RemoteDevice): number {
  const state = device.state;
  if (!state) return 0;
  const elapsed = state.isPlaying ? (Date.now() - device.receivedAt) / 1000 : 0;
  return Math.min(state.positionSec + elapsed, state.durationSec > 0 ? state.durationSec : Infinity);
}
