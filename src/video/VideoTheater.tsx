import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { bestImageUrl, primaryArtistNames } from '../api/mappers';
import { audioEngine, isAndroid } from '../audio-engine/AudioEngine';
import { Icon } from '../components/Icon/Icon';
import { useToast } from '../components/Toast/ToastProvider';
import { useT } from '../i18n/i18n';
import { usePlayback } from '../playback/PlaybackContext';
import { useUiStore, type VideoTheaterSession } from '../stores/uiStore';
import { isDocumentFullscreen, onDocumentFullscreenChange } from '../utils/documentFullscreen';
import { formatTime } from '../utils/formatTime';
import { currentVideoSound, peekMusicVideo, songClock, stopVideoSound, subscribeLookups, type VideoClock } from './musicVideo';
import { lockLandscape } from './theater';
import { useMusicVideo } from './useMusicVideo';
import { VideoSurface, type UnavailableReason } from './VideoSurface';
import styles from './VideoTheater.module.css';

// Controls fade after this long without a touch or mouse move, like any video player.
const CHROME_IDLE_MS = 3000;

export function VideoTheater() {
  const session = useUiStore((state) => state.videoTheater);
  if (!session) return null;
  return <TheaterView key={`${session.video.videoId}:${session.ownSound}`} session={session} />;
}

