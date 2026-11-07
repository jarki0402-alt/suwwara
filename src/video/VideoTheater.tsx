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
import { PlayerControls } from '../views/now-playing/PlayerControls';
import { SeekBar } from '../views/now-playing/SeekBar';
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
  const { currentSong, playbackState, handleTogglePlay, handleNext, handlePrevious } = usePlayback();
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
          <OwnTransport element={sound.element} clock={clock} durationSec={session.video.durationSec} />
        ) : (
          <>
            <SeekBar duration={session.song.duration} />
            <PlayerControls
              isPlaying={playbackState.status === 'playing'}
              isBuffering={playbackState.status === 'loading'}
              onTogglePlay={handleTogglePlay}
              onNext={handleNext}
              onPrevious={handlePrevious}
            />
          </>
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

/** Play/pause and seek for a video playing with its own sound. */
function OwnTransport({ element, clock, durationSec }: { element: HTMLAudioElement; clock: VideoClock; durationSec: number }) {
  const t = useT();
  // Whole seconds and the play state: re-renders at most once a second while playing.
  const second = useSyncExternalStore(subscribeFrames, () => Math.floor(clock.time()));
  const paused = useSyncExternalStore(clock.subscribe, () => element.paused);
  const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : durationSec;
  const fill = duration > 0 ? Math.min(100, (second / duration) * 100) : 0;

  return (
    <div className={styles.ownTransport}>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.floor(duration))}
        value={Math.min(second, Math.floor(duration))}
        onChange={(event) => seekElement(element, Number(event.target.value))}
        className={styles.seek}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        aria-label={t('Posisi video')}
      />
      <div className={styles.ownRow}>
        <span className={styles.time}>{formatTime(second)}</span>
        <button
          type="button"
          className={styles.playButton}
          onClick={() => (element.paused ? void element.play().catch(() => {}) : element.pause())}
          aria-label={paused ? t('Putar') : t('Jeda')}
        >
          <Icon name={paused ? 'play' : 'pause'} size={28} />
        </button>
        <span className={styles.time}>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
