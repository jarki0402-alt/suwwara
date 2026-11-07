import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon/Icon';
import { useT } from '../i18n/i18n';
import { prefersHls, videoHlsUrl, videoStreamUrl, type VideoClock, type VideoHeight } from './musicVideo';
import styles from './VideoSurface.module.css';

// How often the picture is lined up with the sound. A quarter second is under the ~250ms between 'timeupdate's and
// cheap: a property read and, rarely, a write.
const SYNC_INTERVAL_MS = 250;
// Off by more than this: jump. Less: nudge the speed until it catches up, which is invisible, a jump is not.
const SEEK_DRIFT_SEC = 1;
const NUDGE_DRIFT_SEC = 0.06;
// A seek lands a moment after it is asked for (the frame has to be fetched and decoded), so it aims a bit ahead.
const SEEK_LEAD_SEC = 0.25;
const MIN_SEEK_GAP_MS = 1500;
// Lip sync starts to show past ~0.1s; a gap above that which the speed nudge hasn't closed in 3s is jumped instead.
const STUCK_DRIFT_SEC = 0.1;
const STUCK_DRIFT_MS = 3000;
const STUCK_SEEK_LEAD_SEC = 0.12;
// The song is buffering for longer than this: the picture stops downloading so the sound gets the whole connection.
const STARVING_DETACH_MS = 1500;
// 720p stalling (three waits in 30s, or one longer than 4s): 480p from then on, for this video.
const STALL_WINDOW_MS = 30_000;
const STALLS_TO_DOWNGRADE = 3;
const LONG_STALL_MS = 4000;
const MAX_RETRIES = 3;
const SEEK_GRACE_MS = 3000;
// No first frame this long after opening 720p: the connection can't carry it, 480p instead.
const SLOW_START_MS = 6000;

export type UnavailableReason = 'slow' | 'error';

interface Props {
  videoId: string;
  clock: VideoClock;
  posterUrl: string;
  /** False: keep the element but download nothing (the theater shows the same video, the panel is hidden). */
  active?: boolean;
  /** True while the song itself is starved for data (synced mode): the picture yields its bandwidth. */
  audioStarving?: () => boolean;
  fit?: 'contain' | 'cover';
  className?: string;
  /** 'slow': the connection can't carry even 480p next to the song; 'error': it wouldn't load. */
  onUnavailable: (reason: UnavailableReason) => void;
  children?: ReactNode;
}

/**
 * The picture of a music video, kept in step with a clock it does not own: the song's audio (synced) or the video's
 * own sound (theater). Always muted. The sound is the master: when the picture stalls only the picture freezes, and it
 * catches up afterwards, never the other way round. Nothing here touches AudioEngine.
 *
 * Shown over a poster of the cover art until its first frame is ready, then crossfaded, so switching never flashes
 * black. Stops downloading whenever it can't be seen (page hidden, `active` false) or the song needs the connection.
 */
