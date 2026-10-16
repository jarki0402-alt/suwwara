import { create } from 'zustand';

export interface RemoteState {
  song: { id: string; name: string; artist: string; image: string } | null;
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  canSetVolume: boolean;
  /** Set while that device is itself a remote for another one. */
  followingRef?: string | null;
  inJam?: boolean;
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
  /**
   * Non-null while this device is a remote for that one — the device the account's session is playing on. Set
   * automatically (sessionSync's follow rule) as soon as another device plays, like Spotify showing "Playing on Laptop".
   */
  controllingRef: string | null;
  setConnected: (connected: boolean) => void;
  setDevices: (youRef: string, devices: Omit<RemoteDevice, 'receivedAt'>[]) => void;
  control: (ref: string | null) => void;
  /** Shows a remote's effect right away (play/pause, seek, volume) instead of waiting ~300ms for that device to report it. */
  patchDevice: (ref: string, patch: Partial<RemoteState>) => void;
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
  patchDevice: (ref, patch) =>
    set((state) => ({
      devices: state.devices.map((device) => {
        if (device.ref !== ref || !device.state) return device;
        // Re-anchor the projection at "now" so the playhead neither jumps back nor keeps running through a pause.
        const positionSec = patch.positionSec ?? projectedPosition(device);
        return { ...device, state: { ...device.state, ...patch, positionSec }, receivedAt: Date.now() };
      }),
    })),
  reset: () => set({ connected: false, youRef: null, devices: [], controllingRef: null }),
}));

/** The playhead of a remote device right now, projected from when its state arrived. */
export function projectedPosition(device: RemoteDevice): number {
  const state = device.state;
  if (!state) return 0;
  const elapsed = state.isPlaying ? (Date.now() - device.receivedAt) / 1000 : 0;
  return Math.min(state.positionSec + elapsed, state.durationSec > 0 ? state.durationSec : Infinity);
}

/** The device this one is a remote for, while it is online. */
export function followedDevice(): RemoteDevice | null {
  const { controllingRef, devices } = useConnectStore.getState();
  if (!controllingRef) return null;
  return devices.find((device) => device.ref === controllingRef) ?? null;
}

export function useFollowedDevice(): RemoteDevice | null {
  return useConnectStore((state) => (state.controllingRef ? (state.devices.find((device) => device.ref === state.controllingRef) ?? null) : null));
}
