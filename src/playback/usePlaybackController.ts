import { useCallback, useEffect, useRef } from 'react';
import type { Song } from '../api/types';
import { cacheSongs } from '../api/songCache';
import { prefetchAudioResolveOnly } from '../api/musicClient';
import { audioEngine } from '../audio-engine/AudioEngine';
import { AudioCache } from '../audio-engine/AudioCache';
import { useAudioEngine } from '../audio-engine/useAudioEngine';
import { useToast } from '../components/Toast/ToastProvider';
import { sendJamIntent } from '../jam/jamClient';
import { canSyncToRoom, catchUpTarget, isLoadStillCurrent } from '../jam/jamPlaybackGuards';
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
// How long a track that's ALREADY been playing can sit rebuffering (status
// 'loading' again, not the initial load) before we treat it as a bad-connection
// stall and drop to low quality from the same position — see
// AudioEngine.reloadAtLowerQuality(). Long enough that a brief, normal rebuffer
// blip doesn't trigger a quality drop for no reason; short enough that someone
// on a genuinely struggling connection isn't left staring at a spinner for
// nearly as long as the original ~10-20s cold-resolve problem this exists to
// avoid recreating mid-song.
const REBUFFER_QUALITY_DROP_MS = 5000;
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
// In a Jam, when the room's song changes again this soon after the previous change, wait this long (~0.45s) for things to
// settle before starting the load: a host skipping through the queue used to make every follower start (and abandon)
// a load — and a backend resolve — for each song skipped past, only the last of which anyone hears.
const JAM_RAPID_CHANGE_WINDOW_MS = 700;
const JAM_COALESCE_MS = 450;
// Short enough to feel instant ("langsung play"), just long enough to avoid
// an audible click between tracks — no longer user-configurable.
const TRANSITION_FADE_SEC = 0.35;
// Once the queue is down to this many unplayed tracks, top it back up — keeps a
// radio-style queue flowing continuously (like any other streaming app) instead
// of ever visibly running out and stopping.
const EXTEND_QUEUE_THRESHOLD = 3;
// How many upcoming tracks to keep warm. Every one of them costs the backend a
// yt-dlp resolve (and, where the browser can hold blobs, a whole-file download) on
// a 1-vCPU VM, so this stays small: the next track is what matters, a second one is
// cheap insurance against a quick double-skip.
const PREFETCH_LOOKAHEAD = 2;
// Background warm-up only starts once the current track has been audibly playing for
// this long. It used to fire the instant the queue changed — i.e. at the exact moment
// the user had just tapped a song and was waiting on the backend, so the lookahead
// resolves queued up right beside (and delayed) the one that mattered.
const PREFETCH_SETTLE_MS = 1500;

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
  // True until the song-load effect below has run once — the run that sees whatever the previous session left in the queue.
  const firstLoadRunRef = useRef(true);
  const completedRef = useRef(false);
  // Guards against advancing twice for the same song — the stall watchdog and a
  // (possibly late) native 'ended' event could otherwise both fire for it.
  const advancedForSongIdRef = useRef<string | null>(null);
  const consecutiveErrorsRef = useRef(0);
  // The one song id that has already had its quiet automatic retry (see the error effect).
  const retriedSongIdRef = useRef<string | null>(null);
  const retryPendingRef = useRef(false);
  // Tracks which song id has already reached 'playing' at least once, and which
  // song id has already had its one allowed quality-drop attempt — both reset
  // implicitly by comparing against currentSong.id, so a new track always gets
  // a clean slate. See the rebuffer-quality-drop effect below.
  const hasPlayedSongIdRef = useRef<string | null>(null);
  const qualityDroppedSongIdRef = useRef<string | null>(null);
  // Guards the "tap to resume audio" prompt below so a still-blocked remote
  // play doesn't spam a fresh toast every time a heartbeat re-evaluates it.
  const jamPlayPromptShownRef = useRef(false);
  // Bumped every time a new track load begins. A load that was overtaken by a newer one still resolves normally, so its
  // completion handler compares against this before doing anything (seeking, reporting an error).
  const loadGenerationRef = useRef(0);
  const lastSongChangeAtRef = useRef(0);
  // Tracks how many upcoming songs should be forced into low quality (Data Saver)
  // after a network timeout or rebuffer to prevent consecutive failures.
  const autoDataSaverTracksRemainingRef = useRef(0);

  useEffect(() => {
    audioEngine.setVolume(volume);
  }, [volume]);

  // Off the tap path: see AudioEngine.prepare() for why building the graph on the first
  // tap made the first song of a session start late. Deferred a moment so it never
  // competes with the app's own first paint.
  useEffect(() => {
    const timeoutId = setTimeout(() => audioEngine.prepare(), 500);
    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const isFirstRun = firstLoadRunRef.current;
    firstLoadRunRef.current = false;
    if (!currentSong) {
      loadedSongIdRef.current = null;
      setCurrentSongId(null);
      return;
    }
    if (loadedSongIdRef.current === currentSong.id) return;

    // The queue is persisted, so opening or refreshing the app finds last session's song here. It is shown, paused —
    // not loaded: no audio starts by itself and the server is not asked to resolve a song nobody chose this time. The
    // first play (see AudioEngine.deferStart) loads it; picking anything else discards it. Jam keeps its own flow.
    if (isFirstRun && useJamStore.getState().role === 'solo') {
      const restored = currentSong;
      setCurrentSongId(restored.id);
      cacheSongs([restored]);
      audioEngine.deferStart(() => {
        // From here on it is an ordinary loaded track, so the next change crossfades instead of loading from idle.
        loadedSongIdRef.current = restored.id;
        return audioEngine.loadTrack(restored, {
          dataSaver: useSettingsStore.getState().dataSaver || autoDataSaverTracksRemainingRef.current > 0,
          autoplay: true,
          fadeInSec: 0.6,
        });
      });
      return;
    }

    const wasIdle = loadedSongIdRef.current === null;
    const previouslyLoadedId = loadedSongIdRef.current;
    loadedSongIdRef.current = currentSong.id;
    completedRef.current = false;
    advancedForSongIdRef.current = null;
    setCurrentSongId(currentSong.id);
    cacheSongs([currentSong]);

    const song = currentSong;
    const generation = ++loadGenerationRef.current;
    const changedAt = Date.now();
    const isRapidJamChange =
      useJamStore.getState().role !== 'solo' && !wasIdle && changedAt - lastSongChangeAtRef.current < JAM_RAPID_CHANGE_WINDOW_MS;
    lastSongChangeAtRef.current = changedAt;

    const startLoad = () => {
      // In solo mode always autoplay (existing behavior, unchanged). In a Jam,
      // the very first track loaded from idle should only autoplay if the
      // room's canonical state already says something's playing — otherwise a
      // song added to an empty shared queue would audibly blip into playback
      // for an instant before the play/pause-sync effect below corrects it back
      // to paused.
      const jamStateAtLoad = useJamStore.getState();
      const shouldAutoplay = jamStateAtLoad.role === 'solo' ? true : (jamStateAtLoad.playbackMeta?.isPlaying ?? true);

      const effectiveDataSaver = dataSaver || autoDataSaverTracksRemainingRef.current > 0;

      // No timeout-triggered quality fallback on purpose. A slow *start* is almost always
      // the backend resolving a track it hasn't seen yet (or waiting its turn behind
      // another resolve), not a lack of bandwidth — 'low' is a separate cache entry that
      // needs its own fresh resolve, queued behind the one still running, so switching
      // to it made the wait longer, not shorter. Real bandwidth problems are handled
      // where they actually show up: a rebuffer mid-song (see the effect further down).
      const action = wasIdle
        ? audioEngine.loadTrack(song, { dataSaver: effectiveDataSaver, autoplay: shouldAutoplay, fadeInSec: 0.6 })
        : audioEngine.crossfadeTo(song, TRANSITION_FADE_SEC, { dataSaver: effectiveDataSaver });

      action
        .then(() => {
          // A newer load began meanwhile: this one was abandoned (it resolves normally when overtaken), and the audio
          // element that is audible now may still be the OLD track — seeking it would replay a skipped song.
          if (generation !== loadGenerationRef.current) return;
          // loadTrack/crossfadeTo always start at position 0 — a Jam participant
          // joining mid-song (or resyncing after a reconnect) needs an explicit
          // catch-up seek to the room's last-known position.
          const jamState = useJamStore.getState();
          if (jamState.role === 'solo') return;
          const meta = jamState.playbackMeta;
          if (!meta) return;
          if (!isLoadStillCurrent(song.id, audioEngine.getCurrentSong()?.id ?? null, useQueueStore.getState().currentSong()?.id ?? null)) return;
          const target = catchUpTarget(meta, Date.now(), audioEngine.getCurrentTime(), JAM_DRIFT_THRESHOLD_SEC, song.duration);
          if (target !== null) audioEngine.seek(target);
        })
        .catch((error: unknown) => {
          // Nobody is waiting on a load that was abandoned for a newer one — its failure is not this track's error.
          if (generation !== loadGenerationRef.current) return;
          const timedOut = error instanceof Error && error.message.includes('Timed out');
          setPlaybackStatus({
            isPlaying: false,
            isBuffering: false,
            error: timedOut ? 'Koneksi lambat — lagu gagal dimuat.' : 'Gagal memutar lagu ini.',
          });
        });
    };

    if (!isRapidJamChange) {
      startLoad();
      return;
    }
    // The room changed song again right after the last change (a host skipping): let it settle, then load only the
    // song it settles on. The display already shows the new song; only the audio waits (~0.45s).
    let started = false;
    const timerId = setTimeout(() => {
      started = true;
      startLoad();
    }, JAM_COALESCE_MS);
    return () => {
      clearTimeout(timerId);
      // A load that never started must not be remembered as loaded (a re-run of this effect for the same song —
      // React's dev double-invoke — would otherwise skip it forever).
      if (!started) loadedSongIdRef.current = previouslyLoadedId;
    };
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

      if (autoDataSaverTracksRemainingRef.current > 0) {
        autoDataSaverTracksRemainingRef.current -= 1;
      }

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
    const isTimeout = playerError.includes('Koneksi lambat');

    // A failure that isn't a timeout (the element errored, the backend answered 502, the
    // connection dropped mid-file) is very often transient — retry the same track once,
    // quietly, before bothering the user or touching the queue.
    //
    // One failure reports itself twice with two different messages (the element's own
    // 'error' event, then loadTrack's rejection), so this effect runs twice for it: the
    // timer must not be tied to the effect (its cleanup would cancel the retry on the
    // second run), and the duplicate must be ignored while a retry is pending.
    if (!isTimeout && retriedSongIdRef.current !== songToRetry.id) {
      retriedSongIdRef.current = songToRetry.id;
      retryPendingRef.current = true;
      setTimeout(() => {
        retryPendingRef.current = false;
        if (loadedSongIdRef.current !== songToRetry.id) return; // the user moved on to something else
        audioEngine.loadTrack(songToRetry, { dataSaver, autoplay: true }).catch(() => {
          setPlaybackStatus({ isPlaying: false, isBuffering: false, error: 'Gagal memutar lagu ini.' });
        });
      }, 800);
      return;
    }
    if (retryPendingRef.current) return;

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

    // A timeout never skips: it says something about this connection, not about the track,
    // and the next track would just hit the same wall — that is how a slow start turned
    // into the queue racing through three songs, none of them ever playing. The toast
    // offers a retry instead.
    if (isTimeout) return;

    // A track that fails outright (even after the quiet retry above) used to just sit
    // there dead after the toast — nothing ever moved the queue on. Now it auto-skips
    // like every other streaming app does when a track can't play, capped at
    // MAX_CONSECUTIVE_AUTO_SKIP so a genuine total outage doesn't rapid-fire through the
    // whole queue instead of just failing visibly once.
    if (consecutiveErrorsRef.current < MAX_CONSECUTIVE_AUTO_SKIP) {
      consecutiveErrorsRef.current += 1;
      // In a Jam an advance moves the queue for the whole room, so one member's bad
      // connection must never trigger it. A track that is genuinely broken fails for
      // everyone though, and would otherwise wedge the room forever — so the creator
      // alone (the server dedupes by song id) skips it.
      if (jamRole === 'solo' || jamIsCreator) {
        runCompletionAdvance(songToRetry);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerError, jamRole, jamIsCreator]);

  // Lookahead warm-up. Deliberately waits for the current track to be *playing* (see
  // PREFETCH_SETTLE_MS) and re-arms whenever the queue shape around it changes —
  // reorders, additions from search, radio auto-extend, a Jam edit from someone else —
  // so what's kept warm always matches whatever is actually coming next.
  //
  // Two different mechanisms, because the platforms differ:
  //  - browsers that can play a blob: URL (desktop/Android): download the next tracks
  //    into IndexedDB, one at a time, and only then point the spare <audio> element at
  //    the stored blob — the next track then starts with zero network.
  //  - iOS: blob: playback is unreliable there (see AudioCache), so the spare element
  //    natively preloads the next track over the network and only the tracks after it
  //    get the cheap resolve-only warm-up.
  // The *current* track is never prefetched: its own <audio> element is already
  // downloading it, and a second full download of the same file just doubled the load.
  const isPlaying = engineState.status === 'playing';
  useEffect(() => {
    if (!currentSong || !isPlaying) return;
    const timeoutId = setTimeout(() => {
      const preferLow = dataSaver || autoDataSaverTracksRemainingRef.current > 0;
      const upcoming = peekUpcoming(PREFETCH_LOOKAHEAD).filter((song) => song.id !== currentSong.id);
      const [nextUp, ...later] = upcoming;
      if (!nextUp) return;

      AudioCache.prefetchTracks(
        // Data Saver users opted out of spending data on tracks they may never hear.
        (preferLow ? [nextUp] : upcoming).map((song) => song.id),
        preferLow,
      );
      if (AudioCache.isSupported) {
        void AudioCache.prefetchAndCache(nextUp.id, preferLow).then(() => audioEngine.preloadNextTrack(nextUp, preferLow));
      } else {
        void audioEngine.preloadNextTrack(nextUp, preferLow);
        for (const song of later) prefetchAudioResolveOnly(song.id, preferLow ? 'low' : 'high');
      }
    }, PREFETCH_SETTLE_MS);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id, isPlaying, order, position, repeatMode, dataSaver]);

  useEffect(() => {
    setPlaybackStatus({
      isPlaying: engineState.status === 'playing',
      isBuffering: engineState.status === 'loading',
      error: engineState.error,
    });
    // A successful load resets the failure streak — only *consecutive* failures should count.
    if (engineState.status === 'playing') {
      consecutiveErrorsRef.current = 0;
      retriedSongIdRef.current = null;
    }
    if (engineState.status === 'playing' && currentSong) hasPlayedSongIdRef.current = currentSong.id;
  }, [engineState.status, engineState.error, currentSong, setPlaybackStatus]);

  // Mid-song rebuffer on a bad connection: status flips back to 'loading' (the
  // <audio> element's native 'waiting' event, see AudioEngine.bindElementEvents)
  // for a track that's already played at least once — as opposed to the very
  // same 'loading' status a track's *initial* load also reports, which
  // hasPlayedSongIdRef guards against reacting to here. Waits
  // REBUFFER_QUALITY_DROP_MS before acting so a normal brief stall doesn't
  // trigger it, and only ever fires once per song (qualityDroppedSongIdRef) —
  // if it's still struggling at low quality, there's nothing lower left to
  // fall back to, so the existing stall/error watchdogs take over as before.
  useEffect(() => {
    if (engineState.status !== 'loading' || !currentSong) return;
    if (hasPlayedSongIdRef.current !== currentSong.id) return;
    if (qualityDroppedSongIdRef.current === currentSong.id) return;
    if (dataSaver) return; // already the lowest tier — nothing left to drop to.

    const timeoutId = setTimeout(() => {
      qualityDroppedSongIdRef.current = currentSong.id;
      autoDataSaverTracksRemainingRef.current = 2; // start probation for upcoming tracks
      audioEngine.reloadAtLowerQuality().catch(() => {
        // Best-effort recovery — if it fails, the existing stall/error watchdogs
        // above still apply exactly as if this attempt had never happened.
      });
    }, REBUFFER_QUALITY_DROP_MS);
    return () => clearTimeout(timeoutId);
  }, [engineState.status, currentSong, dataSaver]);

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
    if (audioEngine.getCurrentSong()?.id !== currentSong.id) return;
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
      // Only a track that is settled and is the room's current one may be nudged. During a transition the audible track
      // is the previous one, and "where the room is" is a position in the NEW track — seeking the old one there replays
      // the start of a song that has already been skipped.
      const engineSong = audioEngine.getCurrentSong();
      const roomSong = useQueueStore.getState().currentSong();
      if (!canSyncToRoom(engineSong?.id ?? null, roomSong?.id ?? null, audioEngine.getSnapshot().status)) return;
      const target = catchUpTarget(meta, Date.now(), audioEngine.getCurrentTime(), JAM_DRIFT_THRESHOLD_SEC, roomSong?.duration ?? 0);
      if (target !== null) audioEngine.seek(target);
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
