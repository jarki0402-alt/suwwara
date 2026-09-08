import { useEffect, useRef } from 'react';
import { primaryArtistNames } from '../api/mappers';
import { audioEngine } from '../audio-engine/AudioEngine';
import { frameTicker } from '../audio-engine/frameTicker';
import { Icon } from '../components/Icon/Icon';
import { LazyImage } from '../components/Image/LazyImage';
import { ProgressBar, type ProgressBarHandle } from '../components/ProgressBar/ProgressBar';
import { cycleRepeat, toggleShuffle } from '../jam/jamQueueActions';
import { usePlayback } from '../playback/PlaybackContext';
import { useQueueStore } from '../stores/queueStore';
import { useUiStore } from '../stores/uiStore';
import styles from './MiniPlayer.module.css';

export function MiniPlayer() {
  const openNowPlaying = useUiStore((state) => state.openNowPlaying);
  const { currentSong, playbackState, handleTogglePlay, handleNext, handlePrevious } = usePlayback();
  const shuffle = useQueueStore((state) => state.shuffle);
  const repeatMode = useQueueStore((state) => state.repeatMode);
  const progressBarRef = useRef<ProgressBarHandle>(null);

  useEffect(() => {
    return frameTicker.subscribe(() => {
      const duration = audioEngine.getDuration();
      const current = audioEngine.getCurrentTime();
      progressBarRef.current?.setProgress(duration > 0 ? current / duration : 0);
    });
  }, []);

  if (!currentSong) return null;

  const isPlaying = playbackState.status === 'playing';
  const isBuffering = playbackState.status === 'loading';

  return (
    <div className={styles.wrapper}>
      <div className={styles.progressTrack}>
        <ProgressBar ariaLabel="Posisi lagu" ref={progressBarRef} compact />
      </div>

      <button type="button" className={styles.main} onClick={openNowPlaying}>
        <LazyImage images={currentSong.image} quality="50x50" alt={currentSong.name} className={styles.art} />
        <span className={styles.text}>
          <span className={styles.title}>{currentSong.name}</span>
          <span className={styles.subtitle}>{primaryArtistNames(currentSong)}</span>
        </span>
      </button>

      <div className={styles.actions}>
        <button
          type="button"
          className={[styles.actionButton, styles.desktopOnly, shuffle ? styles.actionButtonActive : ''].join(' ')}
          onClick={toggleShuffle}
          aria-label="Acak antrean"
          aria-pressed={shuffle}
        >
          <Icon name="shuffle" size={18} />
        </button>
        <button
          type="button"
          className={[styles.actionButton, styles.desktopOnly].join(' ')}
          onClick={handlePrevious}
          aria-label="Lagu sebelumnya"
        >
          <Icon name="previous" size={20} />
        </button>
        <button
          type="button"
          className={[styles.actionButton, styles.playButton].join(' ')}
          onClick={handleTogglePlay}
          aria-label={isPlaying ? 'Jeda' : 'Putar'}
        >
          <Icon
            name={isPlaying || isBuffering ? 'pause' : 'play'}
            size={22}
          />
        </button>
        <button type="button" className={styles.actionButton} onClick={handleNext} aria-label="Lagu berikutnya">
          <Icon name="next" size={22} />
        </button>
        <button
          type="button"
          className={[styles.actionButton, styles.desktopOnly, repeatMode !== 'off' ? styles.actionButtonActive : ''].join(' ')}
          onClick={cycleRepeat}
          aria-label="Ubah mode ulang"
        >
          <Icon name={repeatMode === 'one' ? 'repeat-one' : 'repeat'} size={18} />
        </button>
      </div>
    </div>
  );
}
