import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemePreference = 'system' | 'light' | 'dark';

interface SettingsState {
  dataSaver: boolean;
  volume: number;
  theme: ThemePreference;
  setDataSaver: (value: boolean) => void;
  setVolume: (value: number) => void;
  setTheme: (value: ThemePreference) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      dataSaver: false,
      volume: 1,
      theme: 'system',
      setDataSaver: (value) => set({ dataSaver: value }),
      setVolume: (value) => set({ volume: Math.min(Math.max(value, 0), 1) }),
      setTheme: (value) => set({ theme: value }),
    }),
    { name: 'suwwara-settings' },
  ),
);
