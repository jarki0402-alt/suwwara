import { useEffect, useRef, type CSSProperties } from 'react';
import { MarqueeText } from '../../components/MarqueeText/MarqueeText';
import { bestImageUrl, primaryArtistNames } from '../../api/mappers';
import { ArtistLinks } from '../../components/ArtistLinks/ArtistLinks';
import { useConnectStore } from '../../connect/connectStore';
import { canSetVolume } from '../../audio-engine/volumeSupport';
import { remoteSetVolume } from '../../connect/remote';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { useJamStatus } from '../../jam/useJamStatus';
import { DownloadButton } from '../../components/DownloadButton/DownloadButton';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { LikeButton } from '../../components/LikeButton/LikeButton';
import { useToast } from '../../components/Toast/ToastProvider';
import { useBubbleRipple } from '../../hooks/useBubbleRipple';
import { useIdleMouse } from '../../hooks/useIdleMouse';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';
import { usePlayback } from '../../playback/PlaybackContext';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { useT } from '../../i18n/i18n';
import { isDocumentFullscreen, leaveFullscreen, onDocumentFullscreenChange } from '../../utils/documentFullscreen';
import { QueueView } from '../queue/QueueView';
import { ArtistInfo } from './ArtistInfo';
import { FullscreenControls } from './FullscreenControls';
import { FullscreenStage, JamCard, UpNextList } from './FullscreenStage';
import { LyricsPanel } from './LyricsPanel';
import { EpisodeNextCard } from '../../podcast/components/EpisodeNextCard';
import { EpisodeOverviewPanel } from '../../podcast/components/EpisodeOverviewPanel';
import styles from './NowPlayingView.module.css';
import { PlayerControls } from './PlayerControls';
import { SeekBar } from './SeekBar';
import { audioEngine } from '../../audio-engine/AudioEngine';
import { songClock, useVideoMode } from '../../video/musicVideo';
import { MusicVideoToggle } from '../../video/MusicVideoToggle';
import { openTheater } from '../../video/theater';
import { useMusicVideo } from '../../video/useMusicVideo';
import { VideoSurface } from '../../video/VideoSurface';

// Synced video: the song itself is waiting for data, so the picture gives up its share of the connection.
const songStarving = () => audioEngine.getSnapshot().status === 'loading';

const IDLE_TIMEOUT_MS = 2500;

