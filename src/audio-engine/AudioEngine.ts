import type { Song } from '../api/types';
import { resolveAudioUrl } from './bitrateResolver';
import { scheduleFadeIn, scheduleFadeOut, setGainImmediate } from './crossfade';
import type { AudioEngineListener, LoadTrackOptions, PlaybackState } from './types';
import { AudioEngineError } from './types';

const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const CANPLAY_TIMEOUT_MS = 15000;

function waitForEvent(target: HTMLMediaElement, event: 'canplay', timeoutMs: number): Promise<void> {
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
  private currentSong: Song | null = null;
  private preloadedUrl: string | null = null;
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

  async loadTrack(song: Song, options: LoadTrackOptions = {}): Promise<void> {
    const requestId = ++this.playRequestId;
    const { context, elements, gains } = this.ensureGraph();
    if (context && context.state === 'suspended') await context.resume();
    if (requestId !== this.playRequestId) return; // superseded while the context was resuming

    const url = resolveAudioUrl(song.id, options.dataSaver ?? false);

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
    const inactiveIndex = this.activeIndex === 0 ? 1 : 0;
    if (this.preloadedUrl === url && elements[inactiveIndex].src.endsWith(url)) {
      const oldActiveIndex = this.activeIndex;
      this.activeIndex = inactiveIndex;
      this.preloadedUrl = null;
      // We swapped elements. Stop the old one.
      elements[oldActiveIndex].pause();
      elements[oldActiveIndex].removeAttribute('src');
      elements[oldActiveIndex].load();
      // Use the newly active one
      const newElement = elements[this.activeIndex];
      const newGain = gains[this.activeIndex];
      if (newGain && context) {
        setGainImmediate(newGain, context, options.fadeInSec ? 0 : this.volume);
      } else {
        newElement.volume = this.volume;
      }
      
      await waitForEvent(newElement, 'canplay', CANPLAY_TIMEOUT_MS);
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
    element.src = url;
    element.load();
    await waitForEvent(element, 'canplay', CANPLAY_TIMEOUT_MS);
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
    element.src = resolveAudioUrl(song.id, true);
    element.load();
    await waitForEvent(element, 'canplay', CANPLAY_TIMEOUT_MS);
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
    const { context, elements } = this.ensureGraph();
    if (context && context.state === 'suspended') await context.resume();
    await elements[this.activeIndex].play();
  }

  pause(): void {
    if (!this.elements) return;
    this.elements[this.activeIndex].pause();
  }

  togglePlay(): void {
    if (!this.elements) return;
    if (this.elements[this.activeIndex].paused) {
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
  async crossfadeTo(song: Song, durationSec: number, dataSaver = false): Promise<void> {
    // If Web Audio API is disabled (e.g. iOS fallback), crossfades must degrade to a hard cut.
    if (durationSec <= 0 || !this.context) {
      await this.loadTrack(song, { dataSaver, autoplay: true });
      return;
    }

    const requestId = ++this.playRequestId;
    const { context, elements, gains } = this.ensureGraph();
    if (context.state === 'suspended') await context.resume();
    if (requestId !== this.playRequestId) return;

    // Without this, the snapshot kept reporting the outgoing track's stale 'playing'
    // status for the entire network+decode wait below — anything reading it externally
    // (the lock-screen media session, the buffering spinner) had no way to tell a skip
    // was even in progress until the new track had already started.
    this.updateSnapshot({ status: 'loading', error: null });

    const url = resolveAudioUrl(song.id, dataSaver);

    const outgoingIndex = this.activeIndex;
    const incomingIndex: 0 | 1 = outgoingIndex === 0 ? 1 : 0;
    const outgoingGain = gains[outgoingIndex];
    const incomingElement = elements[incomingIndex];
    const incomingGain = gains[incomingIndex];

    if (this.preloadedUrl === url && incomingElement.src.endsWith(url)) {
      // Already preloaded natively by preloadNextTrack!
      this.preloadedUrl = null;
    } else {
      this.preloadedUrl = null;
      incomingElement.src = url;
      incomingElement.load();
    }
    if (incomingGain) setGainImmediate(incomingGain, context, 0);

    try {
      await waitForEvent(incomingElement, 'canplay', CANPLAY_TIMEOUT_MS);
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
      if (outgoingGain) setGainImmediate(outgoingGain, context, 0);
      elements[outgoingIndex].pause();
      this.activeIndex = incomingIndex;
      this.currentSong = song;
      await this.loadTrack(song, { dataSaver, autoplay: true, fadeInSec: 0.3 });
      return;
    }

    this.activeIndex = incomingIndex;
    this.currentSong = song;
    this.updateSnapshot({ status: 'playing', duration: song.duration || incomingElement.duration, error: null });

    if (outgoingGain) scheduleFadeOut(outgoingGain, context, durationSec);
    if (incomingGain) scheduleFadeIn(incomingGain, context, this.volume, durationSec);

    this.cancelPendingCrossfade();
    this.crossfadeTimeoutId = setTimeout(() => {
      const outgoingElement = elements[outgoingIndex];
      outgoingElement.pause();
      outgoingElement.removeAttribute('src');
      outgoingElement.load();
      this.crossfadeTimeoutId = null;
    }, durationSec * 1000 + 100);
  }

  /**
   * Preloads the next track into the inactive Web Audio element.
   * This forces the mobile browser (iOS Safari / Android Chrome) to natively buffer 
   * the media stream in the background using the OS's prioritized media downloader, 
   * bypassing the JS `fetch()` background throttling that usually starves mobile PWAs.
   */
  preloadNextTrack(song: Song, dataSaver = false): void {
    if (!this.elements) return;
    // Do NOT preload into the inactive element if we are currently in the middle of
    // loading a real track transition (crossfadeTo/loadTrack) — the inactive element
    // is actively being used by that transition, and touching it here would overwrite
    // the song the user just clicked with the one *after* it!
    if (this.snapshot.status === 'loading') return;

    const url = resolveAudioUrl(song.id, dataSaver);
    if (this.preloadedUrl === url) return;

    const inactiveIndex = this.activeIndex === 0 ? 1 : 0;
    const inactiveElement = this.elements[inactiveIndex];
    
    // Set the src and force a load. The element is already user-activated (see unlock()),
    // so the browser will honor this background load.
    this.preloadedUrl = url;
    inactiveElement.src = url;
    inactiveElement.load();
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
