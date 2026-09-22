import type { Song } from '../api/types';
import { downloadManager } from '../downloads/downloadManager';
import { useSettingsStore } from '../stores/settingsStore';
import { resolveAudioUrl } from './bitrateResolver';
import { beginTrace, finishTrace, markTrace } from '../diagnostics/loadTraces';
import { AudioCache } from './AudioCache';
import { scheduleFadeIn, scheduleFadeOut, scheduleFadeTo, setGainImmediate } from './crossfade';
import type { AudioEngineListener, LoadTrackOptions, PlaybackState } from './types';
import { AudioEngineError } from './types';

/**
 * A locally stored blob: URL to play `songId` from instead of hitting the network — a deliberate offline
 * download (checked first, and trusted even if local playback has looked flaky lately, since offline it's
 * the only copy that exists at all) or AudioCache's own opportunistic cache (which already gates itself on
 * the same "has this device proven blob: audio unreliable?" flag — see settingsStore.localAudioEnabled).
 * Null means "resolve the network URL instead."
 */
async function localUrlFor(songId: string, dataSaver: boolean): Promise<string | null> {
  const downloaded = await downloadManager.getBlobUrl(songId);
  if (downloaded) {
    if (useSettingsStore.getState().localAudioEnabled || !navigator.onLine) return downloaded;
    URL.revokeObjectURL(downloaded); // network works fine and blob playback has looked flaky lately — skip it
  }
  return AudioCache.get(songId, dataSaver);
}

const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Deliberately longer than the backend's own worst case (a 25s yt-dlp resolve timeout,
// see server/src/youtube/stream.ts): giving up on the client before the server does
// only abandons a resolve that was about to succeed. A slow-but-working load should
// keep spinning; only a genuinely dead one should ever hit this.
const CANPLAY_TIMEOUT_MS = 30000;

// How long pause/resume take to ramp the output, in seconds. Stopping an <audio>
// element mid-waveform can leave an audible click; ~90ms is below what reads as a
// delay but enough to land the ramp on silence. Only where a GainNode exists (not iOS,
// which bypasses Web Audio entirely — see ensureGraph).
const PAUSE_FADE_SEC = 0.09;
const RESUME_FADE_SEC = 0.06;

// HTMLMediaElement.HAVE_FUTURE_DATA — enough buffered to start playing.
const HAVE_FUTURE_DATA = 3;

function waitForEvent(target: HTMLMediaElement, event: 'canplay', timeoutMs: number): Promise<void> {
  // A track natively preloaded into the spare element (preloadNextTrack) has usually
  // already fired its one 'canplay' by the time it's swapped in — waiting for another
  // would just sit there until the timeout, turning an instant "next" into a stall.
  // (load() resets readyState to 0 synchronously, so this can't be a stale value from
  // a previous src.)
  if (target.readyState >= HAVE_FUTURE_DATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const onEvent = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new AudioEngineError('Failed to load audio source.'));
    };
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new AudioEngineError('Timed out waiting for audio to become playable.'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeoutId);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

/**
 * Singleton owner of the app's single AudioContext and its Web Audio graph.
 *
 * Graph: two parallel chains (audio element A/B) so a currently-playing track
 * and a newly-loading one can briefly overlap during crossfadeTo():
 *   <audio> A -> MediaElementAudioSourceNode -> GainNode A -\
 *                                                             -> destination
 *   <audio> B -> MediaElementAudioSourceNode -> GainNode B -/
 *
 * Per-frame data (current time) is read directly by callers via
 * getCurrentTime() — subscribe() only fires on coarse state transitions,
 * never on a timer, so consumers driving a seek bar do so through frameTicker
 * instead of triggering React re-renders every frame.
 */
class AudioEngine {
  private static instance: AudioEngine | null = null;

