import { ArtistLinks } from '../../components/ArtistLinks/ArtistLinks';
import type { Song } from '../../api/types';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { LikeButton } from '../../components/LikeButton/LikeButton';
import { cycleRepeat, toggleShuffle } from '../../jam/jamQueueActions';
import { useQueueStore } from '../../stores/queueStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { SeekBar } from './SeekBar';
import styles from './FullscreenControls.module.css';

interface FullscreenControlsProps {
  song: Song;
  isPlaying: boolean;
  isBuffering: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
}

/**
 * Fullscreen lyrics mode's own bottom bar — deliberately one compact
 * MiniPlayer-shaped row (art+title | seek bar+transport | like/lyrics/volume)
 * instead of NowPlayingView's normal stacked rows (meta, then seek bar, then
 * transport, then a bottom row), and deliberately transparent (no bar
 * background at all) rather than opaque — this is meant to float over the
 * immersive ambient backdrop as just a cluster of buttons, not read as its
 * own panel. Auto-hidden on idle by NowPlayingView (see its own isIdle
 * handling) — this component itself doesn't know about that, it only
 * renders the bar's contents.
 */
export function FullscreenControls({ song, isPlaying, isBuffering, onTogglePlay, onNext, onPrevious }: FullscreenControlsProps) {
  const shuffle = useQueueStore((state) => state.shuffle);
  const repeatMode = useQueueStore((state) => state.repeatMode);
  const isLyricsOpen = useUiStore((state) => state.isLyricsOpen);
  const toggleLyrics = useUiStore((state) => state.toggleLyrics);
  const volume = useSettingsStore((state) => state.volume);
  const setVolume = useSettingsStore((state) => state.setVolume);

  return (
    <div className={styles.bar}>
      <div className={styles.main}>
        <LazyImage images={song.image} quality="50x50" alt={song.name} className={styles.art} />
        <span className={styles.text}>
          <span className={styles.title}>{song.name}</span>
          <span className={styles.subtitle}><ArtistLinks song={song} /></span>
        </span>
      </div>

      <div className={styles.center}>
        <div className={styles.transport}>
          <button
            type="button"
            className={[styles.smallButton, shuffle ? styles.smallButtonActive : ''].join(' ')}
            onClick={toggleShuffle}
            aria-label="Acak antrean"
            aria-pressed={shuffle}
          >
            <Icon name="shuffle" size={20} />
          </button>
          <button type="button" className={styles.smallButton} onClick={onPrevious} aria-label="Lagu sebelumnya">
            <Icon name="previous" size={20} />
          </button>
          <button type="button" className={styles.playButton} onClick={onTogglePlay} aria-label={isPlaying ? 'Jeda' : 'Putar'}>
            <Icon name={isPlaying || isBuffering ? 'pause' : 'play'} size={20} />
          </button>
          <button type="button" className={styles.smallButton} onClick={onNext} aria-label="Lagu berikutnya">
            <Icon name="next" size={20} />
          </button>
          <button
            type="button"
            className={[styles.smallButton, repeatMode !== 'off' ? styles.smallButtonActive : ''].join(' ')}
            onClick={cycleRepeat}
            aria-label="Ubah mode ulang"
          >
            <Icon name={repeatMode === 'one' ? 'repeat-one' : 'repeat'} size={20} />
          </button>
        </div>
        <SeekBar duration={song.duration} horizontal />
      </div>

      <div className={styles.right}>
        <LikeButton song={song} />
        <button
          type="button"
          className={[styles.iconButton, isLyricsOpen ? styles.iconButtonActive : ''].join(' ')}
          onClick={toggleLyrics}
          aria-label="Tampilkan lirik"
          aria-pressed={isLyricsOpen}
        >
          <Icon name="lyrics" size={20} />
        </button>
        <div className={styles.volumeControl}>
          <Icon name={volume === 0 ? 'volume-mute' : 'volume'} size={20} />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(event) => setVolume(Number(event.target.value) / 100)}
            className={styles.volumeSlider}
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
}
