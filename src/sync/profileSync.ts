import { notifyUnauthorized } from '../auth/authStore';
import { historyClearedAt, loadHistory, mergeHistory, replaceHistory, type PlayEvent } from '../recommendation/historyLog';
import { MIX_CHANGED_EVENT, readStoredMix as readWeekly, writeStoredMix as writeWeekly } from '../recommendation/weeklyDiscovery';
import { readStored as readDaily, writeStored as writeDaily } from '../recommendation/dailyDiscovery';
import { useHistoryStore } from '../stores/historyStore';
import { markProfileReady } from './profileReady';

/**
 * Keeps what makes the home page look the same on every device — play history and the current daily/weekly mixes —
 * in step across an account (server/src/routes/profile.ts). Each sync sends this device's copy and adopts the merge the
 * server answers with, so it can be repeated at any time: on start, after a local change (debounced), when the app is
 * opened again, and every few minutes. Failures are silent; the next trigger retries. Device settings (cache limit, data
 * saver, volume) are deliberately not part of it.
 */
interface ProfileData {
  history: PlayEvent[];
  clearedAt: number;
  weekly: { weekKey: string; songs: unknown[] } | null;
  daily: { dayKey: string; songs: unknown[] } | null;
}

const PUSH_DEBOUNCE_MS = 4000;
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15_000;

let started = false;
let applying = false;
let running = false;
let again = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function local(): ProfileData {
  return { history: loadHistory(), clearedAt: historyClearedAt(), weekly: readWeekly(), daily: readDaily() } as ProfileData;
}

async function request(): Promise<ProfileData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(local()), signal: controller.signal });
    if (!response.ok) {
      notifyUnauthorized(response.status);
      return null;
    }
    return (await response.json()) as ProfileData;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function apply(remote: ProfileData): void {
  applying = true;
  try {
    // Merge with what this device holds NOW, not what it held when the request went out: a song played meanwhile stays.
    const now = local();
    const clearedAt = Math.max(remote.clearedAt, now.clearedAt);
    const history = mergeHistory(remote.history, now.history, clearedAt);
    if (clearedAt !== now.clearedAt || JSON.stringify(history) !== JSON.stringify(now.history)) {
      replaceHistory(history, clearedAt);
      useHistoryStore.setState({ events: history });
    }
    if (remote.weekly && (!now.weekly || remote.weekly.weekKey > now.weekly.weekKey || (remote.weekly.weekKey === now.weekly.weekKey && JSON.stringify(remote.weekly) !== JSON.stringify(now.weekly)))) writeWeekly(remote.weekly as never);
    if (remote.daily && (!now.daily || remote.daily.dayKey > now.daily.dayKey || (remote.daily.dayKey === now.daily.dayKey && JSON.stringify(remote.daily) !== JSON.stringify(now.daily)))) writeDaily(remote.daily as never);
  } finally {
    applying = false;
  }
}

async function sync(): Promise<void> {
  if (running) {
    again = true; // something changed while a sync was in flight — run once more afterwards
    return;
  }
  running = true;
  try {
    const remote = await request();
    if (remote) apply(remote);
  } finally {
    running = false;
    markProfileReady();
    if (again) {
      again = false;
      schedulePush();
    }
  }
}

function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void sync();
  }, PUSH_DEBOUNCE_MS);
}

export function initProfileSync(): void {
  if (started) return;
  started = true;
  void sync();

  useHistoryStore.subscribe((state, previous) => {
    if (!applying && state.events !== previous.events) schedulePush();
  });
  window.addEventListener(MIX_CHANGED_EVENT, () => {
    if (!applying) schedulePush();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void sync();
  }, POLL_INTERVAL_MS);
}
