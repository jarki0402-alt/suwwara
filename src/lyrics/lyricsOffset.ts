/**
 * A per-song timing nudge for synced lyrics. LRCLIB's timestamps belong to one particular recording; the audio we play
 * can start a second earlier or later (a different intro), which shifts every line by the same amount. That shift is
 * the same for the whole song, so one number per song fixes it — remembered on this device.
 *
 * Positive = lyrics run earlier (a line lights up sooner), negative = later.
 */
const STORAGE_KEY = 'suwwara-lyrics-offsets';
const MAX_SONGS = 200;
export const OFFSET_STEP_SEC = 0.5;
export const OFFSET_LIMIT_SEC = 15;

function load(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function clampOffset(seconds: number): number {
  return Math.round(Math.max(-OFFSET_LIMIT_SEC, Math.min(OFFSET_LIMIT_SEC, seconds)) * 10) / 10;
}

export function getLyricsOffset(songId: string): number {
  const value = load()[songId];
  return typeof value === 'number' && Number.isFinite(value) ? clampOffset(value) : 0;
}

export function setLyricsOffset(songId: string, seconds: number): void {
  try {
    const all = load();
    delete all[songId]; // re-insert so the most recently adjusted songs are the ones kept
    const next = clampOffset(seconds);
    if (next !== 0) all[songId] = next;
    const keys = Object.keys(all);
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SONGS))) delete all[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable — the nudge still applies until the panel is closed
  }
}
