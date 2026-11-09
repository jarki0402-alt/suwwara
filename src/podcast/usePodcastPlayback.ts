import { useEffect, useRef } from 'react';
import type { Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import { isEpisode } from './episodeRegistry';
import { songToEpisode } from './playEpisode';
import { usePodcastStore } from './podcastStore';
import { useJamStore } from '../stores/jamStore';

// Cheap (a property read) and needed so a save made right after the song changes still knows the old position.
const SAMPLE_MS = 2000;
// One small PUT per episode every 15s while it plays; also on pause, on leaving the app, and on a change of track.
const SAVE_EVERY_MS = 15_000;
const MIN_WORTH_SAVING_SEC = 3;

/**
 * The podcast side of playback, run once next to usePlaybackController (PlaybackProvider): the listening speed,
 * saving where an episode is so it resumes there (on any device), and the sleep timer. Timers here are plain
 * intervals, not frameTicker, on purpose: frameTicker stops while the page is hidden, which is exactly when an
 * episode is usually being listened to.
 */
export function usePodcastPlayback(currentSong: Song | null, status: string): void {
  const speed = usePodcastStore((state) => state.speed);
  const sleep = usePodcastStore((state) => state.sleep);
  const episode = isEpisode(currentSong) ? currentSong : null;
  // Speed and the sleep timer are one listener's: in a Jam, 1.5x on one device would drift from the room and a timer
  // would pause everyone, so a Jam plays at 1x and ignores the timer.
  const inJam = useJamStore((state) => state.role !== 'solo');
  const lastPosition = useRef<{ id: string; position: number }>({ id: '', position: 0 });

  useEffect(() => {
    audioEngine.setPlaybackRate(episode && !inJam ? speed : 1);
  }, [episode?.id, speed, inJam]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!episode) return;
    const song = episode;
    // Only the device that is actually playing it saves; a remote's engine holds nothing.
    const sample = () => {
      if (audioEngine.getCurrentSong()?.id !== song.id) return;
      const position = audioEngine.getCurrentTime();
      if (position > 0) lastPosition.current = { id: song.id, position };
    };
    const save = () => {
      sample();
      const { id, position } = lastPosition.current;
      if (id !== song.id || position < MIN_WORTH_SAVING_SEC) return;
      usePodcastStore.getState().saveProgress(songToEpisode(song), position, song.duration || audioEngine.getDuration());
    };
    const sampler = setInterval(sample, SAMPLE_MS);
    const saver = setInterval(() => {
      if (audioEngine.getSnapshot().status === 'playing') save();
    }, SAVE_EVERY_MS);
    const onHidden = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', save);
    return () => {
      clearInterval(sampler);
      clearInterval(saver);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', save);
      // The track is changing: the engine may already hold the next one, so this uses the last sample.
      const { id, position } = lastPosition.current;
      if (id === song.id && position >= MIN_WORTH_SAVING_SEC && !usePodcastStore.getState().progress[song.id]?.finished) {
        usePodcastStore.getState().saveProgress(songToEpisode(song), position, song.duration);
      }
    };
  }, [episode?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!episode || status !== 'paused' || audioEngine.getCurrentSong()?.id !== episode.id) return;
    const position = audioEngine.getCurrentTime();
    if (position >= MIN_WORTH_SAVING_SEC) usePodcastStore.getState().saveProgress(songToEpisode(episode), position, episode.duration);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sleep?.endsAt || inJam) return;
    const timer = setTimeout(
      () => {
        audioEngine.pause();
        usePodcastStore.getState().setSleep(null);
      },
      Math.max(0, sleep.endsAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [sleep?.endsAt, inJam]);
}
