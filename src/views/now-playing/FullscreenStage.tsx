import { useRef, useState, type CSSProperties } from 'react';
import { MarqueeText } from '../../components/MarqueeText/MarqueeText';
import { EpisodeOverviewPanel } from '../../podcast/components/EpisodeOverviewPanel';
import type { Song } from '../../api/types';
import { bestImageUrl, primaryArtistNames } from '../../api/mappers';
import { ArtistLinks } from '../../components/ArtistLinks/ArtistLinks';
import { DownloadButton } from '../../components/DownloadButton/DownloadButton';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { JamAvatars } from '../../components/JamIndicator/JamIndicator';
import { LikeButton } from '../../components/LikeButton/LikeButton';
import { useToast } from '../../components/Toast/ToastProvider';
import { playAtPosition, removeFromQueue, reorder } from '../../jam/jamQueueActions';
import { SongMenu } from '../../components/SongMenu/SongMenu';
import { copyJamLink, jamShareLink } from '../../jam/shareJam';
import { useJamStatus } from '../../jam/useJamStatus';
import { usePlayback } from '../../playback/PlaybackContext';
import { useJamStore } from '../../stores/jamStore';
import { useQueueStore } from '../../stores/queueStore';
import { useUiStore } from '../../stores/uiStore';
import { formatTime } from '../../utils/formatTime';
import { msg, useT } from '../../i18n/i18n';
import { LyricsPanel } from './LyricsPanel';
import { PlayerControls } from './PlayerControls';
import { SeekBar } from './SeekBar';
import styles from './FullscreenStage.module.css';
import { audioEngine } from '../../audio-engine/AudioEngine';
import { songClock } from '../../video/musicVideo';
import { openTheater } from '../../video/theater';
import { useMusicVideo } from '../../video/useMusicVideo';
import { VideoSurface } from '../../video/VideoSurface';

/** The songs after the current one, with their place in the play order (what playAtPosition takes). */
function useUpNext(limit: number): { song: Song; orderPosition: number }[] {
  const queue = useQueueStore((state) => state.queue);
  const order = useQueueStore((state) => state.order);
  const position = useQueueStore((state) => state.position);
  const out: { song: Song; orderPosition: number }[] = [];
  for (let i = position + 1; i < order.length && out.length < limit; i += 1) {
    const song = queue[order[i]];
    if (song) out.push({ song, orderPosition: i });
  }
  return out;
}