function TheaterView({ session }: { session: VideoTheaterSession }) {
  const t = useT();
  const { showToast } = useToast();
  const close = useUiStore((state) => state.closeVideoTheater);
  const open = useUiStore((state) => state.openVideoTheater);
  const { currentSong, handleTogglePlay, handleNext, handlePrevious } = usePlayback();
  // Taken once: the sound started in the tap that opened this, and it lives as long as this view.
  const [sound] = useState(() => (session.ownSound ? currentVideoSound() : null));
  const clock: VideoClock = sound?.clock ?? songClock;
  const [chromeVisible, setChromeVisible] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wake = () => {
    setChromeVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS);
  };
  useEffect(() => {
    idleTimer.current = setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS);
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  // Fullscreen came from the tap that opened this; leaving it from outside (Esc, the browser's own UI) leaves the theater.
  useEffect(() => {
    let wasFullscreen = isDocumentFullscreen();
    if (wasFullscreen && isAndroid) lockLandscape();
    const off = onDocumentFullscreenChange(() => {
      const now = isDocumentFullscreen();
      if (now && isAndroid) lockLandscape();
      if (wasFullscreen && !now) close();
      wasFullscreen = now;
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDocumentFullscreen()) close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);

  // The song's own picture follows the song: on a skip, the next song's video if it is the same cut, else back out.
  useMusicVideo(session.ownSound ? null : currentSong); // starts the lookup
  const found = useSyncExternalStore(subscribeLookups, () => (currentSong ? peekMusicVideo(currentSong.id) : undefined));
  useEffect(() => {
    if (session.ownSound || !currentSong || currentSong.id === session.song.id) return;
    if (found === undefined) return; // still being looked up: re-runs once it lands
    if (found?.synced) open({ song: currentSong, video: found, ownSound: false });
    else close();
  }, [session, currentSong, found, open, close]);

  // A different cut has its own sound: the song starting again (lock screen, another device) ends the video, and
  // so does the video reaching its end (on to the next song, the one it was the video of has been heard).
  useEffect(() => {
    if (!sound) return;
    const unsubscribe = audioEngine.subscribe((state) => {
      if (state.status === 'playing' || state.status === 'loading') close();
    });
    const onEnded = () => {
      stopVideoSound(false);
      close();
      handleNext();
    };
    sound.element.addEventListener('ended', onEnded);
    return () => {
      unsubscribe();
      sound.element.removeEventListener('ended', onEnded);
    };
  }, [sound, close, handleNext]);

  // The MV's own sound stops for good first (not "resume the song", which closing alone would do), then the queue moves.
  const leaveFor = (move: () => void) => {
    stopVideoSound(false);
    close();
    move();
  };

  const poster = bestImageUrl(session.song.image, '500x500');
  const giveUp = (reason: UnavailableReason) => {
    showToast(reason === 'slow' ? t('Koneksi terlalu lambat untuk video.') : t('Video tidak bisa diputar sekarang.'));
    close();
  };

  return (
    <div
      className={[styles.theater, chromeVisible ? '' : styles.idle].join(' ')}
      role="dialog"
      aria-modal="true"
      aria-label={t('Video musik')}
      onPointerMove={wake}
      onPointerDown={wake}
    >
      <VideoSurface videoId={session.video.videoId} clock={clock} posterUrl={poster} className={styles.surface} onUnavailable={giveUp} />

      <div className={[styles.top, chromeVisible ? '' : styles.hidden].join(' ')}>
        <button type="button" className={styles.iconButton} onClick={close} aria-label={t('Tutup video')}>
          <Icon name="chevron-down" size={24} />
        </button>
        <div className={styles.titles}>
          <span className={styles.title}>{session.song.name}</span>
          <span className={styles.artist}>{primaryArtistNames(session.song)}</span>
        </div>
        {session.ownSound && <span className={styles.badge}>{t('Versi MV, dari awal')}</span>}
      </div>

      <div className={[styles.bottom, chromeVisible ? '' : styles.hidden].join(' ')}>
        {sound ? (
          <Transport
            clock={clock}
            durationSec={Number.isFinite(sound.element.duration) && sound.element.duration > 0 ? sound.element.duration : session.video.durationSec}
            paused={() => sound.element.paused}
            onToggle={() => (sound.element.paused ? void sound.element.play().catch(() => {}) : sound.element.pause())}
            onSeek={(seconds) => seekElement(sound.element, seconds)}
            onPrevious={() => {
              // Like any player: past the first seconds, back to the start of this video; at its start, the song before.
              if (sound.element.currentTime > RESTART_THRESHOLD_SEC) {
                seekElement(sound.element, 0);
                return;
              }
              // The song under the video is paused mid-way, where "previous" would only rewind it (and stay paused): at 0
              // it goes to the song before, which starts playing.
              leaveFor(() => {
                audioEngine.seek(0);
                handlePrevious();
              });
            }}
            onNext={() => leaveFor(handleNext)}
          />
        ) : (
          <Transport
            clock={clock}
            durationSec={session.song.duration}
            paused={() => audioEngine.getSnapshot().status !== 'playing' && audioEngine.getSnapshot().status !== 'loading'}
            onToggle={handleTogglePlay}
            onSeek={(seconds) => audioEngine.seek(seconds)}
            onPrevious={handlePrevious}
            onNext={handleNext}
          />
        )}
      </div>
    </div>
  );
}

function subscribeFrames(listener: () => void): () => void {
  const timer = setInterval(listener, 250);
  return () => clearInterval(timer);
}

function seekElement(element: HTMLAudioElement, seconds: number): void {
  element.currentTime = seconds;
}

// Previous within this many seconds of the start goes to the song before, later it restarts the video (as songs do).
const RESTART_THRESHOLD_SEC = 3;

// The 10-second jumps of every video player: for finding the part of a video again, which a song rarely needs.
const SKIP_SEC = 10;

interface TransportProps {
  clock: VideoClock;
  durationSec: number;
  paused: () => boolean;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  /** Previous/next track. With a different cut's own sound, they leave the video for the song before/after. */
  onPrevious?: () => void;
  onNext?: () => void;
}

/** The theater's controls: seek, back/forward 10s around play/pause, and previous/next. */
function Transport({ clock, durationSec, paused: isPaused, onToggle, onSeek, onPrevious, onNext }: TransportProps) {
  const t = useT();
  // Whole seconds and the play state: re-renders at most once a second while playing.
  const second = useSyncExternalStore(subscribeFrames, () => Math.floor(clock.time()));
  const paused = useSyncExternalStore(subscribeFrames, isPaused);
  const duration = Math.max(durationSec, 0);
  const fill = duration > 0 ? Math.min(100, (second / duration) * 100) : 0;
  const skip = (delta: number) => onSeek(Math.min(Math.max(clock.time() + delta, 0), Math.max(duration - 1, 0)));

  return (
    <div className={styles.transport}>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration))}
        value={Math.min(second, Math.floor(duration))}
        onChange={(event) => onSeek(Number(event.target.value))}
        className={styles.seek}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        aria-label={t('Posisi video')}
      />
      <div className={styles.row}>
        <span className={styles.time}>{formatTime(second)}</span>
        <div className={styles.buttons}>
          {onPrevious && (
            <button type="button" className={styles.control} onClick={onPrevious} aria-label={t('Lagu sebelumnya')}>
              <Icon name="previous" size={24} />
            </button>
          )}
          <button type="button" className={styles.control} onClick={() => skip(-SKIP_SEC)} aria-label={t('Mundur 10 detik')}>
            <Icon name="replay-10" size={28} />
          </button>
          <button type="button" className={styles.playButton} onClick={onToggle} aria-label={paused ? t('Putar') : t('Jeda')}>
            <Icon name={paused ? 'play' : 'pause'} size={28} />
          </button>
          <button type="button" className={styles.control} onClick={() => skip(SKIP_SEC)} aria-label={t('Maju 10 detik')}>
            <Icon name="forward-10" size={28} />
          </button>
          {onNext && (
            <button type="button" className={styles.control} onClick={onNext} aria-label={t('Lagu berikutnya')}>
              <Icon name="next" size={24} />
            </button>
          )}
        </div>
        <span className={styles.time}>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
