import { canSetVolume } from '../audio-engine/volumeSupport';
import { useEffect, useRef } from 'react';
import { ArtistLinks } from '../components/ArtistLinks/ArtistLinks';
import { useConnectStore } from '../connect/connectStore';
import { audioEngine } from '../audio-engine/AudioEngine';
import { frameTicker } from '../audio-engine/frameTicker';
import { Icon } from '../components/Icon/Icon';
import { LazyImage } from '../components/Image/LazyImage';
import { ProgressBar, type ProgressBarHandle } from '../components/ProgressBar/ProgressBar';
import { cycleRepeat, toggleShuffle } from '../jam/jamQueueActions';
import { usePlayback } from '../playback/PlaybackContext';
import { useQueueStore } from '../stores/queueStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUiStore } from '../stores/uiStore';
import { SeekBar } from '../views/now-playing/SeekBar';
import styles from './MiniPlayer.module.css';

export function MiniPlayer() {
  const openNowPlaying = useUiStore((state) => state.openNowPlaying);
  const openConnectSheet = useUiStore((state) => state.openConnectSheet);
  const closeConnectSheet = useUiStore((state) => state.closeConnectSheet);
  const isConnectSheetOpen = useUiStore((state) => state.isConnectSheetOpen);
  const isControllingRemote = useConnectStore((state) => state.controllingRef !== null);
  const isNowPlayingOpen = useUiStore((state) => state.isNowPlayingOpen);
  const isLyricsOpen = useUiStore((state) => state.isLyricsOpen);
  const toggleLyrics = useUiStore((state) => state.toggleLyrics);
  const setLyricsOpen = useUiStore((state) => state.setLyricsOpen);
  const openFullscreenLyrics = useUiStore((state) => state.openFullscreenLyrics);
  const { currentSong, playbackState, handleTogglePlay, handleNext, handlePrevious } = usePlayback();
  const shuffle = useQueueStore((state) => state.shuffle);
  const repeatMode = useQueueStore((state) => state.repeatMode);
  const volume = useSettingsStore((state) => state.volume);
  const setVolume = useSettingsStore((state) => state.setVolume);
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

  // Clicking this used to just flip isLyricsOpen — invisible if the docked
  // panel wasn't already open (NowPlayingView returns null entirely while
  // closed, see its own isOpen check), so lyrics only ever appeared after
  // separately clicking the song info button first. Opening the panel here
  // too means one click is enough, matching Spotify's own lyrics-icon
  // behavior. Only opens (never closes) — closeNowPlaying already resets
  // isLyricsOpen, so a fresh open-via-this-button always lands on lyrics.
  const handleLyricsClick = () => {
    // The Perangkat panel docks in the same column: switching to lyrics means leaving it.
    if (isConnectSheetOpen) closeConnectSheet();
    if (!isNowPlayingOpen) {
      openNowPlaying();
      setLyricsOpen(true);
    } else {
      toggleLyrics();
    }
  };

  return (
    <div className={styles.wrapper} data-player-bar="">
      <div className={styles.progressTrack}>
        <ProgressBar ariaLabel="Posisi lagu" ref={progressBarRef} compact />
      </div>

      <button type="button" className={styles.main} onClick={openNowPlaying}>
        <LazyImage images={currentSong.image} quality="50x50" alt={currentSong.name} className={styles.art} />
        <span className={styles.text}>
          <span className={styles.title}>{currentSong.name}</span>
          <span className={styles.subtitle}><ArtistLinks song={currentSong} /></span>
        </span>
      </button>

      <div className={styles.centerColumn}>
        <div className={styles.actions}>
          <button
            type="button"
            className={[styles.actionButton, styles.desktopOnly, shuffle ? styles.actionButtonActive : ''].join(' ')}
            onClick={toggleShuffle}
            aria-label="Acak antrean"
            aria-pressed={shuffle}
          >
            <Icon name="shuffle" size={20} />
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
            <Icon name={isPlaying || isBuffering ? 'pause' : 'play'} size={22} />
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
            <Icon name={repeatMode === 'one' ? 'repeat-one' : 'repeat'} size={20} />
          </button>
        </div>

        {/* Desktop only (see .desktopSeekBar), below the transport buttons like Spotify's bottom bar — the docked Now Playing panel no
            longer has its own seek bar (that duplicated this one, see
            NowPlayingView's .mobileOnlyControls), so this is the single
            interactive seek bar once a song is loaded on desktop. */}
        <div className={styles.desktopSeekBar}>
          <SeekBar duration={currentSong.duration} horizontal />
        </div>
      </div>

      {/* Desktop only (see .rightControls) — mirrors Spotify's own bottom-bar
          right cluster (lyrics/volume/fullscreen). Mobile already reaches
          lyrics and volume from inside the fullscreen Now Playing sheet
          itself, so it doesn't need a mini-player-level shortcut to them. */}
      <div className={styles.rightControls}>
        {/* Always shown, like Spotify's Connect icon: the panel it opens also explains how to link another device. */}
        <button
          type="button"
          className={[styles.iconButton, isConnectSheetOpen || isControllingRemote ? styles.iconButtonActive : ''].join(' ')}
          onClick={isConnectSheetOpen ? closeConnectSheet : openConnectSheet}
          aria-label="Perangkat"
          aria-pressed={isConnectSheetOpen}
        >
          <Icon name="devices" size={20} />
        </button>
        <button
          type="button"
          className={[styles.iconButton, isLyricsOpen ? styles.iconButtonActive : ''].join(' ')}
          onClick={handleLyricsClick}
          aria-label="Tampilkan lirik"
          aria-pressed={isLyricsOpen}
        >
          <Icon name="lyrics" size={20} />
        </button>
        {canSetVolume && (
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
        )}
        <button type="button" className={styles.iconButton} onClick={openFullscreenLyrics} aria-label="Perbesar layar penuh">
          <Icon name="expand" size={20} />
        </button>
      </div>
    </div>
  );
}