export function NowPlayingView() {
  const t = useT();
  const isOpen = useUiStore((state) => state.isNowPlayingOpen);
  const isQueueOpen = useUiStore((state) => state.isQueueOpen);
  const isFullscreen = useUiStore((state) => state.isNowPlayingFullscreen);
  const closeNowPlaying = useUiStore((state) => state.closeNowPlaying);
  const openJamSheet = useUiStore((state) => state.openJamSheet);
  const closeFullscreenLyrics = useUiStore((state) => state.closeFullscreenLyrics);
  const isDesktop = useIsDesktop();
  const jam = useJamStatus();
  const openQueue = useUiStore((state) => state.openQueue);
  const openConnectSheet = useUiStore((state) => state.openConnectSheet);
  const hasOtherDevices = useConnectStore((state) => state.devices.length > 1);
  const isControllingRemote = useConnectStore((state) => state.controllingRef !== null);
  const showLyrics = useUiStore((state) => state.isLyricsOpen);
  const toggleLyrics = useUiStore((state) => state.toggleLyrics);

  const localVolume = useSettingsStore((state) => state.volume);
  const setLocalVolume = useSettingsStore((state) => state.setVolume);

  const { currentSong, playbackState, remoteDevice, handleTogglePlay, handleNext, handlePrevious } = usePlayback();
  // Only looked up while Now Playing is open: this component stays mounted, closed, for the whole session.
  const video = useMusicVideo(isOpen ? currentSong : null);
  const videoWanted = useVideoMode((state) => state.wanted);
  const setVideoWanted = useVideoMode((state) => state.setWanted);
  const theaterOpen = useUiStore((state) => state.videoTheater !== null);
  const { showToast } = useToast();
  // As a remote, the slider is the other device's (shown only where that device lets a web page set it).
  const volume = remoteDevice ? (remoteDevice.state?.volume ?? 1) : localVolume;
  const setVolume = remoteDevice ? remoteSetVolume : setLocalVolume;
  const showVolume = remoteDevice ? remoteDevice.state?.canSetVolume === true : canSetVolume;
  const closeQueue = useUiStore((state) => state.closeQueue);

  // Phone only: pull the sheet down to close it (the queue, when it's showing, back to Now Playing).
  // Lyrics and the queue keep scrolling as usual; the pull only starts once they're at the top.
  const overlayRef = useRef<HTMLDivElement>(null);
  const queueSheetRef = useRef<HTMLDivElement>(null);
  const sheetOpen = isOpen && currentSong !== null && !isDesktop;
  useSwipeGesture(overlayRef, { direction: 'down', enabled: sheetOpen && !isQueueOpen, onCommit: closeNowPlaying });
  useSwipeGesture(queueSheetRef, { direction: 'down', enabled: sheetOpen && isQueueOpen, onCommit: closeQueue });

  // Real fullscreen follows the fullscreen view both ways: leaving the view (chevron, Back, closing Now Playing) leaves
  // the fullscreen the view itself started (not the whole-app one, which stays); leaving fullscreen from outside (Esc,
  // the browser's own UI) leaves the view, so the window is never stuck fullscreen showing the docked panel.
  useEffect(() => {
    if (!isFullscreen) leaveFullscreen('view');
  }, [isFullscreen]);
  useEffect(
    () =>
      onDocumentFullscreenChange(() => {
        if (!isDocumentFullscreen() && useUiStore.getState().isNowPlayingFullscreen) closeFullscreenLyrics();
      }),
    [closeFullscreenLyrics],
  );
  // Where the page couldn't go fullscreen (the view just fills the window), Esc still steps back out of it.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDocumentFullscreen()) closeFullscreenLyrics();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen, closeFullscreenLyrics]);

  // Only listens for mouse/keyboard activity while fullscreen is actually
  // open (see useIdleMouse's own `active` param) — docked-panel/mobile-sheet
  // controls never fade, this is strictly a fullscreen-mode thing, matching
  // a video player's fullscreen auto-hide chrome.
  const isIdle = useIdleMouse(isFullscreen, IDLE_TIMEOUT_MS);
  const chromeHidden = isFullscreen && isIdle;
  const backRipple = useBubbleRipple<HTMLButtonElement>();
  const queueRipple = useBubbleRipple<HTMLButtonElement>();
  const lyricsRipple = useBubbleRipple<HTMLButtonElement>();
  const devicesRipple = useBubbleRipple<HTMLButtonElement>();

  if (!isOpen || !currentSong) return null;

  if (isQueueOpen) {
    return (
      <div className={[styles.overlay, isFullscreen ? styles.overlayFullscreen : ''].join(' ')}>
        <div ref={queueSheetRef} className={styles.queueSheet}>
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
    <div
      ref={overlayRef}
      className={[
        styles.overlay,
        isFullscreen ? styles.overlayFullscreen : '',
        chromeHidden ? styles.cursorHidden : '',
        // Docked with the art showing (not lyrics): the panel scrolls as a whole, see .overlayArt.
        isDesktop && !isFullscreen && !showLyrics ? styles.overlayArt : '',
      ].join(' ')}
    >
      <div className={styles.sheet}>
        {ambientUrl && <img src={ambientUrl} alt="" aria-hidden="true" className={styles.ambientBackdrop} />}
        <div className={styles.ambientScrim} aria-hidden="true" />
        {/* An episode's "Berikutnya" in fullscreen: the stage's bottom-right corner, over whichever tab is showing. */}
        {isFullscreen && <EpisodeNextCard fullscreen />}
        {isFullscreen && isDesktop ? (
          <FullscreenStage song={currentSong} chromeHidden={chromeHidden} onMinimize={closeFullscreenLyrics} />
        ) : (
        <>
        <div className={[styles.topBar, chromeHidden ? styles.chromeHidden : ''].join(' ')}>
          <button
            ref={backRipple.ref}
            type="button"
            className={[styles.iconButton, 'glass-ripple-host'].join(' ')}
            onClick={handleBack}
            onPointerDown={backRipple.onPointerDown}
            aria-label={t('Tutup')}
          >
            <Icon name="chevron-down" size={22} />
          </button>
          {jam.active ? (
            <span className={[styles.topBarLabel, styles.topBarLabelJam].join(' ')}>
              <Icon name={jam.live ? 'users' : 'wifi-off'} size={15} />
              {jam.live ? t('Jam · {n} pendengar', { n: jam.count }) : jam.statusText}
            </span>
          ) : remoteDevice ? (
            <span className={[styles.topBarLabel, styles.topBarLabelRemote].join(' ')}>
              <Icon name="speaker" size={15} />
              {t('Memutar di {name}', { name: remoteDevice.name })}
            </span>
          ) : video ? (
            <MusicVideoToggle song={currentSong} video={video} />
          ) : (
            <span className={styles.topBarLabel}>{t('Sedang Diputar')}</span>
          )}
          <span className={styles.topBarActions}>
            <button
              ref={queueRipple.ref}
              type="button"
              className={[styles.iconButton, 'glass-ripple-host'].join(' ')}
              onClick={openQueue}
              onPointerDown={queueRipple.onPointerDown}
              aria-label={t('Buka antrean')}
            >
              <Icon name="queue" size={20} />
            </button>
          </span>
        </div>

        <div className={styles.artSection}>
          {showLyrics ? (
            <LyricsPanel song={currentSong} isFullscreen={isFullscreen} />
          ) : video?.synced && videoWanted ? (
            <VideoSurface
              key={video.videoId}
              videoId={video.videoId}
              clock={songClock}
              posterUrl={ambientUrl}
              active={!theaterOpen}
              audioStarving={songStarving}
              className={styles.videoArt}
              onUnavailable={(reason) => {
                setVideoWanted(false);
                showToast(reason === 'slow' ? t('Koneksi terlalu lambat untuk video, kembali ke lagu.') : t('Video tidak bisa diputar sekarang.'));
              }}
            >
              <button type="button" className={styles.videoExpand} onClick={() => openTheater(currentSong, video)} aria-label={t('Layar penuh')}>
                <Icon name="fullscreen" size={18} />
              </button>
            </VideoSurface>
          ) : (
            <LazyImage
              images={currentSong.image}
              quality="500x500"
              alt={currentSong.name}
              className={[styles.art, currentSong.kind === 'episode' ? styles.episodeArt : ''].join(' ')}
            />
          )}
        </div>

        {/* Folded into FullscreenControls' own left section in fullscreen
            mode instead — title/artist/like there sit inline with the rest
            of the transport bar, not as a separate row above it. */}
        {!isFullscreen && <EpisodeNextCard inline />}
        {!isFullscreen && (
          <div className={styles.meta}>
            <div className={styles.metaText}>
              <span className={styles.title}>
                <MarqueeText text={currentSong.name} />
              </span>
              <span className={styles.subtitle}>
                <ArtistLinks song={currentSong} />
              </span>
            </div>
            <span className={styles.metaActions}>
              <LikeButton song={currentSong} size={24} />
              <DownloadButton song={currentSong} size={24} />
            </span>
          </div>
        )}

        {/* Desktop only: on a phone the sheet is just the art and the controls. (The artist's own page has the bio.) */}
        {/* Not shown while viewing lyrics/fullscreen — a same-artist bio
            reads oddly wedged between lyric lines, and fullscreen is meant to
            be lyrics-focused with nothing else competing for attention. */}
        {/* Docked panel (2026-11 redesign): what plays next and the Jam card, like the design's "Sedang diputar" panel. */}
        {!showLyrics && !isFullscreen && isDesktop && currentSong.kind !== 'episode' && (
          <div className={styles.dockedExtras}>
            <div className={styles.upNextBox}>
              <span className={styles.upNextHeading}>{t('Berikutnya')}</span>
              <UpNextList limit={3} compact />
            </div>
            <JamCard />
          </div>
        )}
        {!showLyrics && !isFullscreen && isDesktop && currentSong.kind !== 'episode' && <ArtistInfo artistName={primaryArtistNames(currentSong)} />}
        {/* An episode's overview (channel, description, its queue, similar episodes) in the docked panel. */}
        {!showLyrics && !isFullscreen && isDesktop && currentSong.kind === 'episode' && (
          <div className={styles.dockedExtras}>
            <EpisodeOverviewPanel song={currentSong} />
            <JamCard />
          </div>
        )}

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
              <div className={styles.bottomIcons}>
                <button
                  ref={lyricsRipple.ref}
                  type="button"
                  className={[styles.bottomIconButton, 'glass-ripple-host', showLyrics ? styles.bottomIconButtonActive : ''].join(' ')}
                  onClick={toggleLyrics}
                  onPointerDown={lyricsRipple.onPointerDown}
                  aria-label={t('Tampilkan lirik')}
                  aria-pressed={showLyrics}
                >
                  <Icon name="lyrics" size={24} />
                </button>
                {/* Always here (not only once another device is online): the Perangkat sheet also says how to link one. */}
                <button
                  ref={devicesRipple.ref}
                  type="button"
                  className={[styles.bottomIconButton, 'glass-ripple-host', isControllingRemote ? styles.bottomIconButtonActive : ''].join(' ')}
                  onClick={openConnectSheet}
                  onPointerDown={devicesRipple.onPointerDown}
                  aria-label={t('Perangkat')}
                >
                  <Icon name="devices" size={24} />
                  {hasOtherDevices && <span className={styles.deviceDot} aria-hidden="true" />}
                </button>
                {/* Listening together is one tap from the song itself (2026-11 redesign), not only from Beranda. */}
                <button
                  type="button"
                  className={[styles.bottomIconButton, jam.active ? styles.bottomIconButtonActive : ''].join(' ')}
                  onClick={openJamSheet}
                  aria-label={jam.active ? t('Kelola Jam') : t('Dengar bareng (Jam)')}
                >
                  <Icon name="users" size={24} />
                </button>
              </div>
              {showVolume && (
                <div className={styles.volumeRow}>
                  <Icon name={volume === 0 ? 'volume-mute' : 'volume'} size={24} />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(volume * 100)}
                    onChange={(event) => setVolume(Number(event.target.value) / 100)}
                    className={styles.volumeSlider}
                    style={{ '--fill': `${Math.round(volume * 100)}%` } as CSSProperties}
                    aria-label={t('Volume')}
                  />
                </div>
              )}
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}
