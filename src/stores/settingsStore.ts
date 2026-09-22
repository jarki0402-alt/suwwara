import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_CACHE_RETENTION_DAYS } from '../audio-engine/cachePolicy';
import { DEFAULT_OFFLINE_QUOTA_MB } from '../downloads/downloadPolicy';

export type ThemePreference = 'system' | 'light' | 'dark';

// Two failures in a row (not "ever") is enough to call blob: audio unreliable on this device and stop
// trying it — see localAudioEnabled below. A single failure is treated as a possible one-off network/decode
// blip; recordLocalAudioSuccess resets the counter the moment a local blob plays fine again.
const LOCAL_AUDIO_FAILURE_THRESHOLD = 2;

interface SettingsState {
  dataSaver: boolean;
  volume: number;
  theme: ThemePreference;
  /**
   * Master switch for playing audio from local blob storage — both the opportunistic cache (AudioCache) and
   * deliberate offline downloads (downloads/downloadManager.ts). On by default everywhere, including iPhone/
   * iPad, which used to be hard-excluded here: iOS Safari has a documented history of unreliable blob: URL
   * audio, so rather than assume it still fails today this is tried and watched — AudioEngine calls
   * recordLocalAudioFailure whenever a blob fails to become playable, which flips this off automatically
   * after LOCAL_AUDIO_FAILURE_THRESHOLD misses in a row so a flaky device falls back to plain network
   * streaming (already reliable) instead of stalling on every single track. Exposed as a manual toggle in
   * Pengaturan too, so a user isn't stuck either way and can retry it themselves later (e.g. after an iOS
   * update) without waiting for a new release.
   */
  localAudioEnabled: boolean;
  /** Consecutive blob-playback failures since the last success. Not shown in the UI directly. */
  localAudioFailureCount: number;
  /**
   * Size budget (MB) for everything kept locally — deliberate downloads AND the opportunistic cache share this
   * one number now ("Tersimpan Offline" in Pengaturan), rather than each having its own separate budget: users
   * found two different storage settings for what looked like the same thing confusing. Downloads get first
   * claim on it (see downloadManager.run()'s admission check); the opportunistic cache only ever uses what's
   * left over, and shrinks on its own as downloads grow — see AudioCache.enforceLimits().
   */
  offlineQuotaMB: number;
  /** Days the opportunistic cache keeps a track nobody's played (0 = never expire) — purely a user preference
   * on top of the quota above, since quota+LRU alone doesn't cover "I don't care if there's room, I still want
   * this gone after a month". Only the opportunistic cache reads this; downloads are never subject to it. */
  audioCacheDays: number;
  setDataSaver: (value: boolean) => void;
  setVolume: (value: number) => void;
  setTheme: (value: ThemePreference) => void;
  setLocalAudioEnabled: (value: boolean) => void;
  recordLocalAudioFailure: () => void;
  recordLocalAudioSuccess: () => void;
  setOfflineQuotaMB: (value: number) => void;
  setAudioCacheDays: (value: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      dataSaver: false,
      volume: 1,
      theme: 'system',
      localAudioEnabled: true,
      localAudioFailureCount: 0,
      offlineQuotaMB: DEFAULT_OFFLINE_QUOTA_MB,
      audioCacheDays: DEFAULT_CACHE_RETENTION_DAYS,
      setDataSaver: (value) => set({ dataSaver: value }),
      setVolume: (value) => set({ volume: Math.min(Math.max(value, 0), 1) }),
      setTheme: (value) => set({ theme: value }),
      setLocalAudioEnabled: (value) => set({ localAudioEnabled: value, localAudioFailureCount: 0 }),
      recordLocalAudioFailure: () => {
        const count = get().localAudioFailureCount + 1;
        set(count >= LOCAL_AUDIO_FAILURE_THRESHOLD ? { localAudioFailureCount: count, localAudioEnabled: false } : { localAudioFailureCount: count });
      },
      recordLocalAudioSuccess: () => set({ localAudioFailureCount: 0 }),
      setOfflineQuotaMB: (value) => set({ offlineQuotaMB: value }),
      setAudioCacheDays: (value) => set({ audioCacheDays: value }),
    }),
    { name: 'suwwara-settings' },
  ),
);
