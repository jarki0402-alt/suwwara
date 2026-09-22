import { memo, useEffect, useRef, useState } from 'react';
import type { Song } from '../../api/types';
import { audioEngine } from '../../audio-engine/AudioEngine';
import { sendJamIntent } from '../../jam/jamClient';
import { resolveLyrics, type LyricsResult } from '../../lyrics/lyricsResolver';
import { useLyricsSync } from '../../lyrics/useLyricsSync';
import { useJamStore } from '../../stores/jamStore';
import styles from './LyricsPanel.module.css';

/** Same jam-or-solo branch SeekBar's own handleSeekFraction uses — a line tap is just another way to seek. */
function seekTo(positionSec: number): void {
  const { role, roomId, clientId } = useJamStore.getState();
  if (role !== 'solo' && roomId) {
    void sendJamIntent(roomId, clientId, 'seek', { positionSec });
    return;
  }
  audioEngine.seek(positionSec);
}

const LyricsLine = memo(function LyricsLine({
  text,
  time,
  isActive,
  isFullscreen,
  registerRef,
}: {
  text: string;
  /** Seconds into the song this line starts — undefined for an unsynced (plain-text) line, which isn't clickable. */
  time: number | undefined;
  isActive: boolean;
  isFullscreen: boolean;
  registerRef: (node: HTMLParagraphElement | null) => void;
}) {
  const clickable = time !== undefined && !!text;
  return (
    <p
      ref={isActive ? registerRef : undefined}
      className={[styles.line, isActive ? styles.activeLine : '', isFullscreen ? styles.lineFullscreen : '', clickable ? styles.lineClickable : ''].join(' ')}
      onClick={clickable ? () => seekTo(time) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                seekTo(time);
              }
            }
          : undefined
      }
    >
      {text || ' '}
    </p>
  );
});

type LyricsState = { status: 'loading' } | { status: 'ready'; result: LyricsResult } | { status: 'error' };

/** Wait before the one automatic retry after a failed lookup — long enough for a network blip to pass. */
const AUTO_RETRY_MS = 3000;

/**
 * Lyrics of one song. Keyed by song id (see LyricsPanel), so a new song starts from a clean slate — loading state,
 * and scroll position alike — instead of carrying the previous song's over.
 */
function LyricsBody({ song, isFullscreen }: { song: Song; isFullscreen: boolean }) {
  const [state, setState] = useState<LyricsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const activeLineElementRef = useRef<HTMLParagraphElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    resolveLyrics(song)
      .then((result) => {
        if (!cancelled) setState({ status: 'ready', result });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error' });
        // One quiet retry: most failures are a network blip that has passed by now.
        if (attempt === 0) {
          retryTimer = setTimeout(() => {
            setState({ status: 'loading' });
            setAttempt(1);
          }, AUTO_RETRY_MS);
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
    // The song is fixed for this component's life (keyed by id); only a retry re-runs the lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const result = state.status === 'ready' ? state.result : null;
  const syncedLines = result?.type === 'synced' ? result.lines : [];
  const activeIndex = useLyricsSync(syncedLines);

  useEffect(() => {
    const container = containerRef.current;
    const activeEl = activeLineElementRef.current;
    if (!container || !activeEl) return;
    // Centers the active line's own midpoint in the visible panel — where the
    // user is actually looking/reading — with equal lyric context scrolled in
    // above and below it as the song plays.
    const target = activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
    container.scrollTo({ top: Math.max(target, 0), behavior: 'smooth' });
  }, [activeIndex]);

  if (state.status === 'loading') return <div className={styles.state}>Memuat lirik...</div>;
  if (state.status === 'error') {
    return (
      <div className={styles.state}>
        <div className={styles.stateStack}>
          <span>Lirik belum bisa dimuat.</span>
          <button
            type="button"
            className={styles.retryButton}
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((value) => value + 1);
            }}
          >
            Coba lagi
          </button>
        </div>
      </div>
    );
  }

  if (result?.type === 'instrumental') return <div className={styles.state}>Lagu instrumental — tidak ada lirik.</div>;
  if (!result || result.type === 'none') return <div className={styles.state}>Lirik belum tersedia untuk lagu ini.</div>;

  if (result.type === 'plain') {
    return (
      <div className={[styles.plainWrapper, isFullscreen ? styles.plainWrapperFullscreen : ''].join(' ')}>
        <pre className={[styles.plainText, isFullscreen ? styles.plainTextFullscreen : ''].join(' ')}>{result.text}</pre>
        <p className={styles.plainNote}>Tanpa penanda waktu · {result.source === 'ytmusic' ? 'YouTube Music' : 'LRCLIB'}</p>
      </div>
    );
  }

  return (
    <div className={[styles.syncedWrapper, isFullscreen ? styles.syncedWrapperFullscreen : ''].join(' ')} ref={containerRef}>
      {result.lines.map((line, index) => (
        <LyricsLine
          key={`${line.time}-${index}`}
          text={line.text}
          time={line.time}
          isActive={index === activeIndex}
          isFullscreen={isFullscreen}
          registerRef={(node) => {
            if (index === activeIndex) activeLineElementRef.current = node;
          }}
        />
      ))}
    </div>
  );
}

export function LyricsPanel({ song, isFullscreen = false }: { song: Song | null; isFullscreen?: boolean }) {
  if (!song) return null;
  return <LyricsBody key={song.id} song={song} isFullscreen={isFullscreen} />;
}
