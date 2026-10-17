/**
 * Playback trouble reported by the devices themselves: music stopping in the background on a phone can't be reproduced
 * on a laptop, and the people it happens to are listeners, not testers to be asked for logs. The app sends a short note
 * when it happens (src/diagnostics/playbackReports.ts) and the admin console shows the latest ones.
 *
 * In memory only, hard-capped: a ring of the newest MAX_REPORTS, each field cut to a fixed length, so the whole thing
 * stays well under a megabyte on the 1GB VM whatever the clients send. A restart forgets them, which is fine for notes
 * that only matter while a problem is being looked into.
 */
export interface PlaybackReport {
  at: number;
  username: string;
  event: string;
  device: string;
  detail: string;
}

const MAX_REPORTS = 200;
const MAX_EVENT = 40;
const MAX_DEVICE = 160;
const MAX_DETAIL = 2000;

const reports: PlaybackReport[] = [];

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');

/** Stores a report, or returns false when the body isn't one. */
export function addPlaybackReport(username: string, body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  const event = text(b.event, MAX_EVENT);
  if (!/^[a-z_]+$/.test(event)) return false;
  reports.push({ at: Date.now(), username: username.slice(0, 64), event, device: text(b.device, MAX_DEVICE), detail: text(b.detail, MAX_DETAIL) });
  if (reports.length > MAX_REPORTS) reports.splice(0, reports.length - MAX_REPORTS);
  return true;
}

/** Newest first. */
export function listPlaybackReports(): PlaybackReport[] {
  return [...reports].reverse();
}

export function clearPlaybackReports(): void {
  reports.length = 0;
}
