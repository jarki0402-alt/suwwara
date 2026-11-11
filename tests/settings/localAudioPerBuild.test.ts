import { afterEach, describe, expect, it, vi } from 'vitest';

// A minimal localStorage, so the store's persisted state can be set up before it loads (Vitest runs in Node).
function stubStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  // zustand's persist reads window.localStorage.
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
}

const saved = (state: Record<string, unknown>) => ({ 'suwwara-settings': JSON.stringify({ state, version: 4 }) });

async function loadStore() {
  vi.resetModules();
  return (await import('../../src/stores/settingsStore')).useSettingsStore;
}

afterEach(() => vi.unstubAllGlobals());

describe('"Simpan lagu di perangkat" per build', () => {
  it('comes back on after an update, whoever switched it off', async () => {
    stubStorage(saved({ localAudioEnabled: false, localAudioFailureCount: 2, localAudioBuild: 'an-older-build' }));
    const store = await loadStore();
    expect(store.getState().localAudioEnabled).toBe(true);
    expect(store.getState().localAudioFailureCount).toBe(0);
    expect(store.getState().localAudioBuild).toBe(__APP_BUILD__);
  });

  it('stays off when switched off on this same build', async () => {
    stubStorage(saved({ localAudioEnabled: false, localAudioFailureCount: 0, localAudioBuild: __APP_BUILD__ }));
    const store = await loadStore();
    expect(store.getState().localAudioEnabled).toBe(false);
  });

  it('is on for someone opening Suwwara for the first time', async () => {
    stubStorage({});
    const store = await loadStore();
    expect(store.getState().localAudioEnabled).toBe(true);
  });
});
