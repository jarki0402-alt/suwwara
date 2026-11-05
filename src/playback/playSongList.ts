import type { Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import { setQueue } from '../jam/jamQueueActions';
import { useConnectStore } from '../connect/connectStore';
import { useJamStore } from '../stores/jamStore';
import { useQueueStore } from '../stores/queueStore';

/**
 * Whether a tap on `songId` picks the song already on screen. The player only loads on a change of song, so tapping the
 * song that is shown but not sounding (the account's last song, shown paused when the app opens; or one paused by
 * hand) used to do nothing at all. Read BEFORE the queue is replaced; pass the answer to startIfUnchanged after.
 */
export function isCurrentSong(songId: string | undefined): boolean {
  return songId !== undefined && useQueueStore.getState().currentSong()?.id === songId;
}

/** See isCurrentSong. Solo only: in a Jam the room decides, and a remote's tap is carried to the device that plays. */
export function startIfUnchanged(wasCurrent: boolean): void {
  if (!wasCurrent || useJamStore.getState().role !== 'solo' || useConnectStore.getState().controllingRef) return;
  const status = audioEngine.getSnapshot().status;
  if (status === 'playing' || status === 'loading') return;
  audioEngine.play().catch(() => {});
}

/**
 * Starts playback of `songs` at `startIndex`, replacing the queue (or, while a
 * Jam is active, replacing it for everyone in the room — see jamQueueActions).
 * Must be called synchronously from within a click/tap handler — unlock()
 * needs to run inside the user-gesture call stack for iOS/Chrome's autoplay
 * policy to allow the AudioContext to resume. unlock() always runs locally
 * regardless of Jam mode: each device has its own AudioContext to unlock.
 */
export function playSongList(songs: Song[], startIndex = 0): void {
  void audioEngine.unlock();
  const wasCurrent = isCurrentSong(songs[startIndex]?.id);
  setQueue(songs, startIndex);
  startIfUnchanged(wasCurrent);
}
