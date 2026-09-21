import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_CACHE_LIMIT_MB, DEFAULT_CACHE_RETENTION_DAYS } from '../audio-engine/cachePolicy';

export type ThemePreference = 'system' | 'light' | 'dark';

interface SettingsState {
  dataSaver: boolean;
  volume: number;
  theme: ThemePreference;
  /** Offline song cache: size budget in MB, and days without a play before a track is dropped (0 = never). */
  audioCacheMB: number;
  audioCacheDays: number;
  setDataSaver: (value: boolean) => void;
  setVolume: (value: number) => void;
  setTheme: (value: ThemePreference) => void;
  setAudioCacheMB: (value: number) => void;
  setAudioCacheDays: (value: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      dataSaver: false,
      volume: 1,
      theme: 'system',
      audioCacheMB: DEFAULT_CACHE_LIMIT_MB,
      audioCacheDays: DEFAULT_CACHE_RETENTION_DAYS,
      setDataSaver: (value) => set({ dataSaver: value }),
      setVolume: (value) => set({ volume: Math.min(Math.max(value, 0), 1) }),
      setTheme: (value) => set({ theme: value }),
      setAudioCacheMB: (value) => set({ audioCacheMB: value }),
      setAudioCacheDays: (value) => set({ audioCacheDays: value }),
    }),
    { name: 'suwwara-settings' },
  ),
);
