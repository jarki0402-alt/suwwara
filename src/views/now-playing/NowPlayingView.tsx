import { bestImageUrl, primaryArtistNames } from '../../api/mappers';
import { ArtistLinks } from '../../components/ArtistLinks/ArtistLinks';
import { useConnectStore } from '../../connect/connectStore';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { LikeButton } from '../../components/LikeButton/LikeButton';
import { useIdleMouse } from '../../hooks/useIdleMouse';
import { usePlayback } from '../../playback/PlaybackContext';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { QueueView } from '../queue/QueueView';
import { ArtistInfo } from './ArtistInfo';
import { FullscreenControls } from './FullscreenControls';
import { LyricsPanel } from './LyricsPanel';
import styles from './NowPlayingView.module.css';
import { PlayerControls } from './PlayerControls';
import { SeekBar } from './SeekBar';

const IDLE_TIMEOUT_MS = 2500;

export function NowPlayingView() {
  const isOpen = useUiStore((state) => state.isNowPlayingOpen);
  const isQueueOpen = useUiStore((state) => state.isQueueOpen);
  const isFullscreen = useUiStore((state) => state.isNowPlayingFullscreen);
  const closeNowPlaying = useUiStore((state) => state.closeNowPlaying);
  const closeFullscreenLyrics = useUiStore((state) => state.closeFullscreenLyrics);
  const isDesktop = useIsDesktop();
  const openQueue = useUiStore((state) => state.openQueue);
  const openConnectSheet = useUiStore((state) => state.openConnectSheet);
  const hasOtherDevices = useConnectStore((state) => state.devices.length > 1);
  const showLyrics = useUiStore((state) => state.isLyricsOpen);
  const toggleLyrics = useUiStore((state) => state.toggleLyrics);

  const volume = useSettingsStore((state) => state.volume);
  const setVolume = useSettingsStore((state) => state.setVolume);

  const { currentSong, playbackState, handleTogglePlay, handleNext, handlePrevious } = usePlayback();

  // Only listens for mouse/keyboard activity while fullscreen is actually
  // open (see useIdleMouse's own `active` param) — docked-panel/mobile-sheet
  // controls never fade, this is strictly a fullscreen-mode thing, matching
  // a video player's fullscreen auto-hide chrome.
  const isIdle = useIdleMouse(isFullscreen, IDLE_TIMEOUT_MS);
  const chromeHidden = isFullscreen && isIdle;

  if (!isOpen || !currentSong) return null;

  if (isQueueOpen) {
    return (
      <div className={[styles.overlay, isFullscreen ? styles.overlayFullscreen : ''].join(' ')}>
        <div className={styles.queueSheet}>
          <QueueView />
        </div>
      </div>
    );
  }

  const isPlaying = playbackState.status === 'playing';
  const isBuffering = playbackState.status === 'loading';
  const ambientUrl = bestImageUrl(currentSong.image, '500x500');
  // Desktop's docked panel closes back to "not open at all" — but the same
  // chevron in fullscreen mode should only step back down to the docked
  // panel (closeFullscreenLyrics), not dismiss Now Playing entirely; the
  // panel is still the "default" state fullscreen was expanded from.
  const handleBack = isFullscreen ? closeFullscreenLyrics : closeNowPlaying;

  return (
    <div className={[styles.overlay, isFullscreen ? styles.overlayFullscreen : '', chromeHidden ? styles.cursorHidden : ''].join(' ')}>
      <div className={styles.sheet}>
        {ambientUrl && <img src={ambientUrl} alt="" aria-hidden="true" className={styles.ambientBackdrop} />}
        <div className={styles.ambientScrim} aria-hidden="true" />
        <div className={[styles.topBar, chromeHidden ? styles.chromeHidden : ''].join(' ')}>
          <button type="button" className={styles.iconButton} onClick={handleBack} aria-label="Tutup">
            <Icon name="chevron-down" size={22} />
          </button>
          <span className={styles.topBarLabel}>Sedang Diputar</span>
          <span className={styles.topBarActions}>
            {hasOtherDevices && (
              <button type="button" className={styles.iconButton} onClick={openConnectSheet} aria-label="Perangkat">
                <Icon name="devices" size={20} />
              </button>
            )}
            <button type="button" className={styles.iconButton} onClick={openQueue} aria-label="Buka antrean">
              <Icon name="queue" size={20} />
            </button>
          </span>
        </div>

        <div className={styles.artSection}>
          {showLyrics ? (
            <LyricsPanel song={currentSong} isFullscreen={isFullscreen} />
          ) : (
            <LazyImage images={currentSong.image} quality="500x500" alt={currentSong.name} className={styles.art} />
          )}
        </div>

        {/* Folded into FullscreenControls' own left section in fullscreen
            mode instead — title/artist/like there sit inline with the rest
            of the transport bar, not as a separate row above it. */}
        {!isFullscreen && (
          <div className={styles.meta}>
            <div className={styles.metaText}>
              <span className={styles.title}>{currentSong.name}</span>
              <span className={styles.subtitle}>
                <ArtistLinks song={currentSong} />
              </span>
            </div>
            <LikeButton song={currentSong} />
          </div>
        )}

        {/* Desktop only: on a phone the sheet is just the art and the controls. (The artist's own page has the bio.) */}
        {/* Not shown while viewing lyrics/fullscreen — a same-artist bio
            reads oddly wedged between lyric lines, and fullscreen is meant to
            be lyrics-focused with nothing else competing for attention. */}
        {!showLyrics && !isFullscreen && isDesktop && <ArtistInfo artistName={primaryArtistNames(currentSong)} />}

        {isFullscreen ? (
          <div className={[styles.fullscreenBar, chromeHidden ? styles.chromeHidden : ''].join(' ')}>
            <FullscreenControls
              song={currentSong}
              isPlaying={isPlaying}
              isBuffering={isBuffering}
              onTogglePlay={handleTogglePlay}
              onNext={handleNext}
              onPrevious={handlePrevious}
            />
          </div>
        ) : (
          /* Hidden at desktop (see .mobileOnlyControls in NowPlayingView.module.css) —
             MiniPlayer's own seek bar + transport row (desktop only) are the single
             source of these once the docked panel exists alongside it; having both
             visible at once was the literal "tombol tumpang tindih" duplicate-controls
             complaint this replaces. */
          <div className={styles.mobileOnlyControls}>
            <SeekBar duration={currentSong.duration} />

            <PlayerControls
              isPlaying={isPlaying}
              isBuffering={isBuffering}
              onTogglePlay={handleTogglePlay}
              onNext={handleNext}
              onPrevious={handlePrevious}
            />

            <div className={styles.bottomRow}>
              <button type="button" className={[styles.textButton, showLyrics ? styles.textButtonActive : ''].join(' ')} onClick={toggleLyrics}>
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
        )}
      </div>
    </div>
  );
}
