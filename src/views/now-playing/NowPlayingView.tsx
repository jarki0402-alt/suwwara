import { useState } from 'react';
import { primaryArtistNames } from '../../api/mappers';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { LikeButton } from '../../components/LikeButton/LikeButton';
import { usePlayback } from '../../playback/PlaybackContext';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { QueueView } from '../queue/QueueView';
import { LyricsPanel } from './LyricsPanel';
import styles from './NowPlayingView.module.css';
import { PlayerControls } from './PlayerControls';
import { SeekBar } from './SeekBar';

export function NowPlayingView() {
  const isOpen = useUiStore((state) => state.isNowPlayingOpen);
  const isQueueOpen = useUiStore((state) => state.isQueueOpen);
  const closeNowPlaying = useUiStore((state) => state.closeNowPlaying);
  const openQueue = useUiStore((state) => state.openQueue);
  const [showLyrics, setShowLyrics] = useState(false);

  const volume = useSettingsStore((state) => state.volume);
  const setVolume = useSettingsStore((state) => state.setVolume);

  const { currentSong, playbackState, handleTogglePlay, handleNext, handlePrevious } = usePlayback();

  if (!isOpen || !currentSong) return null;

  if (isQueueOpen) {
    return (
      <div className={styles.overlay}>
        <div className={styles.queueSheet}>
          <QueueView />
        </div>
      </div>
    );
  }

  const isPlaying = playbackState.status === 'playing';
  const isBuffering = playbackState.status === 'loading';

  return (
    <div className={styles.overlay}>
      <div className={styles.sheet}>
        <div className={styles.topBar}>
          <button type="button" className={styles.iconButton} onClick={closeNowPlaying} aria-label="Tutup">
            <Icon name="chevron-down" size={22} />
          </button>
          <span className={styles.topBarLabel}>Sedang Diputar</span>
          <button type="button" className={styles.iconButton} onClick={openQueue} aria-label="Buka antrean">
            <Icon name="queue" size={20} />
          </button>
        </div>

        <div className={styles.artSection}>
          {showLyrics ? (
            <LyricsPanel song={currentSong} />
          ) : (
            <LazyImage images={currentSong.image} quality="500x500" alt={currentSong.name} className={styles.art} />
          )}
        </div>

        <div className={styles.meta}>
          <div className={styles.metaText}>
            <span className={styles.title}>{currentSong.name}</span>
            <span className={styles.subtitle}>{primaryArtistNames(currentSong)}</span>
          </div>
          <LikeButton song={currentSong} />
        </div>

        <SeekBar duration={currentSong.duration} />

        <PlayerControls
          isPlaying={isPlaying}
          isBuffering={isBuffering}
          onTogglePlay={handleTogglePlay}
          onNext={handleNext}
          onPrevious={handlePrevious}
        />

        <div className={styles.bottomRow}>
          <button
            type="button"
            className={[styles.textButton, showLyrics ? styles.textButtonActive : ''].join(' ')}
            onClick={() => setShowLyrics((value) => !value)}
          >
            Lirik
          </button>
          <div className={styles.volumeRow}>
            <Icon name={volume === 0 ? 'volume-mute' : 'volume'} size={16} />
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
    </div>
  );
}
