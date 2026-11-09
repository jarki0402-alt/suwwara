import { useEffect, useSyncExternalStore } from 'react';
import type { Song } from '../api/types';
import { useJamStatus } from '../jam/useJamStatus';
import { usePlayback } from '../playback/PlaybackContext';
import { useQueueStore } from '../stores/queueStore';
import { lookupMusicVideo, peekMusicVideo, subscribeLookups, useVideoMode, type MusicVideo } from './musicVideo';

/**
 * The music video of `song` when one can be offered here, else null. Not while this device is a remote for another
 * (the picture would follow a sound playing elsewhere) or in a Jam (a different cut would pause the room's song).
 * While Video is picked, the next song's lookup is made ahead, so its video is ready the moment it starts.
 */
export function useMusicVideo(song: Song | null): MusicVideo | null {
  const { remoteDevice } = usePlayback();
  const jam = useJamStatus();
  // Not for podcast episodes: the Podcast tab is audio only on purpose (bandwidth, and it is what it is for).
  const enabled = song !== null && song.kind !== 'episode' && remoteDevice === null && !jam.active;
  const wanted = useVideoMode((state) => state.wanted);
  const nextSong = useQueueStore((state) => (wanted ? (state.queue[state.order[state.position + 1]] ?? null) : null));

  const video = useSyncExternalStore(subscribeLookups, () => (song ? peekMusicVideo(song.id) : undefined));

  useEffect(() => {
    if (enabled && song && peekMusicVideo(song.id) === undefined) void lookupMusicVideo(song);
  }, [enabled, song]);
  useEffect(() => {
    if (enabled && nextSong && peekMusicVideo(nextSong.id) === undefined) void lookupMusicVideo(nextSong);
  }, [enabled, nextSong]);

  return enabled ? (video ?? null) : null;
}
