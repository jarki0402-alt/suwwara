import { useState } from 'react';
import type { Song } from '../../api/types';
import { primaryArtistNames } from '../../api/mappers';
import { ArtistLinks } from '../../components/ArtistLinks/ArtistLinks';
import { DownloadButton } from '../../components/DownloadButton/DownloadButton';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { JamAvatars } from '../../components/JamIndicator/JamIndicator';
import { LikeButton } from '../../components/LikeButton/LikeButton';
import { useToast } from '../../components/Toast/ToastProvider';
import { playAtPosition } from '../../jam/jamQueueActions';
import { copyJamLink, jamShareLink } from '../../jam/shareJam';
import { useJamStatus } from '../../jam/useJamStatus';
import { usePlayback } from '../../playback/PlaybackContext';
import { useJamStore } from '../../stores/jamStore';
import { useQueueStore } from '../../stores/queueStore';
import { useUiStore } from '../../stores/uiStore';
import { formatTime } from '../../utils/formatTime';
import { LyricsPanel } from './LyricsPanel';
import { PlayerControls } from './PlayerControls';
import { SeekBar } from './SeekBar';
import styles from './FullscreenStage.module.css';

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
  const upNext = useUpNext(limit);
  if (upNext.length === 0) return <p className={styles.empty}>Belum ada lagu berikutnya di antrean.</p>;
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

/**
 * The Jam card: who is listening and the invite, while in one; otherwise the way to start one. Shown in the docked panel
 * and the fullscreen stage (2026-11 redesign), so listening together is never more than a tap away from the song.
 */
export function JamCard() {
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
          <span className={styles.jamTitle}>Dengar bareng</span>
          <span className={styles.jamSub}>Ajak teman ke Jam, antreannya jadi milik bersama</span>
        </span>
      </button>
    );
  }

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Dengerin bareng di Suwwara', text: `Gabung Jam-ku di Suwwara, kode ${roomId}`, url: jamShareLink(roomId) });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    showToast((await copyJamLink(roomId)) ? 'Link Jam disalin.' : 'Gagal menyalin link.');
  };

  return (
    <div className={styles.jamCard}>
      <JamAvatars count={jam.count} size={34} max={3} />
      <span className={styles.jamText}>
        <span className={styles.jamTitle}>
          <span className={[styles.liveDot, jam.live ? '' : styles.liveDotWarn].join(' ')} aria-hidden="true" />
          {jam.live ? `Jam aktif · ${jam.peopleText}` : jam.statusText}
        </span>
        <span className={styles.jamSub}>Semua bisa atur antrean dan pemutaran · kode {roomId}</span>
      </span>
      <span className={styles.jamActions}>
        <button type="button" className={styles.jamPrimary} onClick={() => void share()}>
          Bagikan
        </button>
        <button type="button" className={styles.jamSecondary} onClick={openJamSheet}>
          Kelola
        </button>
      </span>
    </div>
  );
}

type Tab = 'lyrics' | 'queue' | 'jam';
const TABS: { id: Tab; label: string }[] = [
  { id: 'lyrics', label: 'Lirik' },
  { id: 'queue', label: 'Antrean' },
  { id: 'jam', label: 'Jam' },
];

/**
 * Desktop fullscreen, "Panggung Lirik" (2026-11 redesign, option B picked in Claude Design): the song in a compact
 * column on the left (art, title, seek, controls) and the stage on the right, lyrics by default in large display
 * type, or the queue, or the Jam. The tabs sit in the top bar, which fades with the cursor like before. Nothing at
 * the bottom: the stage gets the full height.
 */
export function FullscreenStage({ song, chromeHidden, onMinimize }: { song: Song; chromeHidden: boolean; onMinimize: () => void }) {
  const { playbackState, remoteDevice, handleTogglePlay, handleNext, handlePrevious } = usePlayback();
  const openConnectSheet = useUiStore((state) => state.openConnectSheet);
  const [tab, setTab] = useState<Tab>('lyrics');

  const isPlaying = playbackState.status === 'playing';
  const isBuffering = playbackState.status === 'loading';

  return (
    <div className={styles.stage}>
      <header className={[styles.topBar, chromeHidden ? styles.hidden : ''].join(' ')}>
        <button type="button" className={styles.chip} onClick={onMinimize}>
          <Icon name="chevron-down" size={18} />
          Kecilkan
        </button>
        <div className={styles.tabs} role="tablist" aria-label="Panel">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={[styles.tab, tab === item.id ? styles.tabActive : ''].join(' ')}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" className={[styles.chip, styles.chipAccent, styles.chipEnd].join(' ')} onClick={openConnectSheet}>
          <Icon name="devices" size={18} />
          {remoteDevice ? remoteDevice.name : 'Perangkat ini'}
        </button>
      </header>

      <div className={styles.columns}>
        <section className={styles.songColumn} aria-label="Lagu yang diputar">
          <LazyImage images={song.image} quality="500x500" alt={song.name} className={styles.art} />
          <div className={styles.meta}>
            <div className={styles.metaText}>
              <h1 className={styles.title}>{song.name}</h1>
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

        <section className={styles.stageColumn} aria-label={TABS.find((item) => item.id === tab)?.label}>
          {tab === 'lyrics' && (
            <div className={styles.stageLyrics}>
              <LyricsPanel song={song} isFullscreen />
            </div>
          )}
          {tab === 'queue' && (
            <div className={styles.panel}>
              <span className={styles.panelHeading}>Berikutnya</span>
              <UpNextList limit={30} />
            </div>
          )}
          {tab === 'jam' && (
            <div className={styles.jamStage}>
              <JamCard />
              <p className={styles.jamNote}>
                Di Jam, semua orang bisa menambah, menghapus, dan mengatur urutan antrean, serta memutar, menjeda, dan
                melompati lagu. Lagu berganti bersamaan untuk semua yang ikut.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
