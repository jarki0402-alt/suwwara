import { useCallback, useEffect, useRef } from 'react';
import type { Song } from '../api/types';
import { prefetchAudioFull, prefetchAudioResolveOnly } from '../api/musicClient';
import { cacheSongs } from '../api/songCache';
import { audioEngine } from '../audio-engine/AudioEngine';
import { useAudioEngine } from '../audio-engine/useAudioEngine';
import { useToast } from '../components/Toast/ToastProvider';
import { sendJamIntent } from '../jam/jamClient';
import { useMediaSession } from '../media-session/useMediaSession';
import { useHistoryStore } from '../stores/historyStore';
import { useJamStore } from '../stores/jamStore';
import { usePlayerStore } from '../stores/playerStore';
import { useQueueStore } from '../stores/queueStore';
import { useSettingsStore } from '../stores/settingsStore';
import { extendQueueWithRadio } from './playSongRadio';

const COMPLETION_THRESHOLD = 0.9;
const COMPLETION_POLL_MS = 2000;
// How long currentTime can sit completely frozen at/near the track's end before we
// treat it as stuck and force the same advance a native 'ended' event would have
// triggered. Some devices/streams just stop dead without ever firing 'ended' — this
// is what used to leave a track sitting there forever with the seek bar pinned at the
// end and nothing playing next.
const STALL_GRACE_MS = 4000;
// How long the AudioContext can sit non-'running' (sound genuinely not reaching the
// speakers) while we still think we're 'playing' before giving up on it ever recovering
// and moving on — much shorter than OVERRUN_GRACE_SEC since a legitimate brief
// suspend (screen lock/unlock) self-heals in under a second; this is specifically for
// the "resume() silently never works" dead end.
const SILENT_PLAYBACK_GRACE_MS = 8000;
// A track that fails to load/play at all used to just sit there dead — the error
// toast explained why, but the queue never moved on like every other streaming app
// does when a track can't play. Capped so a genuine total outage doesn't rapid-fire
// through the whole queue in an instant.
const MAX_CONSECUTIVE_AUTO_SKIP = 3;
const RESTART_FROM_BEGINNING_THRESHOLD_SEC = 3;
// How far a Jam participant's own local position may drift from the room's
// last-known position before it's worth an audible seek to correct it — small
// drift is inaudible/expected (network jitter), so this avoids constant
// micro-seeking that would otherwise make playback feel jerky.
const JAM_DRIFT_THRESHOLD_SEC = 1.5;
const JAM_DRIFT_CHECK_MS = 2000;
// Short enough to feel instant ("langsung play"), just long enough to avoid
// an audible click between tracks — no longer user-configurable.
const TRANSITION_FADE_SEC = 0.35;
// Once the queue is down to this many unplayed tracks, top it back up — keeps a
// radio-style queue flowing continuously (like any other streaming app) instead
// of ever visibly running out and stopping.
const EXTEND_QUEUE_THRESHOLD = 3;
// How many upcoming tracks to keep warm. Only the very next one gets a full
// audio-byte prefetch (genuinely costs the same server work as playing it —
// see prefetchAudioFull's own doc comment for why that's capped to just one);
// the rest only get the cheap yt-dlp-resolve-only warm-up.
const PREFETCH_LOOKAHEAD = 2;

/**
 * Orchestration layer wiring queueStore/settingsStore to the AudioEngine and
 * MediaSession — the audio engine itself stays free of any knowledge of
 * Zustand or the queue, per the app's module boundaries.
 */
