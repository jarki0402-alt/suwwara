import type { JamPlaybackMeta } from '../stores/jamStore';

/**
 * Rules for when a Jam participant may move its OWN playhead to match the room's. Pure, so they can be tested
 * without an audio element.
 *
 * Why they exist: `audioEngine.seek()` moves whichever element is *audible right now*. While a new track is still
 * loading, that is the previous — often already skipped — track. Seeking it to "where the room is" (a few seconds
 * into the NEW track) replayed the first second of a song everyone had moved on from, again and again while the
 * host skipped through the queue.
 */

/** Where the room's playhead is at `nowMs`, rolled forward from when its state last arrived. */
export function roomPositionSec(meta: JamPlaybackMeta, nowMs: number): number {
  const elapsedSec = meta.isPlaying ? Math.max(0, nowMs - meta.lastUpdatedAtMs) / 1000 : 0;
  return meta.positionSec + elapsedSec;
}

/**
 * Whether the audible track is the one the room is on, fully loaded and playing — the only state in which nudging
 * its position toward the room's makes sense (during a transition the audible track is the old one; while loading
 * there is nothing settled to nudge).
 */
export function canSyncToRoom(engineSongId: string | null, roomSongId: string | null, status: string): boolean {
  return engineSongId !== null && engineSongId === roomSongId && status === 'playing';
}

/**
 * After a load finishes: is this still the track the room is on? A load that was overtaken by a newer one resolves
 * normally (it is not an error), so its completion handler must check before touching the audio.
 */
export function isLoadStillCurrent(loadedSongId: string, engineSongId: string | null, roomSongId: string | null): boolean {
  return engineSongId === loadedSongId && roomSongId === loadedSongId;
}

/**
 * The position to seek to so this device lines up with the room, or null when it is already close enough (small
 * drift is inaudible, and a needless seek is not) or the target would land at the very end of the track (that
 * would end it and advance the whole room).
 */
export function catchUpTarget(
  meta: JamPlaybackMeta,
  nowMs: number,
  currentTimeSec: number,
  thresholdSec: number,
  durationSec: number,
): number | null {
  const target = roomPositionSec(meta, nowMs);
  if (Math.abs(target - currentTimeSec) <= thresholdSec) return null;
  if (durationSec > 0 && target >= durationSec - 1) return null;
  return target;
}
