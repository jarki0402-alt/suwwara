import type { Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import { setQueue } from '../jam/jamQueueActions';

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
  setQueue(songs, startIndex);
}