export function usePlaybackController() {
  const queue = useQueueStore((s) => s.queue);
  const order = useQueueStore((s) => s.order);
  const position = useQueueStore((s) => s.position);
  const repeatMode = useQueueStore((s) => s.repeatMode);
  const shuffle = useQueueStore((s) => s.shuffle);
  const advanceOnEnded = useQueueStore((s) => s.advanceOnEnded);
  const next = useQueueStore((s) => s.next);
  const previous = useQueueStore((s) => s.previous);
  const peekUpcoming = useQueueStore((s) => s.peekUpcoming);

  const dataSaver = useSettingsStore((s) => s.dataSaver);
  const volume = useSettingsStore((s) => s.volume);

  const setCurrentSongId = usePlayerStore((s) => s.setCurrentSongId);
  const setPlaybackStatus = usePlayerStore((s) => s.setPlaybackStatus);
  const playerError = usePlayerStore((s) => s.error);
  const recordHistory = useHistoryStore((s) => s.record);
  const { showToast } = useToast();

  // Jam mode: 'solo' means every effect/handler below behaves exactly as it
  // always has. While a Jam is active, transport/queue actions are redirected
  // to server intents instead of mutating local state directly — see the
  // gates inline below and useJamSync.ts for how the resulting broadcast state
  // comes back in.
  const jamRole = useJamStore((s) => s.role);
  const jamRoomId = useJamStore((s) => s.roomId);
  const jamClientId = useJamStore((s) => s.clientId);
  const jamIsCreator = useJamStore((s) => s.isCreator);
  const jamPlaybackMeta = useJamStore((s) => s.playbackMeta);

  const engineState = useAudioEngine();
  const currentSong: Song | null = queue[order[position] ?? -1] ?? null;

  const loadedSongIdRef = useRef<string | null>(null);
  const completedRef = useRef(false);
  // Guards against advancing twice for the same song — the stall watchdog and a
  // (possibly late) native 'ended' event could otherwise both fire for it.
  const advancedForSongIdRef = useRef<string | null>(null);
  const consecutiveErrorsRef = useRef(0);
  // Guards the "tap to resume audio" prompt below so a still-blocked remote
  // play doesn't spam a fresh toast every time a heartbeat re-evaluates it.
  const jamPlayPromptShownRef = useRef(false);

  useEffect(() => {
    audioEngine.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (!currentSong) {
      loadedSongIdRef.current = null;
      setCurrentSongId(null);
      return;
    }
    if (loadedSongIdRef.current === currentSong.id) return;

    const wasIdle = loadedSongIdRef.current === null;
    loadedSongIdRef.current = currentSong.id;
    completedRef.current = false;
    advancedForSongIdRef.current = null;
    setCurrentSongId(currentSong.id);
    cacheSongs([currentSong]);

    // In solo mode always autoplay (existing behavior, unchanged). In a Jam,
    // the very first track loaded from idle should only autoplay if the
    // room's canonical state already says something's playing — otherwise a
    // song added to an empty shared queue would audibly blip into playback
    // for an instant before the play/pause-sync effect below corrects it back
    // to paused.
    const jamStateAtLoad = useJamStore.getState();
    const shouldAutoplay = jamStateAtLoad.role === 'solo' ? true : (jamStateAtLoad.playbackMeta?.isPlaying ?? true);

    const action = wasIdle
      ? audioEngine.loadTrack(currentSong, { dataSaver, autoplay: shouldAutoplay, fadeInSec: 0.6 })
      : audioEngine.crossfadeTo(currentSong, TRANSITION_FADE_SEC, dataSaver);

    action
      .then(() => {
        // loadTrack/crossfadeTo always start at position 0 — a Jam participant
        // joining mid-song (or resyncing after a reconnect) needs an explicit
        // catch-up seek to the room's last-known position.
        const jamState = useJamStore.getState();
        if (jamState.role === 'solo') return;
        const meta = jamState.playbackMeta;
        if (meta && meta.positionSec > 0) audioEngine.seek(meta.positionSec);
      })
      .catch((error: unknown) => {
        const timedOut = error instanceof Error && error.message.includes('Timed out');
        setPlaybackStatus({
          isPlaying: false,
          isBuffering: false,
          error: timedOut ? 'Koneksi lambat — lagu gagal dimuat.' : 'Gagal memutar lagu ini.',
        });
      });
    // Intentionally keyed on the song id only: dataSaver should apply to the *next* transition, not retrigger this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id]);

  // Shared by every "this track is done, move on" trigger below (native 'ended',
  // the stall watchdog, and the playback-error fallback) — whichever one reaches
  // it first for a given song owns the advance, exactly once.
  const runCompletionAdvance = useCallback(
    (song: Song) => {
      if (advancedForSongIdRef.current === song.id) return;
      advancedForSongIdRef.current = song.id;

      recordHistory({
        songId: song.id,
        artistIds: song.artists.primary.map((artist) => artist.id),
        timestamp: Date.now(),
        completed: completedRef.current,
      });

      // In a Jam, every participant runs this same local watchdog — whichever
      // device's poll reaches the server first actually advances the shared
      // queue (the server dedupes by song id, see roomManager.applyIntent), so
      // this stays self-healing even if one device's timer lags. The server's
      // resulting broadcast is what actually moves this device's queueStore
      // forward (via useJamSync), not the local advanceOnEnded() call below.
      if (jamRole !== 'solo' && jamRoomId) {
        void sendJamIntent(jamRoomId, jamClientId, 'advance-on-ended', { songId: song.id });
        return;
      }

      const upcoming = advanceOnEnded();
      if (upcoming) return;

      // Rare fallback — the proactive top-up effect below should normally keep the
      // queue from ever actually running dry. Seeded from the song that just
      // finished (buildRadioQueue) rather than history-wide artist-affinity
      // scoring, so this stays consistent with how the rest of the radio queue
      // was built instead of picking a genre-inconsistent song right at the seam.
      // extendQueueWithRadio shares its in-flight lock with the proactive effect
      // below (and with playSongRadio's own initial build) — without that, two of
      // these could fire for the same seed at once, neither aware of the other's
      // still-in-flight candidates, and add the same song twice once both resolved.
      void extendQueueWithRadio(song);
    },
    [advanceOnEnded, recordHistory, jamRole, jamRoomId, jamClientId],
  );

  // Without this, a failed load (bad connection, yt-dlp/backend error, or a slow-network
  // timeout — the exact "internet jelek, lagunya cuma loading" case) just left the
  // buffering spinner disappear with zero explanation. Deliberately watches
  // usePlayerStore's error (not engineState.error / AudioEngine's own snapshot): the
  // timeout path never touches AudioEngine's snapshot at all — it only ever reaches
  // the user through the setPlaybackStatus call in the catch() above — so that's the
  // one field guaranteed to carry every failure mode, not just element-level ones.
  useEffect(() => {
    if (!playerError || !currentSong) return;
    const songToRetry = currentSong;
    showToast(playerError, {
      type: 'error',
      action: {
        label: 'Coba lagi',
        onClick: () => {
          audioEngine.loadTrack(songToRetry, { dataSaver, autoplay: true }).catch(() => {
            setPlaybackStatus({ isPlaying: false, isBuffering: false, error: 'Gagal memutar lagu ini.' });
          });
        },
      },
    });

    // A track that fails outright (bad connection, backend hiccup, timeout) used to
    // just sit there dead after the toast — nothing ever moved the queue on. Now it
    // auto-skips like every other streaming app does when a track can't play, capped
    // at MAX_CONSECUTIVE_AUTO_SKIP so a genuine total outage doesn't rapid-fire
    // through the whole queue instead of just failing visibly once.
    if (consecutiveErrorsRef.current < MAX_CONSECUTIVE_AUTO_SKIP) {
      consecutiveErrorsRef.current += 1;
      runCompletionAdvance(songToRetry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerError]);

  useEffect(() => {
    if (!currentSong) return;
    const upcoming = peekUpcoming(PREFETCH_LOOKAHEAD).filter((song) => song.id !== currentSong.id);
    const quality = dataSaver ? 'low' : 'high';
    const [nextUp, ...furtherOut] = upcoming;
    if (nextUp) prefetchAudioFull(nextUp.id, quality);
    for (const song of furtherOut) prefetchAudioResolveOnly(song.id, quality);
    // Re-runs whenever the current track (or the queue shape around it) changes — reorders,
    // additions from search, radio auto-extend, a Jam edit from someone else — so the
    // upcoming tracks being kept warm always match whatever's actually coming next.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id, order, position, repeatMode, dataSaver]);

  useEffect(() => {
    setPlaybackStatus({
      isPlaying: engineState.status === 'playing',
      isBuffering: engineState.status === 'loading',
      error: engineState.error,
    });
    // A successful load resets the failure streak — only *consecutive* failures should count.
    if (engineState.status === 'playing') consecutiveErrorsRef.current = 0;
  }, [engineState.status, engineState.error, setPlaybackStatus]);

  useEffect(() => {
    if (engineState.status !== 'playing' || !currentSong) return;
    const song = currentSong;
    let lastTime = audioEngine.getCurrentTime();
    let stalledSinceMs: number | null = null;
    let silentSinceMs: number | null = null;

    const intervalId = setInterval(() => {
      const time = audioEngine.getCurrentTime();

      // PRIMARY completion signal: currentTime has reached the song's own published
      // duration — trusted over the native 'ended' event or the browser's own internal
      // notion of "done". Confirmed by directly reading raw <audio> element values on a
      // real affected device (a temporary debug overlay) that iOS WebKit can badly
      // miscalculate a progressively-streamed MP4/M4A file's OWN duration — one measured
      // case had element.duration at EXACTLY 2x the track's real length. Since 'ended'
      // only fires once the browser reaches its OWN (wrong) internal duration, waiting
      // for it meant a genuinely-finished, already-silent track kept "playing" for up to
      // that same wrong multiple of its real length before ever advancing — this is what
      // used to show the seek bar still climbing minutes past a song that had already
      // ended. Reacting the instant currentTime crosses the verified-accurate metadata
      // duration, independent of whatever the browser itself believes, is what actually
      // closes that gap. Every watchdog below is for a genuinely different failure (stuck
      // mid-song, well before ever reaching this point).
      if (song.duration > 0 && time >= song.duration) {
        completedRef.current = true;
        runCompletionAdvance(song);
        return;
      }

      // AudioContext silent while we still think we're playing (sound genuinely not
      // reaching the speakers, mid-song) — see isAudioSilentWhilePlaying()'s own comment.
      if (audioEngine.isAudioSilentWhilePlaying()) {
        silentSinceMs ??= Date.now();
        if (Date.now() - silentSinceMs >= SILENT_PLAYBACK_GRACE_MS) {
          runCompletionAdvance(song);
          return;
        }
      } else {
        silentSinceMs = null;
      }

      const duration = audioEngine.getDuration();
      const nearEnd = duration > 0 && time / duration >= COMPLETION_THRESHOLD;
      if (nearEnd) completedRef.current = true;

      if (time !== lastTime) {
        lastTime = time;
        stalledSinceMs = null;
        return;
      }
      // currentTime frozen mid-song, before ever reaching song.duration above — a real
      // network stall already flips engineState.status to 'loading' (see the 'waiting'
      // element event), which tears this effect down via the guard above; a freeze that
      // happens while status still reads 'playing' is the genuinely-stuck case.
      if (!nearEnd) return;
      stalledSinceMs ??= Date.now();
      if (Date.now() - stalledSinceMs >= STALL_GRACE_MS) {
        runCompletionAdvance(song);
      }
    }, COMPLETION_POLL_MS);
    return () => clearInterval(intervalId);
  }, [engineState.status, currentSong, runCompletionAdvance]);

  useEffect(() => {
    if (engineState.status !== 'ended' || !currentSong) return;
    runCompletionAdvance(currentSong);
  }, [engineState.status, currentSong, runCompletionAdvance]);

  // Keeps a radio-style queue flowing continuously — like Spotify/Apple Music's
  // autoplay — instead of it ever visibly running low and then stopping. Seeded
  // from the *last* song already in the queue (not the currently playing one),
  // so each extension continues the thread the queue was already following
  // rather than resetting the "similar to" anchor back to whatever's live now.
  useEffect(() => {
    // In a Jam, only the room's creator auto-extends the shared queue — purely
    // to avoid several devices independently topping it up with different
    // filler songs at once. Doesn't restrict anyone's actual control rights.
    if (jamRole !== 'solo' && !jamIsCreator) return;
    if (order.length === 0) return;
    const remaining = order.length - position - 1;
    if (remaining > EXTEND_QUEUE_THRESHOLD) return;

    const lastQueueIndex = order[order.length - 1];
    const seedSong = queue[lastQueueIndex];
    if (!seedSong) return;

    void extendQueueWithRadio(seedSong);
  }, [order, position, queue, jamRole, jamIsCreator]);

  // Jam mode: keep this device's actual play/pause state matched to the room's
  // last-known transport state (arrives via useJamSync -> jamStore.playbackMeta).
  // Solo mode never sets playbackMeta, so this is a no-op there.
  useEffect(() => {
    if (jamRole === 'solo' || !jamPlaybackMeta) return;
    const isPlayingNow = engineState.status === 'playing';
    if (jamPlaybackMeta.isPlaying && !isPlayingNow && engineState.status !== 'loading') {
      audioEngine.play().catch(() => {
        // A play triggered by another participant's action, arriving over SSE,
        // has no user gesture behind it on this device — browsers block that
        // outright (the same class of restriction MediaSession's own unlock()
        // trick exists to work around, just with no gesture at all to lean on
        // here). Ask for one explicit tap instead of silently staying paused;
        // guarded so a still-blocked heartbeat doesn't reshow this every cycle.
        if (jamPlayPromptShownRef.current) return;
        jamPlayPromptShownRef.current = true;
        showToast('Ketuk untuk lanjutkan audio Jam.', {
          action: {
            label: 'Putar',
            onClick: () => {
              void audioEngine.unlock();
              audioEngine.play().catch(() => {});
            },
          },
        });
      });
    } else if (!jamPlaybackMeta.isPlaying && isPlayingNow) {
      audioEngine.pause();
    }
    if (isPlayingNow) jamPlayPromptShownRef.current = false;
  }, [jamRole, jamPlaybackMeta, engineState.status, showToast]);

  // Jam mode: periodic drift correction — projects the room's position forward
  // by local wall-clock time elapsed since the last broadcast (no cross-device
  // clock sync needed) and nudges this device back in line only past a
  // tolerance, to avoid constant audible micro-seeking.
  useEffect(() => {
    if (jamRole === 'solo') return;
    const intervalId = setInterval(() => {
      const meta = useJamStore.getState().playbackMeta;
      if (!meta) return;
      const elapsedSec = meta.isPlaying ? (Date.now() - meta.lastUpdatedAtMs) / 1000 : 0;
      const projected = meta.positionSec + elapsedSec;
      const drift = Math.abs(audioEngine.getCurrentTime() - projected);
      if (drift > JAM_DRIFT_THRESHOLD_SEC) audioEngine.seek(projected);
    }, JAM_DRIFT_CHECK_MS);
    return () => clearInterval(intervalId);
  }, [jamRole]);

  const handlePlay = useCallback(() => {
    if (jamRole !== 'solo' && jamRoomId) {
      void sendJamIntent(jamRoomId, jamClientId, 'play');
      return;
    }
    audioEngine.play().catch(() => {
      setPlaybackStatus({ isPlaying: false, isBuffering: false, error: 'Gagal memutar lagu ini.' });
    });
  }, [setPlaybackStatus, jamRole, jamRoomId, jamClientId]);
  const handlePause = useCallback(() => {
    if (jamRole !== 'solo' && jamRoomId) {
      void sendJamIntent(jamRoomId, jamClientId, 'pause');
      return;
    }
    audioEngine.pause();
  }, [jamRole, jamRoomId, jamClientId]);
  const handleTogglePlay = useCallback(() => {
    if (jamRole !== 'solo' && jamRoomId) {
      void sendJamIntent(jamRoomId, jamClientId, 'toggle-play');
      return;
    }
    audioEngine.togglePlay();
  }, [jamRole, jamRoomId, jamClientId]);
  const handleNext = useCallback(() => {
    if (jamRole !== 'solo' && jamRoomId) {
      void sendJamIntent(jamRoomId, jamClientId, 'next');
      return;
    }
    next();
  }, [next, jamRole, jamRoomId, jamClientId]);
  const handlePrevious = useCallback(() => {
    const restartInstead = audioEngine.getCurrentTime() > RESTART_FROM_BEGINNING_THRESHOLD_SEC;
    if (jamRole !== 'solo' && jamRoomId) {
      if (restartInstead) {
        void sendJamIntent(jamRoomId, jamClientId, 'seek', { positionSec: 0 });
      } else {
        void sendJamIntent(jamRoomId, jamClientId, 'previous');
      }
      return;
    }
    if (restartInstead) {
      audioEngine.seek(0);
      return;
    }
    previous();
  }, [previous, jamRole, jamRoomId, jamClientId]);
  const handleSeek = useCallback(
    (timeSec: number) => {
      if (jamRole !== 'solo' && jamRoomId) {
        void sendJamIntent(jamRoomId, jamClientId, 'seek', { positionSec: timeSec });
        return;
      }
      audioEngine.seek(timeSec);
    },
    [jamRole, jamRoomId, jamClientId],
  );

  useMediaSession({
    song: currentSong,
    // 'loading' counts as "playing" here on purpose — every normal skip/crossfade now
    // passes through it (AudioEngine.crossfadeTo sets it immediately, see there), and
    // that's still squarely within the user's intent to keep playing, not a pause. The
    // lock-screen icon flipping to "paused" for that brief buffering window on every
    // single track change was exactly the "gak sinkron" the icon-mismatch reports were
    // about — treating loading as playing here is what a native player's lock-screen
    // widget does too, since intent and the button state are what matters, not the raw
    // buffer status other UI (the spinner) still keys off of unmodified.
    isPlaying: engineState.status === 'playing' || engineState.status === 'loading',
    onPlay: handlePlay,
    onPause: handlePause,
    onNext: handleNext,
    onPrevious: handlePrevious,
    onSeek: handleSeek,
  });

  return {
    currentSong,
    playbackState: engineState,
    repeatMode,
    shuffle,
    handlePlay,
    handlePause,
    handleTogglePlay,
    handleNext,
    handlePrevious,
    handleSeek,
  };
}