  private context: AudioContext | null = null;
  private elements: [HTMLAudioElement, HTMLAudioElement] | null = null;
  private gains: [GainNode | null, GainNode | null] | null = null;
  private activeIndex: 0 | 1 = 0;
  private volume = 1;
  /**
   * A track that is on screen but has deliberately not been loaded yet — the last song of the previous session, shown
   * paused when the app opens. The first play() (button, lock screen, another device, Jam) runs it; loading anything
   * else first discards it. Keeps a refresh from starting audio by itself or asking the server to resolve a song nobody
   * asked for.
   */
  private deferredStart: (() => Promise<void>) | null = null;
  private currentSong: Song | null = null;
  private preloadedUrl: string | null = null;
  /**
   * Which track the spare element was last pointed at by preloadNextTrack(). Identified
   * by song + quality rather than by URL: for a track stored in IndexedDB every
   * AudioCache.get() mints a *new* blob: URL, so a URL comparison never recognised the
   * element it had just preloaded and the "next" track was needlessly loaded again.
   */
  private preloaded: { songId: string; dataSaver: boolean } | null = null;
  private crossfadeTimeoutId: ReturnType<typeof setTimeout> | null = null;
  /**
   * Bumped by every loadTrack()/crossfadeTo() call and captured as `requestId`
   * at the start of each — checked again after every `await` before touching
   * shared state (activeIndex, gain nodes, scheduled fades/cleanup). Without
   * this, rapid repeated skips each started their own crossfade against the
   * *same* incoming element (since `this.activeIndex` hadn't been updated yet
   * by the still-in-flight earlier call), and every one of them raced to
   * completion — the loser could still schedule a fade-in and mark itself
   * "playing" moments after the winner already had, leaving two elements
   * audibly playing at once with neither ever cleanly stopped. A call that
   * finds its requestId stale simply bails out — the newest call is always
   * the sole authority over playback state.
   */
  private playRequestId = 0;
  /**
   * How many loadTrack()/crossfadeTo() calls are in flight. Both of them own the spare
   * <audio> element while they run (crossfadeTo loads the incoming track into it), and
   * preloadNextTrack() targets that very same element — so it must never touch it in
   * the middle of a transition, or it can overwrite the song the user just tapped with
   * the one queued after it.
   */
  private transitionsInFlight = 0;
  private pauseTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private listeners = new Set<AudioEngineListener>();
  private snapshot: PlaybackState = { status: 'idle', duration: 0, error: null };
  private lifecycleRecoveryBound = false;
  private elementsPrimed = false;

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) AudioEngine.instance = new AudioEngine();
    return AudioEngine.instance;
  }

  private constructor() {}

  private ensureGraph(): { context: AudioContext | null; elements: [HTMLAudioElement, HTMLAudioElement]; gains: [GainNode | null, GainNode | null] } {
    if (this.elements && this.gains) {
      return { context: this.context, elements: this.elements, gains: this.gains };
    }

    const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // iOS WebKit has severe bugs with MediaElementAudioSourceNode (silences audio
    // randomly in background, breaks on screen lock). We bypass Web Audio API completely
    // on iOS and just use raw <audio> tags. Crossfading degrades to hard cuts, but
    // background playback becomes perfectly stable.
    const context = isIOS ? null : new AudioContextCtor();

    const makeChain = (): { element: HTMLAudioElement; gain: GainNode | null } => {
      const element = new Audio();
      element.preload = 'auto';
      element.crossOrigin = 'anonymous';
      element.setAttribute('playsinline', 'true');
      element.setAttribute('webkit-playsinline', 'true');
      // iOS Safari — especially in a standalone (Add to Home Screen) PWA — has a
      // long-standing WebKit bug where a MediaElementAudioSourceNode built from an
      // <audio> element that was never attached to the DOM produces total silence:
      // currentTime keeps advancing and the element reports "playing", but nothing
      // reaches the speakers. Keeping the element attached (off-screen, never
      // display:none — that alone can make Safari pause it) is the standing
      // workaround. Desktop/Android are unaffected either way.
      element.style.position = 'fixed';
      element.style.width = '0';
      element.style.height = '0';
      element.style.opacity = '0';
      element.style.pointerEvents = 'none';
      if (typeof document !== 'undefined') {
        document.body.appendChild(element);
      }

      if (!context) return { element, gain: null };

      const source = context.createMediaElementSource(element);
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(context.destination);
      return { element, gain };
    };

    const chainA = makeChain();
    const chainB = makeChain();

    this.context = context;
    this.elements = [chainA.element, chainB.element];
    this.gains = [chainA.gain, chainB.gain];

    AudioCache.warm();
    this.bindElementEvents(0, chainA.element);
    this.bindElementEvents(1, chainB.element);
    if (context) this.bindLifecycleRecovery(context);

    return { context, elements: this.elements, gains: this.gains };
  }

  /**
   * Mobile browsers (esp. Android Chrome) routinely suspend the AudioContext
   * when the screen locks or the tab is backgrounded — the <audio> element
   * keeps advancing currentTime and reports "playing", but the Web Audio graph
   * produces silence until context.resume() is called again. Nothing else in
   * the app calls resume() outside of user-gesture entry points, so without
   * this the track goes silent on screen-lock and never recovers on its own.
   * This only restarts the *graph*, never the element itself, so it can never
   * override a real user pause.
   */
  private bindLifecycleRecovery(context: AudioContext): void {
    if (this.lifecycleRecoveryBound) return;
    this.lifecycleRecoveryBound = true;

    // Tried debouncing this resume call (waiting ~400ms before resuming, to avoid
    // fighting iOS's own lock-screen suspend transition and the brief click that
    // caused) — made things measurably worse on a real device: instead of a
    // sub-second click, playback now had a full ~1s audible PAUSE on every lock
    // before continuing. Reverted to resuming immediately; the small click this
    // was meant to avoid is the lesser problem of the two.
    const resumeIfPlaying = () => {
      if (this.snapshot.status === 'playing' && context.state !== 'running') {
        context.resume().catch(() => {
          // Resume can be rejected outside a user gesture on some browsers — the
          // next play()/unlock() call (always gesture-bound) will retry.
        });
      }
    };

    context.addEventListener('statechange', resumeIfPlaying);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', resumeIfPlaying);
    }
  }

  private bindElementEvents(index: 0 | 1, element: HTMLAudioElement): void {
    const isActive = () => this.activeIndex === index;

    // Timeline for Settings -> Diagnostik. Deliberately NOT gated by isActive(): while a
    // track is being loaded into the spare element it isn't the active one yet.
    for (const stage of ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'error'] as const) {
      element.addEventListener(stage, () => markTrace(stage, element));
    }
    for (const starved of ['waiting', 'stalled'] as const) {
      element.addEventListener(starved, () => markTrace('waiting', element));
    }

    element.addEventListener('waiting', () => {
      if (!isActive()) return;
      this.updateSnapshot({ status: 'loading' });
    });
    element.addEventListener('playing', () => {
      if (!isActive()) return;
      this.updateSnapshot({ status: 'playing', error: null });
    });
    element.addEventListener('pause', () => {
      if (!isActive()) return;
      if (this.snapshot.status !== 'ended') this.updateSnapshot({ status: 'paused' });
    });
    element.addEventListener('ended', () => {
      if (!isActive()) return;
      // A crossfade already in flight (status 'loading') means this element is the OUTGOING
      // track of a transition already triggered for a different song — `isActive()` alone
      // doesn't catch this because activeIndex/currentSong only swap to the new track once its
      // own 'canplay'+play() resolves (crossfadeTo), which can take long enough for this old
      // element to reach its real end first. Reporting 'ended' here got read as "the NEW
      // current song just finished" by usePlaybackController's auto-advance effect, skipping
      // an extra song in the queue every time a song ended on its own instead of via a manual
      // next click (manual next tears the old element down before it can ever fire 'ended').
      if (this.snapshot.status === 'loading') return;
      this.updateSnapshot({ status: 'ended' });
    });
    element.addEventListener('error', () => {
      if (!isActive()) return;
      this.updateSnapshot({ status: 'error', error: 'Terjadi kesalahan saat memutar — sumber audio tidak tersedia.' });
    });
    element.addEventListener('loadedmetadata', () => {
      if (!isActive()) return;
      // Prefer the song's own published duration (from search/trending metadata) over the
      // browser's element.duration — see the note above updateSnapshot's duration writes in
      // loadTrack() for why the browser's own estimate can't be trusted here.
      this.updateSnapshot({ duration: this.currentSong?.duration || element.duration || this.snapshot.duration });
    });
  }

  private updateSnapshot(partial: Partial<PlaybackState>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  /**
   * Builds the audio graph (AudioContext, both <audio> elements) ahead of the first tap.
   * `new AudioContext()` opens the audio device, which was measured blocking the main
   * thread for ~1s on its first call — and it used to happen lazily inside the very first
   * click, so the first song of every session sat there doing nothing before it even
   * requested any audio. Creating it is allowed without a user gesture (it just starts out
   * 'suspended'; unlock() still resumes it inside the real tap), so this is safe to run
   * during idle time right after the app opens.
   */
  prepare(): void {
    this.ensureGraph();
  }

  /**
   * Must be called synchronously at the very top of the first play-button click
   * handler (iOS/Chrome autoplay policy).
   *
   * Also "primes" the INACTIVE crossfade element — iOS Safari tracks user-activation
   * per <audio> element: once .play() has been invoked on a given element inside a
   * real gesture (even if that call fails, e.g. because src is still empty here),
   * that SAME element is allowed to be started programmatically later, outside a
   * gesture. Without this, the second element — the one crossfadeTo() alternates
   * onto for every other skip — had never been played from within a gesture, so iOS
   * silently refused .play() on it when triggered from a MediaSession action handler
   * (a lock-screen next/previous tap), which is not always treated as a qualifying
   * gesture on its own. That silent refusal is what looked like "lock-screen skip
   * does nothing".
   *
   * Deliberately does NOT touch the currently-ACTIVE element (elements[activeIndex]):
   * that one is about to be gesture-activated anyway, by the real loadTrack() call
   * this same click triggers moments later (see playSongRadio/playSongList — unlock()
   * runs fire-and-forget, unawaited, immediately before the real song load). An
   * earlier version primed both elements unconditionally and tried to detect the
   * race with a src-unchanged check before cleaning up — that check wasn't reliable
   * enough: priming's own play()/pause()/load() sequence could still land on the
   * active element while the real load was setting it up, silently pausing playback
   * moments after it started ("klik lagu, play sebentar, lalu stop") — reproduced on
   * both mobile and desktop, not an iOS-only issue. Simply never touching the active
   * element removes the race entirely instead of trying to detect it after the fact.
   *
   * Only done once (elementsPrimed): the per-element activation this grants persists
   * for the element's lifetime, and unlock() itself is called on every single song
   * pick (see playSongRadio/playSongList).
   */
  async unlock(): Promise<void> {
    const { context, elements } = this.ensureGraph();
    if (context && context.state === 'suspended') {
      await context.resume();
    }
    if (this.elementsPrimed) return;
    this.elementsPrimed = true;
    const inactiveElement = elements[this.activeIndex === 0 ? 1 : 0];
    try {
      await inactiveElement.play();
    } catch {
      // Nothing to play yet (empty src) is the expected case here — the point of
      // this call was only to register user-activation on the element, not to
      // actually play anything.
    }
    inactiveElement.pause();
    inactiveElement.currentTime = 0;
  }

  /** See `deferredStart`. */
  deferStart(start: () => Promise<void>): void {
    this.deferredStart = start;
  }

  async loadTrack(song: Song, options: LoadTrackOptions = {}): Promise<void> {
    this.deferredStart = null;
    this.transitionsInFlight += 1;
    try {
      await this.loadTrackImpl(song, options);
    } catch (error) {
      finishTrace(error instanceof Error && error.message.includes('Timed out') ? 'timeout' : 'error');
      throw error;
    } finally {
      this.transitionsInFlight -= 1;
    }
  }

  private async loadTrackImpl(song: Song, options: LoadTrackOptions): Promise<void> {
    const requestId = ++this.playRequestId;
    this.cancelPendingPause();
    const { context, elements, gains } = this.ensureGraph();
    if (context && context.state === 'suspended') await context.resume();
    if (requestId !== this.playRequestId) return; // superseded while the context was resuming

    const dataSaver = options.dataSaver ?? false;
    const inactiveIndex = this.activeIndex === 0 ? 1 : 0;
    const usePreload = this.hasUsablePreload(song, dataSaver, elements[inactiveIndex]);
    const networkUrl = resolveAudioUrl(song.id, dataSaver);
    let url = '';
    if (!usePreload) {
      url = (await localUrlFor(song.id, dataSaver)) ?? networkUrl;
    }

    this.cancelPendingCrossfade();
    this.currentSong = song;
    const element = elements[this.activeIndex];
    const gain = gains[this.activeIndex];

    this.updateSnapshot({ status: 'loading', duration: song.duration, error: null });
    if (gain && context) {
      setGainImmediate(gain, context, options.fadeInSec ? 0 : this.volume);
    } else {
      element.volume = this.volume;
    }

    // If we've already natively preloaded this exact URL into the inactive element,
    // we should have theoretically swapped activeIndex and just played it (handled
    // via crossfadeTo usually). But if loadTrack is called instead, and we happen
    // to have it preloaded in the ACTIVE element (rare, but possible if preloadedUrl
    // matched and we swapped), we just play it.
    // However, preloadNextTrack explicitly preloads into the INACTIVE element.
    // So if it's in the inactive element, loadTrack should just swap.
    // Wait, loadTrack does a hard cut using the *currently active* element.
    // If it's preloaded in the inactive element, we should just use that element!
    if (usePreload) {
      const oldActiveIndex = this.activeIndex;
      this.activeIndex = inactiveIndex;
      this.preloadedUrl = null;
      this.preloaded = null;
      // We swapped elements. Stop the old one.
      elements[oldActiveIndex].pause();
      const oldSrc = elements[oldActiveIndex].src;
      elements[oldActiveIndex].removeAttribute('src');
      elements[oldActiveIndex].load();
      if (oldSrc.startsWith('blob:')) URL.revokeObjectURL(oldSrc);
      // Use the newly active one
      const newElement = elements[this.activeIndex];
      const newGain = gains[this.activeIndex];
      beginTrace(song, dataSaver ? 'low' : 'high', newElement, true);
      if (newGain && context) {
        setGainImmediate(newGain, context, options.fadeInSec ? 0 : this.volume);
      } else {
        newElement.volume = this.volume;
      }

      await this.waitWithBlobFallback(newElement, networkUrl, requestId);
      if (requestId !== this.playRequestId) return;
      this.updateSnapshot({ duration: song.duration || newElement.duration });
      
      if (options.autoplay !== false) {
        await newElement.play();
        if (requestId !== this.playRequestId) return;
        if (options.fadeInSec && newGain && context) {
          scheduleFadeIn(newGain, context, this.volume, options.fadeInSec);
        } else if (newGain && context) {
          setGainImmediate(newGain, context, this.volume);
        } else {
          newElement.volume = this.volume;
        }
      } else {
        this.updateSnapshot({ status: 'paused' });
      }
      return;
    }

    this.preloadedUrl = null;
    this.preloaded = null;
    beginTrace(song, dataSaver ? 'low' : 'high', element, false);
    const oldSrc = element.src;
    if (oldSrc.startsWith('blob:')) URL.revokeObjectURL(oldSrc);
    await this.loadElementWithFallback(element, url, networkUrl, requestId);
    if (requestId !== this.playRequestId) return; // a newer request claimed this element meanwhile

    // Deliberately song.duration first, not element.duration: browsers can badly
    // mis-estimate duration for a progressively range-requested MP4/M4A stream —
    // exactly what this app streams — when the container's duration metadata
    // isn't at the front of the file, sometimes overshooting by minutes. The
    // song's published duration (from search/trending metadata, describing the
    // very same video) is the trustworthy value; element.duration is only a
    // last-resort fallback when metadata itself is missing.
    this.updateSnapshot({ duration: song.duration || element.duration });

    if (options.autoplay !== false) {
      await element.play();
      if (requestId !== this.playRequestId) return;
      if (options.fadeInSec && gain && context) {
        scheduleFadeIn(gain, context, this.volume, options.fadeInSec);
      } else if (gain && context) {
        setGainImmediate(gain, context, this.volume);
      } else {
        element.volume = this.volume;
      }
    } else {
      // Without this, a track loaded with autoplay explicitly withheld (used
      // when a caller — currently only Jam sync, joining/receiving a track
      // change while the room itself isn't playing yet — wants it ready but
      // not sounding) left status stuck at 'loading' forever, since nothing
      // else in this method updates it when the play() branch above is
      // skipped. bindElementEvents' own 'pause'/'playing' listeners only fire
      // on actual play()/pause() calls, not on a load that never played.
      this.updateSnapshot({ status: 'paused' });
    }
  }

  /**
   * Emergency fallback for a mid-song rebuffer on a bad connection: reloads the
   * *currently playing* track at low quality (smaller/cheaper to buffer) from
   * wherever it stalled, instead of leaving the user stuck waiting on the
   * original high-quality stream. Deliberately reuses the same active element
   * rather than crossfading to the other one — this is a same-song emergency
   * recovery, not a track change, and reusing crossfadeTo's dual-element
   * machinery here would risk reintroducing the exact race conditions its own
   * comments describe fighting off. A brief silent gap during the reload is an
   * accepted trade — the alternative is staying stuck buffering indefinitely.
   * One-directional on purpose: never auto-upgrades back to high quality mid-
   * song, since seamlessly detecting "the connection recovered" and swapping
   * back without a glitch is a much harder problem than degrading once when
   * things are already visibly broken.
   */
  async reloadAtLowerQuality(): Promise<void> {
    const song = this.currentSong;
    if (!song || !this.elements) return;

    const requestId = ++this.playRequestId;
    const { context, elements, gains } = this.ensureGraph();
    const element = elements[this.activeIndex];
    const gain = gains[this.activeIndex];
    const resumeAt = element.currentTime;
    const wasPlaying = !element.paused;

    this.updateSnapshot({ status: 'loading' });
    const networkUrl = resolveAudioUrl(song.id, true);
    const url = (await localUrlFor(song.id, true)) ?? networkUrl;

    const oldSrc = element.src;
    if (oldSrc.startsWith('blob:')) URL.revokeObjectURL(oldSrc);
    await this.loadElementWithFallback(element, url, networkUrl, requestId);
    if (requestId !== this.playRequestId) return; // superseded by a real track change meanwhile

    element.currentTime = resumeAt;
    if (wasPlaying) {
      await element.play();
      if (requestId !== this.playRequestId) return;
      if (gain && context) {
        setGainImmediate(gain, context, this.volume);
      } else {
        element.volume = this.volume;
      }
    }
  }

  async play(): Promise<void> {
    if (this.deferredStart) {
      const start = this.deferredStart;
      this.deferredStart = null;
      // Same as every tap that starts a song: prime the elements inside this gesture, then load and play.
      void this.unlock();
      return start();
    }
    const { context, elements, gains } = this.ensureGraph();
    if (context && context.state === 'suspended') await context.resume();
    const element = elements[this.activeIndex];
    const gain = gains[this.activeIndex];
    const wasFadingOut = this.pauseTimeoutId !== null;
    this.cancelPendingPause();
    if (gain && context && (element.paused || wasFadingOut)) {
      // Resuming from a pause (or from the middle of its fade-out): ramp up from
      // wherever the output currently is instead of snapping to full volume.
      if (element.paused) setGainImmediate(gain, context, 0);
      scheduleFadeTo(gain, context, this.volume, RESUME_FADE_SEC);
    }
    await element.play();
  }

  pause(): void {
    if (!this.elements) return;
    const element = this.elements[this.activeIndex];
    const gain = this.gains?.[this.activeIndex];
    const context = this.context;
    this.cancelPendingPause();
    // No fade when there's nothing audible to fade (iOS has no GainNode), the element
    // is already stopped, or the page is hidden — timers are throttled in the
    // background, and a lock-screen pause has to take effect at once.
    if (!gain || !context || element.paused || (typeof document !== 'undefined' && document.hidden)) {
      element.pause();
      return;
    }
    scheduleFadeOut(gain, context, PAUSE_FADE_SEC);
    // The button flips right away; the element itself stops once the ramp has landed.
    this.updateSnapshot({ status: 'paused' });
    this.pauseTimeoutId = setTimeout(() => {
      this.pauseTimeoutId = null;
      element.pause();
    }, PAUSE_FADE_SEC * 1000 + 10);
  }

  private cancelPendingPause(): void {
    if (this.pauseTimeoutId !== null) {
      clearTimeout(this.pauseTimeoutId);
      this.pauseTimeoutId = null;
    }
  }

  togglePlay(): void {
    if (!this.elements) return;
    // "Paused" includes the ~90ms while a pause's fade-out is still running — the
    // element itself hasn't stopped yet, but the user's intent already has.
    const logicallyPaused = this.elements[this.activeIndex].paused || this.pauseTimeoutId !== null;
    if (logicallyPaused) {
      // Previously `void this.play()` — a rejection here (e.g. the element's src
      // wasn't actually valid/ready yet) vanished as a silent unhandled promise
      // rejection: no toast, no state change, the play button just did nothing
      // with zero explanation. Routing it through the same error state the
      // loadTrack/crossfadeTo failure path already uses gets it the same
      // "Gagal memutar lagu ini." toast + retry button instead.
      this.play().catch(() => {
        this.updateSnapshot({ status: 'error', error: 'Gagal memutar lagu ini.' });
      });
    } else {
      this.pause();
    }
  }

  seek(timeSec: number): void {
    if (!this.elements) return;
    const element = this.elements[this.activeIndex];
    const duration = element.duration || this.snapshot.duration || 0;
    element.currentTime = Math.min(Math.max(timeSec, 0), duration || timeSec);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(Math.max(volume, 0), 1);
    if (this.context && this.gains) {
      const gain = this.gains[this.activeIndex];
      if (gain) setGainImmediate(gain, this.context, this.volume);
    } else if (this.elements) {
      this.elements[this.activeIndex].volume = this.volume;
    }
  }

  getVolume(): number {
    return this.volume;
  }

  getCurrentTime(): number {
    return this.elements ? this.elements[this.activeIndex].currentTime : 0;
  }

  getDuration(): number {
    // Deliberately just the trusted metadata value (song.duration, preferred over the
    // browser's own estimate — see loadTrack), no self-correction against currentTime.
    // A previous version of this method extended duration to Math.max(duration,
    // currentTime) to avoid ever showing "current > total" — reasonable-looking, but it
    // masked the real signal that something was wrong instead of fixing it: confirmed via
    // a debug overlay on a real affected device that iOS WebKit can badly miscalculate a
    // progressively-streamed MP4/M4A file's own duration (one measured case was exactly
    // 2x the track's real length) — extending duration to match currentTime just let the
    // seek bar climb right alongside that bad estimate instead of ever flagging a
    // problem. usePlaybackController now compares currentTime directly against the
    // song's real published duration to decide when a track is done — see there.
    return this.snapshot.duration;
  }

  getCurrentSong(): Song | null {
    return this.currentSong;
  }

  /**
   * True when the Web Audio graph isn't actually producing sound (context not
   * 'running') even though we believe playback is active — the <audio> element's own
   * currentTime keeps advancing regardless of whether the GainNode chain downstream
   * is actually connected to real output, so "sound genuinely stopped, but the seek
   * bar keeps ticking" is exactly this state, not a stalled/frozen element. Normally
   * self-heals via bindLifecycleRecovery's resume() calls, but iOS Safari has a
   * documented, currently-unfixed WebKit bug where the context can get permanently
   * stuck 'interrupted' and resume() silently does nothing
   * (bugs.webkit.org/show_bug.cgi?id=263627) — this lets callers detect that dead-end
   * instead of waiting on a recovery that will never come.
   */
  isAudioSilentWhilePlaying(): boolean {
    return this.snapshot.status === 'playing' && this.context !== null && this.context.state !== 'running';
  }

  /** True while a track change owns the spare <audio> element (a method rather than an
   * inline check so it is re-read fresh after an await, not narrowed by an earlier one). */
  private spareElementBusy(): boolean {
    return this.snapshot.status === 'loading' || this.transitionsInFlight > 0;
  }

  private hasUsablePreload(song: Song, dataSaver: boolean, element: HTMLAudioElement): boolean {
    const preloaded = this.preloaded;
    return preloaded !== null && preloaded.songId === song.id && preloaded.dataSaver === dataSaver && element.src !== '' && !element.error;
  }

  /**
   * Waits for `element` (whose src is already set) to become playable, retrying once against `networkUrl` if
   * it was a local blob: URL that failed — iOS Safari has a documented history of unreliable blob: audio (see
   * AudioCache's own note), and this is what lets a device actually hitting that recover silently instead of
   * surfacing "Gagal memutar lagu ini." over something this fixable. recordLocalAudioFailure/Success is what
   * lets the app notice a real pattern (not a one-off) and stop trying blobs at all on a device where they
   * keep failing — see settingsStore.localAudioEnabled.
   */
  private async waitWithBlobFallback(element: HTMLAudioElement, networkUrl: string, requestId: number): Promise<void> {
    const isBlob = element.src.startsWith('blob:');
    try {
      await waitForEvent(element, 'canplay', CANPLAY_TIMEOUT_MS);
      if (isBlob) useSettingsStore.getState().recordLocalAudioSuccess();
    } catch (error) {
      if (!isBlob) throw error;
      useSettingsStore.getState().recordLocalAudioFailure();
      URL.revokeObjectURL(element.src);
      if (requestId !== this.playRequestId) throw error; // a newer request has since claimed this element
      element.src = networkUrl;
      element.load();
      await waitForEvent(element, 'canplay', CANPLAY_TIMEOUT_MS);
    }
  }

  /** Same as waitWithBlobFallback, but also does the initial `element.src = url; element.load()` — for the
   * (more common) case where the caller hasn't pointed the element at `url` yet. */
  private async loadElementWithFallback(element: HTMLAudioElement, url: string, networkUrl: string, requestId: number): Promise<void> {
    element.src = url;
    element.load();
    await this.waitWithBlobFallback(element, networkUrl, requestId);
  }

  private cancelPendingCrossfade(): void {
    if (this.crossfadeTimeoutId !== null) {
      clearTimeout(this.crossfadeTimeoutId);
      this.crossfadeTimeoutId = null;
    }
  }

  /**
   * Crossfades from the currently active track to `song` over `durationSec`.
   * Falls back to a hard cut (via loadTrack) when durationSec <= 0, or when the
   * browser blocks starting the second element's playback outside a user
   * gesture (observed on iOS Safari) — crossfade is a smoothness nicety, never
   * a requirement for basic playback to keep working.
   */
  async crossfadeTo(song: Song, durationSec: number, options: LoadTrackOptions = {}): Promise<void> {
    this.deferredStart = null;
    this.transitionsInFlight += 1;
    try {
      await this.crossfadeToImpl(song, durationSec, options);
    } catch (error) {
      finishTrace(error instanceof Error && error.message.includes('Timed out') ? 'timeout' : 'error');
      throw error;
    } finally {
      this.transitionsInFlight -= 1;
    }
  }

  private async crossfadeToImpl(song: Song, durationSec: number, options: LoadTrackOptions): Promise<void> {
    this.cancelPendingPause();
    const dataSaver = options.dataSaver ?? false;
    // If Web Audio API is disabled (e.g. iOS fallback), crossfades must degrade to a hard cut.
    if (durationSec <= 0 || !this.context) {
      await this.loadTrack(song, { dataSaver, autoplay: true });
      return;
    }

    const requestId = ++this.playRequestId;
    const { context, elements, gains } = this.ensureGraph();
    if (context && context.state === 'suspended') await context.resume();
    if (requestId !== this.playRequestId) return;

    // Without this, the snapshot kept reporting the outgoing track's stale 'playing'
    // status for the entire network+decode wait below — anything reading it externally
    // (the lock-screen media session, the buffering spinner) had no way to tell a skip
    // was even in progress until the new track had already started.
    this.updateSnapshot({ status: 'loading', error: null });

    const outgoingIndex = this.activeIndex;
    const incomingIndex: 0 | 1 = outgoingIndex === 0 ? 1 : 0;
    const outgoingGain = gains[outgoingIndex];
    const incomingElement = elements[incomingIndex];
    const incomingGain = gains[incomingIndex];

    const usePreload = this.hasUsablePreload(song, dataSaver, incomingElement);
    const networkUrl = resolveAudioUrl(song.id, dataSaver);
    if (usePreload) {
      // Already preloaded natively by preloadNextTrack!
      beginTrace(song, dataSaver ? 'low' : 'high', incomingElement, true);
      this.preloadedUrl = null;
      this.preloaded = null;
    } else {
      const url = (await localUrlFor(song.id, dataSaver)) ?? networkUrl;
      if (requestId !== this.playRequestId) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        return; // a newer request took over while the cache lookup ran
      }
      this.preloadedUrl = null;
      this.preloaded = null;
      beginTrace(song, dataSaver ? 'low' : 'high', incomingElement, false);
      const oldSrc = incomingElement.src;
      incomingElement.src = url;
      incomingElement.load();
      if (oldSrc.startsWith('blob:')) URL.revokeObjectURL(oldSrc);
    }
    if (incomingGain && context) setGainImmediate(incomingGain, context, 0);

    try {
      await this.waitWithBlobFallback(incomingElement, networkUrl, requestId);
      if (requestId !== this.playRequestId) return; // a newer request has since claimed this same element
      await incomingElement.play();
      if (requestId !== this.playRequestId) {
        // Superseded the instant play() resolved — undo before it's audible, and
        // don't touch activeIndex/gain/fade scheduling, all of which the winning
        // request now owns.
        incomingElement.pause();
        return;
      }
    } catch {
      if (requestId !== this.playRequestId) return;
      // Second element could not start (e.g. iOS blocking non-gesture play()) — degrade to a hard cut.
      // Must explicitly silence and stop the OUTGOING element here: the success path
      // below stops it via scheduleFadeOut + the crossfadeTimeoutId cleanup, but this
      // branch returns before ever reaching either — without this, the old track kept
      // playing at full volume underneath whatever loadTrack() below starts next, the
      // exact "dua lagu kedengeran bareng pas skip" overlap bug.
      if (outgoingGain && context) setGainImmediate(outgoingGain, context, 0);
      elements[outgoingIndex].pause();
      this.activeIndex = incomingIndex;
      this.currentSong = song;
      await this.loadTrack(song, { dataSaver, autoplay: true, fadeInSec: 0.3 });
      return;
    }

    this.activeIndex = incomingIndex;
    this.currentSong = song;
    this.updateSnapshot({ status: 'playing', duration: song.duration || incomingElement.duration, error: null });

    if (outgoingGain && context) scheduleFadeOut(outgoingGain, context, durationSec);
    if (incomingGain && context) scheduleFadeIn(incomingGain, context, this.volume, durationSec);

    this.cancelPendingCrossfade();
    this.crossfadeTimeoutId = setTimeout(() => {
      const outgoingElement = elements[outgoingIndex];
      // Only clear if the element hasn't been repurposed for a new preload
      if (!this.preloadedUrl || !outgoingElement.src.endsWith(this.preloadedUrl)) {
        const oldSrc = outgoingElement.src;
        outgoingElement.pause();
        outgoingElement.removeAttribute('src');
        outgoingElement.load();
        if (oldSrc.startsWith('blob:')) URL.revokeObjectURL(oldSrc);
      }
      this.crossfadeTimeoutId = null;
    }, durationSec * 1000 + 100);
  }

  /**
   * Preloads the next track into the inactive Web Audio element.
   * This forces the mobile browser (iOS Safari / Android Chrome) to natively buffer 
   * the media stream in the background using the OS's prioritized media downloader, 
   * bypassing the JS `fetch()` background throttling that usually starves mobile PWAs.
   */
  async preloadNextTrack(song: Song, dataSaver = false): Promise<void> {
    if (!this.elements) return;
    // Do NOT preload into the inactive element if we are currently in the middle of
    // loading a real track transition (crossfadeTo/loadTrack) — the inactive element
    // is actively being used by that transition, and touching it here would overwrite
    // the song the user just clicked with the one *after* it!
    if (this.spareElementBusy()) return;

    const inactiveIndex = this.activeIndex === 0 ? 1 : 0;
    const inactiveElement = this.elements[inactiveIndex];
    if (this.hasUsablePreload(song, dataSaver, inactiveElement)) return; // already sitting in the spare element

    let url = await localUrlFor(song.id, dataSaver);
    if (!url) url = resolveAudioUrl(song.id, dataSaver);
    const preloadUrl = url.startsWith('blob:') ? url : url + (url.includes('?') ? '&' : '?') + 'priority=low';

    // The cache lookup above is async — a track change may have started while it ran,
    // and that change now owns the spare element.
    if (this.spareElementBusy() || this.activeIndex !== (inactiveIndex === 0 ? 1 : 0)) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      return;
    }

    // Set the src and force a load. The element is already user-activated (see unlock()),
    // so the browser will honor this background load.
    this.preloadedUrl = preloadUrl;
    this.preloaded = { songId: song.id, dataSaver };
    const oldSrc = inactiveElement.src;
    inactiveElement.src = preloadUrl;
    inactiveElement.load();
    if (oldSrc.startsWith('blob:')) URL.revokeObjectURL(oldSrc);
  }

  subscribe(listener: AudioEngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): PlaybackState {
    return this.snapshot;
  }
}

export const audioEngine = AudioEngine.getInstance();
