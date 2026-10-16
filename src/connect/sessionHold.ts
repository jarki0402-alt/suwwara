import { audioEngine } from '../audio-engine/AudioEngine';

/**
 * Two small hand-offs between the account session (sessionSync) and the playback controller, kept as plain module
 * state so neither has to know the other's internals.
 *
 * - A "hold": the next song the queue moves to is shown but NOT loaded — it is what another device is playing (or
 *   played last). Same treatment the app already gives last session's song on open (AudioEngine.deferStart): no audio
 *   starts by itself and the server isn't asked to resolve a song nobody chose here. The first play loads it.
 * - A "resume point": where that song should pick up once it does load here, so "Putar di sini" carries on from the
 *   other device's spot instead of restarting the song.
 */
let heldSongId: string | null = null;
let resumePoint: { songId: string; positionSec: number } | null = null;

export function holdNextLoad(songId: string): void {
  heldSongId = songId;
}

/** True (once) when `songId` was put on hold. */
export function consumeHold(songId: string): boolean {
  if (heldSongId !== songId) return false;
  heldSongId = null;
  return true;
}

export function setResumePoint(songId: string, positionSec: number): void {
  resumePoint = { songId, positionSec };
}

export function peekResumePoint(songId: string): number | null {
  return resumePoint?.songId === songId ? resumePoint.positionSec : null;
}

/** Hands out (and forgets) the resume point when it belongs to `songId`. */
export function takeResumePoint(songId: string): number | null {
  if (resumePoint?.songId !== songId) return null;
  const { positionSec } = resumePoint;
  resumePoint = null;
  return positionSec;
}

export function clearResumePoint(): void {
  resumePoint = null;
}

/** Once `songId` is actually playing here: jump to its resume point, if it has one. */
export function applyResumePoint(songId: string): void {
  const at = takeResumePoint(songId);
  if (at !== null && at > 1 && audioEngine.getCurrentSong()?.id === songId) audioEngine.seek(at);
}