export function VideoSurface({ videoId, clock, posterUrl, active = true, audioStarving, fit = 'contain', className, onUnavailable, children }: Props) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [shown, setShown] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  // Read inside the effect through refs: changing them must not restart the video.
  const starvingRef = useRef(audioStarving);
  const unavailableRef = useRef(onUnavailable);
  useEffect(() => {
    starvingRef.current = audioStarving;
    unavailableRef.current = onUnavailable;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;
    let disposed = false;
    let attached = false;
    let height: VideoHeight = '720';
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSeekAt = 0;
    let stalls: number[] = [];
    let waitingSince = 0;
    let starvingSince = 0;
    let seekOnMetadata = false;
    let laggingSince = 0;
    let useHls = prefersHls(video);
    let attachedAt = 0;

    const seekTo = (target: number) => {
      lastSeekAt = Date.now();
      const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
      video.currentTime = Math.min(Math.max(target, 0), Math.max(duration - 0.1, 0));
    };

    const attach = () => {
      if (attached || disposed) return;
      attached = true;
      seekOnMetadata = true;
      lastSeekAt = Date.now();
      attachedAt = Date.now();
      // A media fragment: the browser opens the file at the song's spot instead of loading the start and then seeking
      // (one wasted round of requests, seconds on WebKit). The seek on metadata still lines it up exactly.
      const at = Math.max(0, clock.time() + (clock.playing() ? SEEK_LEAD_SEC : 0));
      video.src = useHls ? videoHlsUrl(videoId, height) : `${videoStreamUrl(videoId, height)}#t=${at.toFixed(2)}`;
      video.load();
    };
    const detach = () => {
      if (!attached) return;
      attached = false;
      video.pause();
      video.removeAttribute('src');
      video.load(); // cancels the download
      setShown(false);
    };

    const tick = () => {
      if (disposed) return;
      if (document.visibilityState === 'hidden') {
        detach();
        return;
      }
      const now = Date.now();
      if (starvingRef.current?.()) {
        starvingSince ||= now;
        if (now - starvingSince > STARVING_DETACH_MS) detach();
        return;
      }
      starvingSince = 0;
      if (!attached) {
        if (!retryTimer) attach();
        return;
      }
      if (video.readyState < 2 && now - attachedAt > SLOW_START_MS) {
        // Not even a first frame yet on a slow connection: 480p is half the bytes. Already 480p: the connection
        // can't carry a video next to the song, and the song comes first.
        if (height === '480') {
          giveUp('slow');
          return;
        }
        height = '480';
        detach();
        attach();
        return;
      }
      if (video.readyState < 1 || video.seeking) return;

      const target = clock.time();
      if (!clock.playing()) {
        if (!video.paused) video.pause();
        if (Math.abs(video.currentTime - target) > 0.3) seekTo(target);
        if (video.playbackRate !== 1) video.playbackRate = 1;
        return;
      }
      if (video.paused && !video.ended) {
        video.play().catch((error: unknown) => {
          // iOS Low Power Mode refuses even muted autoplay: one tap on the picture starts it.
          if (error instanceof DOMException && error.name === 'NotAllowedError') setNeedsTap(true);
        });
      }
      const drift = video.currentTime - target;
      if (Math.abs(drift) > SEEK_DRIFT_SEC) {
        if (now - lastSeekAt > MIN_SEEK_GAP_MS) seekTo(target + SEEK_LEAD_SEC);
      } else {
        const rate = Math.abs(drift) > NUDGE_DRIFT_SEC ? Math.min(Math.max(1 - drift, 0.9), 1.1) : 1;
        if (Math.abs(video.playbackRate - rate) > 0.01) video.playbackRate = rate;
        // Some decoders (WebKit, a busy phone) can't actually run faster, so the nudge never closes the gap: a lag
        // that stays visible this long gets one small jump instead.
        if (Math.abs(drift) > STUCK_DRIFT_SEC) {
          laggingSince ||= now;
          if (now - laggingSince > STUCK_DRIFT_MS && now - lastSeekAt > MIN_SEEK_GAP_MS) {
            laggingSince = 0;
            seekTo(target + (drift < 0 ? STUCK_SEEK_LEAD_SEC : 0));
          }
        } else {
          laggingSince = 0;
        }
      }

      // Frames are coming: whatever wait was noted is over ('playing' doesn't always fire after one).
      if (video.readyState >= 3 && !video.paused) waitingSince = 0;
      stalls = stalls.filter((at) => now - at < STALL_WINDOW_MS);
      const longStall = waitingSince > 0 && now - waitingSince > LONG_STALL_MS;
      if (stalls.length >= STALLS_TO_DOWNGRADE || longStall) {
        if (height === '480') {
          giveUp('slow');
          return;
        }
        height = '480';
        stalls = [];
        waitingSince = 0;
        detach();
        attach();
      }
    };

    const giveUp = (reason: UnavailableReason) => {
      disposed = true;
      detach();
      unavailableRef.current(reason);
    };

    const onLoadedMetadata = () => {
      if (!seekOnMetadata) return;
      seekOnMetadata = false;
      seekTo(clock.time() + (clock.playing() ? SEEK_LEAD_SEC : 0));
    };
    const onFrame = () => {
      if (video.readyState >= 2) setShown(true);
      retries = 0;
    };
    const onWaiting = () => {
      // Waiting right after opening or a jump is the jump loading, not the connection failing to keep up.
      if (!clock.playing() || video.seeking || Date.now() - lastSeekAt < SEEK_GRACE_MS) return;
      waitingSince = Date.now();
      stalls.push(waitingSince);
    };
    const onPlaying = () => {
      waitingSince = 0;
      onFrame();
    };
    const onError = () => {
      if (!attached) return;
      detach();
      if (useHls) {
        // No usable playlist (the server answers 415 for a file without a segment index): the plain MP4, at once.
        useHls = false;
        attach();
        return;
      }
      if (retries >= MAX_RETRIES) {
        giveUp('error');
        return;
      }
      retries += 1;
      // A 503 (the server's video slots are full) or a dropped connection: try again shortly.
      retryTimer = setTimeout(() => {
        retryTimer = null;
        attach();
      }, 1500 * retries);
    };
    const onVisibility = () => tick();

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('loadeddata', onFrame);
    video.addEventListener('seeked', onFrame);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('error', onError);
    document.addEventListener('visibilitychange', onVisibility);
    const unsubscribe = clock.subscribe(tick);
    const interval = setInterval(tick, SYNC_INTERVAL_MS);
    tick();

    return () => {
      disposed = true;
      clearInterval(interval);
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('loadeddata', onFrame);
      video.removeEventListener('seeked', onFrame);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('error', onError);
      detach();
    };
  }, [videoId, clock, active]);

  const startByTap = () => {
    setNeedsTap(false);
    void videoRef.current?.play().catch(() => {});
  };

  return (
    <div className={[styles.surface, className ?? ''].join(' ')}>
      <video
        ref={videoRef}
        className={[styles.video, fit === 'cover' ? styles.cover : '', shown ? styles.visible : ''].join(' ')}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden="true"
      />
      <div className={[styles.poster, shown ? styles.posterHidden : ''].join(' ')} aria-hidden="true">
        {posterUrl && <img src={posterUrl} alt="" className={styles.posterBackdrop} />}
        {posterUrl && <img src={posterUrl} alt="" className={styles.posterArt} />}
        {active && !needsTap && <Icon name="spinner" size={28} className={styles.spinner} />}
      </div>
      {needsTap && (
        <button type="button" className={styles.tapToPlay} onClick={startByTap}>
          <Icon name="play" size={22} />
          {t('Ketuk untuk memutar video')}
        </button>
      )}
      {children}
    </div>
  );
}
