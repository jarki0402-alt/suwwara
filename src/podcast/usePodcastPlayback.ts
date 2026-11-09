import { useEffect, useRef } from 'react';
import type { Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import { useToast } from '../components/Toast/ToastProvider';
import { useConnectStore } from '../connect/connectStore';
import { useT } from '../i18n/i18n';
import { formatTime } from '../utils/formatTime';
import { isEpisode } from './episodeRegistry';
import { podcastApi } from './podcastApi';
import { songToEpisode } from './playEpisode';
import { lastWrittenHere, usePodcastStore } from './podcastStore';
import { useJamStore } from '../stores/jamStore';

// Cheap (a property read) and needed so a save made right after the song changes still knows the old position.
const SAMPLE_MS = 2000;
// One small PUT per episode every 15s while it plays; also on pause, on leaving the app, and on a change of track.
const SAVE_EVERY_MS = 15_000;
const MIN_WORTH_SAVING_SEC = 3;
// Played here this recently, nobody else can have got further meanwhile (a pause and play again, a stall): no check.
const PLAYED_HERE_RECENTLY_MS = 30_000;
// A spot from another device only moves the playhead when it is this far off. A Connect hand-over (Putar di sini)
// already starts at the other device's live spot, which can be ahead of its last 15-second save; that small gap must
// not pull it back.
const JUMP_MIN_SEC = 20;

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
  const playedHereAt = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  const pausedHere = useRef<{ id: string; position: number } | null>(null);
  const t = useT();
  const { showToast } = useToast();

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
      if (audioEngine.getSnapshot().status === 'playing') playedHereAt.current = { id: song.id, at: Date.now() };
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
    pausedHere.current = { id: episode.id, position };
    if (position >= MIN_WORTH_SAVING_SEC) usePodcastStore.getState().saveProgress(songToEpisode(episode), position, episode.duration);
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Moving between phone and laptop: an episode left paused on the laptop still sits at the laptop's old spot after
  // half an hour more on the phone. So the moment it starts sounding here (play button, lock screen, a load), ask the
  // server where this account is in it; if another device saved a spot after this one last did, carry on from there.
  // Started at once and corrected when the answer lands (well under a second), rather than waiting for it before
  // playing: play() has to stay inside the tap for iOS, and the ordinary start must not get slower.
  useEffect(() => {
    if (!episode || status !== 'playing' || inJam || useConnectStore.getState().controllingRef) return;
    const id = episode.id;
    if (audioEngine.getCurrentSong()?.id !== id) return;
    if (playedHereAt.current.id === id && Date.now() - playedHereAt.current.at < PLAYED_HERE_RECENTLY_MS) return;
    const startedFrom = audioEngine.getCurrentTime();
    const startedAt = Date.now();
    // Moved by hand here while paused: that is where the listener wants to be.
    const paused = pausedHere.current;
    if (paused?.id === id && Math.abs(startedFrom - paused.position) > 3) return;
    playedHereAt.current = { id, at: startedAt };
    void podcastApi
      .progressOf(id)
      .then((remote) => {
        if (!remote || remote.finished || remote.positionSec < 5 || remote.updatedAt <= lastWrittenHere(id)) return;
        if (audioEngine.getCurrentSong()?.id !== id || useJamStore.getState().role !== 'solo') return;
        const now = audioEngine.getCurrentTime();
        // Seeked (or skipped 15s) while the answer was on its way: the listener's own move wins.
        const expected = startedFrom + ((Date.now() - startedAt) / 1000) * audioEngine.getPlaybackRate();
        if (Math.abs(now - expected) > 3 || Math.abs(remote.positionSec - now) < JUMP_MIN_SEC) return;
        audioEngine.seek(remote.positionSec);
        const store = usePodcastStore.getState();
        const known = store.progress[id];
        if (known) usePodcastStore.setState({ progress: { ...store.progress, [id]: { ...known, positionSec: remote.positionSec, updatedAt: remote.updatedAt } } });
        showToast(t('Lanjut dari {time}, posisi terakhir di perangkat lain', { time: formatTime(remote.positionSec) }));
      })
      .catch(() => {});
  }, [status, episode?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
