import { canSetVolume } from '../audio-engine/volumeSupport';
import { useEffect, useRef } from 'react';
import { ArtistLinks } from '../components/ArtistLinks/ArtistLinks';
import { useConnectStore } from '../connect/connectStore';
import { audioEngine } from '../audio-engine/AudioEngine';
import { frameTicker } from '../audio-engine/frameTicker';
import { Icon } from '../components/Icon/Icon';
import { LazyImage } from '../components/Image/LazyImage';
import { ProgressBar, type ProgressBarHandle } from '../components/ProgressBar/ProgressBar';
import { useBubbleRipple } from '../hooks/useBubbleRipple';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useLiquidRim } from '../hooks/useLiquidRim';
import { useMiniPlayerGestures } from './useMiniPlayerGestures';
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
  const isDockCollapsed = useUiStore((state) => state.isDockCollapsed);
  const { currentSong, playbackState, handleTogglePlay, handleNext, handlePrevious } = usePlayback();
  const shuffle = useQueueStore((state) => state.shuffle);
  const repeatMode = useQueueStore((state) => state.repeatMode);
  const volume = useSettingsStore((state) => state.volume);
  const setVolume = useSettingsStore((state) => state.setVolume);
  const progressBarRef = useRef<ProgressBarHandle>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isDesktop = useIsDesktop();
  // Phone only: on desktop the bar spans the window, and swelling all of it for one button reads wrong.
  const glass = useLiquidRim(wrapperRef, currentSong !== null, { grow: 0.04 });
  const mainRef = useRef<HTMLButtonElement>(null);
  useMiniPlayerGestures(wrapperRef, mainRef, {
    enabled: !isDesktop && currentSong !== null,
    onOpen: openNowPlaying,
    onNext: handleNext,
    onPrevious: handlePrevious,
  });
  // One ripple-hook instance per button (fixed set, not a loop) — see useBubbleRipple's own
  // note on why this can't be a single shared instance.
  const shuffleRipple = useBubbleRipple<HTMLButtonElement>();
  const prevRipple = useBubbleRipple<HTMLButtonElement>();
  const playRipple = useBubbleRipple<HTMLButtonElement>();
  const nextRipple = useBubbleRipple<HTMLButtonElement>();
  const repeatRipple = useBubbleRipple<HTMLButtonElement>();
  const connectRipple = useBubbleRipple<HTMLButtonElement>();
  const lyricsRipple = useBubbleRipple<HTMLButtonElement>();
  const expandRipple = useBubbleRipple<HTMLButtonElement>();

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
    <div
      ref={wrapperRef}
      className={[styles.wrapper, 'liquid-glass', isDockCollapsed ? styles.docked : ''].join(' ')}
      data-player-bar=""
      {...(isDesktop ? {} : glass)}
    >
      <div className={styles.progressTrack}>
        <ProgressBar ariaLabel="Posisi lagu" ref={progressBarRef} compact />
      </div>

      <button ref={mainRef} type="button" className={styles.main} onClick={openNowPlaying}>
        <LazyImage images={currentSong.image} quality="50x50" alt={currentSong.name} className={styles.art} />
        <span className={styles.text}>
          <span className={styles.title}>{currentSong.name}</span>
          <span className={styles.subtitle}><ArtistLinks song={currentSong} /></span>
        </span>
      </button>

      <div className={styles.centerColumn}>
        <div className={styles.actions}>
          <button
            ref={shuffleRipple.ref}
            type="button"
            className={[styles.actionButton, styles.desktopOnly, 'glass-ripple-host', shuffle ? styles.actionButtonActive : ''].join(' ')}
            onClick={toggleShuffle}
            onPointerDown={shuffleRipple.onPointerDown}
            aria-label="Acak antrean"
            aria-pressed={shuffle}
          >
            <Icon name="shuffle" size={20} />
          </button>
          <button
            ref={prevRipple.ref}
            type="button"
            className={[styles.actionButton, styles.desktopOnly, 'glass-ripple-host'].join(' ')}
            onClick={handlePrevious}
            onPointerDown={prevRipple.onPointerDown}
            aria-label="Lagu sebelumnya"
          >
            <Icon name="previous" size={20} />
          </button>
          <button
            ref={playRipple.ref}
            type="button"
            className={[styles.actionButton, styles.playButton, 'glass-ripple-host'].join(' ')}
            onClick={handleTogglePlay}
            onPointerDown={playRipple.onPointerDown}
            aria-label={isPlaying ? 'Jeda' : 'Putar'}
          >
            <Icon name={isPlaying || isBuffering ? 'pause' : 'play'} size={22} />
          </button>
          <button
            ref={nextRipple.ref}
            type="button"
            className={[styles.actionButton, styles.nextButton, 'glass-ripple-host'].join(' ')}
            onClick={handleNext}
            onPointerDown={nextRipple.onPointerDown}
            aria-label="Lagu berikutnya"
          >
            <Icon name="next" size={22} />
          </button>
          <button
            ref={repeatRipple.ref}
            type="button"
            className={[styles.actionButton, styles.desktopOnly, 'glass-ripple-host', repeatMode !== 'off' ? styles.actionButtonActive : ''].join(' ')}
            onClick={cycleRepeat}
            onPointerDown={repeatRipple.onPointerDown}
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
          ref={connectRipple.ref}
          type="button"
          className={[styles.iconButton, 'glass-ripple-host', isConnectSheetOpen || isControllingRemote ? styles.iconButtonActive : ''].join(' ')}
          onClick={isConnectSheetOpen ? closeConnectSheet : openConnectSheet}
          onPointerDown={connectRipple.onPointerDown}
          aria-label="Perangkat"
          aria-pressed={isConnectSheetOpen}
        >
          <Icon name="devices" size={20} />
        </button>
        <button
          ref={lyricsRipple.ref}
          type="button"
          className={[styles.iconButton, 'glass-ripple-host', isLyricsOpen ? styles.iconButtonActive : ''].join(' ')}
          onClick={handleLyricsClick}
          onPointerDown={lyricsRipple.onPointerDown}
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
        <button
          ref={expandRipple.ref}
          type="button"
          className={[styles.iconButton, 'glass-ripple-host'].join(' ')}
          onClick={openFullscreenLyrics}
          onPointerDown={expandRipple.onPointerDown}
          aria-label="Perbesar layar penuh"
        >
          <Icon name="expand" size={20} />
        </button>
      </div>
    </div>
  );
}
