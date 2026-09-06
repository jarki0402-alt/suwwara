import { Icon } from '../../components/Icon/Icon';
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

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={[styles.sideButton, shuffle ? styles.sideButtonActive : ''].join(' ')}
        onClick={toggleShuffle}
        aria-label="Acak antrean"
        aria-pressed={shuffle}
      >
        <Icon name="shuffle" size={24} />
        <span className={styles.activeDot} aria-hidden="true" />
      </button>

      <div className={styles.transportGroup}>
        <button type="button" className={styles.transportButton} onClick={onPrevious} aria-label="Lagu sebelumnya">
          <Icon name="previous" size={28} />
        </button>
        <button type="button" className={styles.playButton} onClick={onTogglePlay} aria-label={isPlaying ? 'Jeda' : 'Putar'}>
          <Icon name={isBuffering ? 'spinner' : isPlaying ? 'pause' : 'play'} size={28} className={isBuffering ? styles.spinning : undefined} />
        </button>
        <button type="button" className={styles.transportButton} onClick={onNext} aria-label="Lagu berikutnya">
          <Icon name="next" size={28} />
        </button>
      </div>

      <button
        type="button"
        className={[styles.sideButton, repeatMode !== 'off' ? styles.sideButtonActive : ''].join(' ')}
        onClick={cycleRepeat}
        aria-label="Ubah mode ulang"
      >
        <Icon name={repeatMode === 'one' ? 'repeat-one' : 'repeat'} size={24} />
        <span className={styles.activeDot} aria-hidden="true" />
      </button>
    </div>
  );
}