/** "Berikutnya": the next few songs; a tap plays one (in a Jam, for the whole room, via jamQueueActions). */
export function UpNextList({ limit, compact = false }: { limit: number; compact?: boolean }) {
  const t = useT();
  const upNext = useUpNext(limit);
  if (upNext.length === 0) return <p className={styles.empty}>{t('Belum ada lagu berikutnya di antrean.')}</p>;
  return (
    <ol className={styles.upNext}>
      {upNext.map(({ song, orderPosition }) => (
        <li key={`${orderPosition}-${song.id}`}>
          <button type="button" className={[styles.upNextRow, compact ? styles.upNextCompact : ''].join(' ')} onClick={() => playAtPosition(orderPosition)}>
            <LazyImage images={song.image} quality="50x50" alt="" className={styles.upNextArt} />
            <span className={styles.upNextText}>
              <span className={styles.upNextTitle}>{song.name}</span>
              <span className={styles.upNextArtist}>{primaryArtistNames(song)}</span>
            </span>
            {!compact && song.duration > 0 && <span className={styles.upNextTime}>{formatTime(song.duration)}</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}

// Long queues (a 30-song radio, a whole playlist) are capped on screen: the stage is for what plays next.
const STAGE_QUEUE_LIMIT = 60;

/**
 * The fullscreen Antrean tab: what plays next, with the same row actions as every other song list (like, the ⋯ song
 * menu, plus "Hapus dari Antrean") and a grip to drag a song to another place. The drag works like QueueView's: the
 * dragged row follows the pointer imperatively (no React render per pointermove), only the target slot goes through
 * state, and the reorder is committed once on release (in a Jam, for the whole room, via jamQueueActions).
 */
export function StageQueue() {
  const t = useT();
  const queue = useQueueStore((state) => state.queue);
  const order = useQueueStore((state) => state.order);
  const position = useQueueStore((state) => state.position);
  const firstUpcoming = position + 1;
  const upcoming = order.slice(firstUpcoming, firstUpcoming + STAGE_QUEUE_LIMIT);

  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const rowHeight = useRef(0);
  const startY = useRef(0);
  const dragFrom = useRef<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  // The row height for the other rows' shift, read during render: state, set once per drag (the ref is for the
  // per-pointermove maths, which must not wait for a render).
  const [rowHeightPx, setRowHeightPx] = useState(0);

  const startDrag = (index: number, clientY: number) => {
    rowHeight.current = rowRefs.current[index]?.getBoundingClientRect().height ?? 0;
    setRowHeightPx(rowHeight.current);
    startY.current = clientY;
    dragFrom.current = index;
    setDragIndex(index);
    setTargetIndex(index);
  };
  const moveDrag = (clientY: number) => {
    const from = dragFrom.current;
    if (from === null || rowHeight.current === 0) return;
    const delta = clientY - startY.current;
    const row = rowRefs.current[from];
    if (row) row.style.transform = `translateY(${delta}px)`;
    const next = Math.min(Math.max(from + Math.round(delta / rowHeight.current), 0), upcoming.length - 1);
    setTargetIndex((prev) => (prev === next ? prev : next));
  };
  const endDrag = () => {
    const from = dragFrom.current;
    if (from !== null) {
      const row = rowRefs.current[from];
      if (row) row.style.transform = '';
      if (targetIndex !== null && targetIndex !== from) reorder(firstUpcoming + from, firstUpcoming + targetIndex);
    }
    dragFrom.current = null;
    setDragIndex(null);
    setTargetIndex(null);
  };
  const shiftFor = (index: number): CSSProperties | undefined => {
    if (dragIndex === null || targetIndex === null || index === dragIndex) return undefined;
    const inRange = dragIndex < targetIndex ? index > dragIndex && index <= targetIndex : index < dragIndex && index >= targetIndex;
    if (!inRange) return undefined;
    return { transform: `translateY(${dragIndex < targetIndex ? -rowHeightPx : rowHeightPx}px)`, transition: 'transform 150ms ease' };
  };

  if (upcoming.length === 0) return <p className={styles.empty}>{t('Belum ada lagu berikutnya di antrean.')}</p>;
  return (
    <ol className={styles.upNext}>
      {upcoming.map((queueIndex, index) => {
        const song = queue[queueIndex];
        if (!song) return null;
        const orderPosition = firstUpcoming + index;
        return (
          <li
            key={`${orderPosition}-${song.id}`}
            ref={(node) => {
              rowRefs.current[index] = node;
            }}
            className={[styles.queueRow, index === dragIndex ? styles.queueRowDragging : ''].join(' ')}
            style={shiftFor(index)}
          >
            <button
              type="button"
              className={styles.grip}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                startDrag(index, event.clientY);
              }}
              onPointerMove={(event) => moveDrag(event.clientY)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              aria-label={t('Geser {name} untuk mengubah urutan', { name: song.name })}
            >
              <Icon name="grip" size={18} />
            </button>
            <button type="button" className={styles.upNextRow} onClick={() => playAtPosition(orderPosition)}>
              <LazyImage images={song.image} quality="50x50" alt="" className={styles.upNextArt} />
              <span className={styles.upNextText}>
                <span className={styles.upNextTitle}>{song.name}</span>
                <span className={styles.upNextArtist}>{primaryArtistNames(song)}</span>
              </span>
              {song.duration > 0 && <span className={styles.upNextTime}>{formatTime(song.duration)}</span>}
            </button>
            <span className={styles.rowActions}>
              <LikeButton song={song} />
              <SongMenu song={song} onRemoveFromQueue={() => removeFromQueue(orderPosition)} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The Jam card: who is listening and the invite, while in one; otherwise the way to start one. Shown in the docked panel
 * and the fullscreen stage (2026-11 redesign), so listening together is never more than a tap away from the song.
 */
export function JamCard() {
  const t = useT();
  const jam = useJamStatus();
  const roomId = useJamStore((state) => state.roomId);
  const openJamSheet = useUiStore((state) => state.openJamSheet);
  const { showToast } = useToast();

  if (!jam.active || !roomId) {
    return (
      <button type="button" className={[styles.jamCard, styles.jamCardStart].join(' ')} onClick={openJamSheet}>
        <span className={styles.jamIcon}>
          <Icon name="users" size={20} />
        </span>
        <span className={styles.jamText}>
          <span className={styles.jamTitle}>{t('Dengar bareng')}</span>
          <span className={styles.jamSub}>{t('Ajak teman ke Jam, antreannya jadi milik bersama')}</span>
        </span>
      </button>
    );
  }

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: t('Dengerin bareng di Suwwara'), text: t('Gabung Jam-ku di Suwwara, kode {code}', { code: roomId }), url: jamShareLink(roomId) });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    showToast((await copyJamLink(roomId)) ? t('Link Jam disalin.') : t('Gagal menyalin link.'));
  };

  return (
    <div className={styles.jamCard}>
      <JamAvatars count={jam.count} size={34} max={3} />
      <span className={styles.jamText}>
        <span className={styles.jamTitle}>
          <span className={[styles.liveDot, jam.live ? '' : styles.liveDotWarn].join(' ')} aria-hidden="true" />
          {jam.live ? t('Jam aktif · {people}', { people: jam.peopleText }) : jam.statusText}
        </span>
        <span className={styles.jamSub}>{t('Semua bisa atur antrean dan pemutaran · kode {code}', { code: roomId })}</span>
      </span>
      <span className={styles.jamActions}>
        <button type="button" className={styles.jamPrimary} onClick={() => void share()}>
          {t('Bagikan')}
        </button>
        <button type="button" className={styles.jamSecondary} onClick={openJamSheet}>
          {t('Kelola')}
        </button>
      </span>
    </div>
  );
}

type Tab = 'lyrics' | 'queue' | 'jam' | 'video';
const TABS: { id: Tab; label: string }[] = [
  { id: 'lyrics', label: msg('Lirik') },
  { id: 'queue', label: msg('Antrean') },
  { id: 'jam', label: msg('Jam') },
];
// Only while the song has a music video (FullscreenStage adds it).
const VIDEO_TAB: { id: Tab; label: string } = { id: 'video', label: msg('Video') };
const EPISODE_TABS: { id: Tab; label: string }[] = [
  { id: 'lyrics', label: msg('Transkrip') },
  { id: 'queue', label: msg('Antrean') },
  { id: 'jam', label: msg('Jam') },
];
const songStarving = () => audioEngine.getSnapshot().status === 'loading';

/**
 * Desktop fullscreen, "Panggung Lirik" (2026-11 redesign, option B picked in Claude Design): the song in a compact
 * column on the left (art, title, seek, controls) and the stage on the right, lyrics by default in large display
 * type, or the queue, or the Jam. The tabs sit in the top bar, which fades with the cursor like before. Nothing at
 * the bottom: the stage gets the full height.
 */
export function FullscreenStage({ song, chromeHidden, onMinimize }: { song: Song; chromeHidden: boolean; onMinimize: () => void }) {
  const t = useT();
  const { playbackState, remoteDevice, handleTogglePlay, handleNext, handlePrevious } = usePlayback();
  const openConnectSheet = useUiStore((state) => state.openConnectSheet);
  const [tab, setTab] = useState<Tab>('lyrics');
  const video = useMusicVideo(song);
  const { showToast } = useToast();
  const theaterOpen = useUiStore((state) => state.videoTheater !== null);
  // Video next to Lirik: the two ways of watching the song come first, the queue and the Jam after (asked for).
  // A podcast episode: its transcript in the lyrics tab, its overview in the queue tab (in a Jam the room's queue,
  // which everyone edits), and the Jam as for a song: a podcast can be listened to together.
  const episode = song.kind === 'episode';
  const inJam = useJamStore((state) => state.role !== 'solo');
  const tabs = episode ? EPISODE_TABS : video ? [TABS[0], VIDEO_TAB, ...TABS.slice(1)] : TABS;
  // The song changed to one without a video while its tab was showing: back to the lyrics.
  const shownTab: Tab = tab === 'video' && !video ? 'lyrics' : tab;

  const isPlaying = playbackState.status === 'playing';
  const isBuffering = playbackState.status === 'loading';

  return (
    <div className={styles.stage}>
      <header className={[styles.topBar, chromeHidden ? styles.hidden : ''].join(' ')}>
        <button type="button" className={styles.chip} onClick={onMinimize}>
          <Icon name="chevron-down" size={18} />
          {t('Kecilkan')}
        </button>
        <div className={styles.tabs} role="tablist" aria-label={t('Panel')}>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={shownTab === item.id}
              className={[styles.tab, shownTab === item.id ? styles.tabActive : ''].join(' ')}
              onClick={() => setTab(item.id)}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
        <button type="button" className={[styles.chip, styles.chipAccent, styles.chipEnd].join(' ')} onClick={openConnectSheet}>
          <Icon name="devices" size={18} />
          {remoteDevice ? remoteDevice.name : t('Perangkat ini')}
        </button>
      </header>

      {/* Video tab: one centred column, the video on top and the song's controls under it, no cover (it would only
          repeat what the video shows and push the video off-centre). */}
      <div className={[styles.columns, shownTab === 'video' ? styles.columnsVideo : '', shownTab === 'video' && !video?.synced ? styles.columnsVideoCut : ''].join(' ')}>
        <section className={styles.songColumn} aria-label={t('Lagu yang diputar')}>
          {shownTab !== 'video' && (
            <LazyImage
              images={song.image}
              quality="500x500"
              alt={song.name}
              className={[styles.art, song.kind === 'episode' ? styles.episodeArt : ''].join(' ')}
            />
          )}
          <div className={styles.meta}>
            <div className={styles.metaText}>
              <h1 className={styles.title}>
                <MarqueeText text={song.name} />
              </h1>
              <span className={styles.artist}>
                <ArtistLinks song={song} />
              </span>
            </div>
            <span className={styles.metaActions}>
              <LikeButton song={song} size={26} />
              <DownloadButton song={song} size={24} />
            </span>
          </div>
          <SeekBar duration={song.duration} />
          <PlayerControls isPlaying={isPlaying} isBuffering={isBuffering} onTogglePlay={handleTogglePlay} onNext={handleNext} onPrevious={handlePrevious} />
        </section>

        <section className={styles.stageColumn} aria-label={t(tabs.find((item) => item.id === shownTab)?.label ?? '')}>
          {shownTab === 'video' && video && (
            <div className={styles.videoStage}>
              {video.synced ? (
                <VideoSurface
                  key={video.videoId}
                  videoId={video.videoId}
                  clock={songClock}
                  posterUrl={bestImageUrl(song.image, '500x500')}
                  active={!theaterOpen}
                  audioStarving={songStarving}
                  className={styles.videoSurface}
                  onUnavailable={(reason) => {
                    setTab('lyrics');
                    showToast(reason === 'slow' ? t('Koneksi terlalu lambat untuk video.') : t('Video tidak bisa diputar sekarang.'));
                  }}
                >
                  <button type="button" className={styles.videoExpand} onClick={() => openTheater(song, video)} aria-label={t('Layar penuh')}>
                    <Icon name="fullscreen" size={20} />
                  </button>
                </VideoSurface>
              ) : (
                <div className={styles.videoCut}>
                  <p className={styles.jamNote}>{t('Video musik lagu ini versinya beda dari lagunya, jadi diputar dari awal dengan suaranya sendiri. Lagu dijeda dulu, lalu lanjut lagi.')}</p>
                  <button type="button" className={styles.jamPrimary} onClick={() => openTheater(song, video)}>
                    {t('Tonton MV')}
                  </button>
                </div>
              )}
            </div>
          )}
          {shownTab === 'lyrics' && (
            <div className={styles.stageLyrics}>
              <LyricsPanel song={song} isFullscreen />
            </div>
          )}
          {shownTab === 'queue' && episode && !inJam && (
            <div className={styles.panel}>
              <EpisodeOverviewPanel song={song} />
            </div>
          )}
          {shownTab === 'queue' && (!episode || inJam) && (
            <div className={styles.panel}>
              <span className={styles.panelHeading}>{t('Berikutnya')}</span>
              <StageQueue />
            </div>
          )}
          {shownTab === 'jam' && (
            <div className={styles.jamStage}>
              <JamCard />
              <p className={styles.jamNote}>
                {t('Di Jam, semua orang bisa menambah, menghapus, dan mengatur urutan antrean, serta memutar, menjeda, dan melompati lagu. Lagu berganti bersamaan untuk semua yang ikut.')}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
