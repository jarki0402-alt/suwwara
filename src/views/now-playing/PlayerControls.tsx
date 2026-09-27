import { Icon } from '../../components/Icon/Icon';
import { useBubbleRipple } from '../../hooks/useBubbleRipple';
import { cycleRepeat, toggleShuffle } from '../../jam/jamQueueActions';
import { useQueueStore } from '../../stores/queueStore';
import styles from './PlayerControls.module.css';

interface PlayerControlsProps {
  isPlaying: boolean;
  isBuffering: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
}

export function PlayerControls({ isPlaying, isBuffering, onTogglePlay, onNext, onPrevious }: PlayerControlsProps) {
  const shuffle = useQueueStore((state) => state.shuffle);
  const repeatMode = useQueueStore((state) => state.repeatMode);
  const shuffleRipple = useBubbleRipple<HTMLButtonElement>();
  const prevRipple = useBubbleRipple<HTMLButtonElement>();
  const playRipple = useBubbleRipple<HTMLButtonElement>();
  const nextRipple = useBubbleRipple<HTMLButtonElement>();
  const repeatRipple = useBubbleRipple<HTMLButtonElement>();

  return (
    <div className={styles.row}>
      <button
        ref={shuffleRipple.ref}
        type="button"
        className={[styles.sideButton, 'glass-ripple-host', shuffle ? styles.sideButtonActive : ''].join(' ')}
        onClick={toggleShuffle}
        onPointerDown={shuffleRipple.onPointerDown}
        aria-label="Acak antrean"
        aria-pressed={shuffle}
      >
        <Icon name="shuffle" size={24} />
        <span className={styles.activeDot} aria-hidden="true" />
      </button>

      <div className={styles.transportGroup}>
        <button
          ref={prevRipple.ref}
          type="button"
          className={[styles.transportButton, 'glass-ripple-host'].join(' ')}
          onClick={onPrevious}
          onPointerDown={prevRipple.onPointerDown}
          aria-label="Lagu sebelumnya"
        >
          <Icon name="previous" size={28} />
        </button>
        <button
          ref={playRipple.ref}
          type="button"
          className={[styles.playButton, 'glass-ripple-host'].join(' ')}
          onClick={onTogglePlay}
          onPointerDown={playRipple.onPointerDown}
          aria-label={isPlaying ? 'Jeda' : 'Putar'}
        >
          {/* Buffering is functionally treated as 'Pause' visually so it doesn't look like an error or lag */}
          <Icon name={isPlaying || isBuffering ? 'pause' : 'play'} size={28} />
        </button>
        <button
          ref={nextRipple.ref}
          type="button"
          className={[styles.transportButton, 'glass-ripple-host'].join(' ')}
          onClick={onNext}
          onPointerDown={nextRipple.onPointerDown}
          aria-label="Lagu berikutnya"
        >
          <Icon name="next" size={28} />
        </button>
      </div>

      <button
        ref={repeatRipple.ref}
        type="button"
        className={[styles.sideButton, 'glass-ripple-host', repeatMode !== 'off' ? styles.sideButtonActive : ''].join(' ')}
        onClick={cycleRepeat}
        onPointerDown={repeatRipple.onPointerDown}
        aria-label="Ubah mode ulang"
      >
        <Icon name={repeatMode === 'one' ? 'repeat-one' : 'repeat'} size={24} />
        <span className={styles.activeDot} aria-hidden="true" />
      </button>
    </div>
  );
}
