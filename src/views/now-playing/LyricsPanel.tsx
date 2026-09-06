import { memo, useEffect, useRef, useState } from 'react';
import type { Song } from '../../api/types';
import { resolveLyrics, type LyricsResult } from '../../lyrics/lyricsResolver';
import { useLyricsSync } from '../../lyrics/useLyricsSync';
import styles from './LyricsPanel.module.css';

const LyricsLine = memo(function LyricsLine({
  text,
  isActive,
  registerRef,
}: {
  text: string;
  isActive: boolean;
  registerRef: (node: HTMLParagraphElement | null) => void;
}) {
  return (
    <p ref={isActive ? registerRef : undefined} className={[styles.line, isActive ? styles.activeLine : ''].join(' ')}>
      {text || ' '}
    </p>
  );
});

export function LyricsPanel({ song }: { song: Song | null }) {
  const [result, setResult] = useState<LyricsResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const activeLineElementRef = useRef<HTMLParagraphElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!song) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    void resolveLyrics(song).then((resolved) => {
      if (!cancelled) {
        setResult(resolved);
        setIsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [song]);

  // Without this, switching to a new (often shorter) song could leave the panel
  // scrolled to wherever the previous song's lyrics left off — the browser just
  // clamps that scroll position to the new content's height, which can land at
  // or near the very bottom instead of showing the new song's lyrics from the
  // top. Keyed on the song itself so it fires before any line has been matched.
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [song?.id]);

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

  if (!song) return null;
  if (isLoading) return <div className={styles.state}>Memuat lirik...</div>;
  if (!result || result.type === 'none') {
    return <div className={styles.state}>Lirik tidak tersedia untuk lagu ini.</div>;
  }

  if (result.type === 'plain') {
    return (
      <div className={styles.plainWrapper}>
        <pre className={styles.plainText}>{result.text}</pre>
      </div>
    );
  }

  return (
    <div className={styles.syncedWrapper} ref={containerRef}>
      {result.lines.map((line, index) => (
        <LyricsLine
          key={`${line.time}-${index}`}
          text={line.text}
          isActive={index === activeIndex}
          registerRef={(node) => {
            if (index === activeIndex) activeLineElementRef.current = node;
          }}
        />
      ))}
    </div>
  );
}
