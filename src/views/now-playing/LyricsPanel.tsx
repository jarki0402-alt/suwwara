import { memo, useEffect, useRef, useState } from 'react';
import type { Song } from '../../api/types';
import { clampOffset, getLyricsOffset, OFFSET_STEP_SEC, setLyricsOffset } from '../../lyrics/lyricsOffset';
import { resolveLyrics, type LyricsResult } from '../../lyrics/lyricsResolver';
import { useLyricsSync } from '../../lyrics/useLyricsSync';
import styles from './LyricsPanel.module.css';

const LyricsLine = memo(function LyricsLine({
  text,
  isActive,
  isFullscreen,
  registerRef,
}: {
  text: string;
  isActive: boolean;
  isFullscreen: boolean;
  registerRef: (node: HTMLParagraphElement | null) => void;
}) {
  return (
    <p
      ref={isActive ? registerRef : undefined}
      className={[styles.line, isActive ? styles.activeLine : '', isFullscreen ? styles.lineFullscreen : ''].join(' ')}
    >
      {text || ' '}
    </p>
  );
});

type LyricsState = { status: 'loading' } | { status: 'ready'; result: LyricsResult } | { status: 'error' };

/** Wait before the one automatic retry after a failed lookup — long enough for a network blip to pass. */
const AUTO_RETRY_MS = 3000;

const formatOffset = (seconds: number): string => `${seconds > 0 ? '+' : ''}${seconds.toFixed(1).replace('.', ',')} dtk`;

/**
 * Nudges every line of a synced song earlier or later. Kept as a small pill in the corner (not a permanent bar): most
 * songs line up fine, and the ones that don't are off by the same amount all the way through.
 */
function SyncControl({ offset, deltaSec, onChange }: { offset: number; deltaSec: number; onChange: (next: number) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const differs = deltaSec >= 1;

  return (
    <div className={styles.syncControl}>
      <button
        type="button"
        className={[styles.syncPill, offset !== 0 ? styles.syncPillActive : ''].join(' ')}
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
      >
        Sinkron{offset !== 0 ? ` ${formatOffset(offset)}` : ''}
        {differs && offset === 0 && <span className={styles.syncDot} aria-hidden="true" />}
      </button>
      {isOpen && (
        <div className={styles.syncPanel}>
          <div className={styles.syncRow}>
            <button type="button" className={styles.syncStep} onClick={() => onChange(clampOffset(offset - OFFSET_STEP_SEC))} aria-label="Lirik lebih lambat 0,5 detik">
              −
            </button>
            <button type="button" className={styles.syncValue} onClick={() => onChange(0)} aria-label="Setel ulang sinkron" disabled={offset === 0}>
              {formatOffset(offset)}
            </button>
            <button type="button" className={styles.syncStep} onClick={() => onChange(clampOffset(offset + OFFSET_STEP_SEC))} aria-label="Lirik lebih cepat 0,5 detik">
              +
            </button>
          </div>
          <span className={styles.syncHint}>
            − lebih lambat · + lebih cepat
            {differs && ` · versi lirik ini beda ${Math.round(deltaSec)} dtk dari lagunya`}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Lyrics of one song. Keyed by song id (see LyricsPanel), so a new song starts from a clean slate — loading state,
 * scroll position and timing nudge alike — instead of carrying the previous song's over.
 */
function LyricsBody({ song, isFullscreen }: { song: Song; isFullscreen: boolean }) {
  const [state, setState] = useState<LyricsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [offset, setOffset] = useState(() => getLyricsOffset(song.id));
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
  const activeIndex = useLyricsSync(syncedLines, offset);

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

  const changeOffset = (next: number) => {
    setOffset(next);
    setLyricsOffset(song.id, next);
  };

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
    <>
      <div className={[styles.syncedWrapper, isFullscreen ? styles.syncedWrapperFullscreen : ''].join(' ')} ref={containerRef}>
        {result.lines.map((line, index) => (
          <LyricsLine
            key={`${line.time}-${index}`}
            text={line.text}
            isActive={index === activeIndex}
            isFullscreen={isFullscreen}
            registerRef={(node) => {
              if (index === activeIndex) activeLineElementRef.current = node;
            }}
          />
        ))}
      </div>
      <SyncControl offset={offset} deltaSec={result.deltaSec} onChange={changeOffset} />
    </>
  );
}

export function LyricsPanel({ song, isFullscreen = false }: { song: Song | null; isFullscreen?: boolean }) {
  if (!song) return null;
  return <LyricsBody key={song.id} song={song} isFullscreen={isFullscreen} />;
}
