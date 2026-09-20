import { useEffect, useState } from 'react';
import { getArtistSummary } from '../../api/wikipediaClient';
import styles from './ArtistInfo.module.css';

/**
 * Lazily loaded — mounts only once the Now Playing panel is actually open
 * (see NowPlayingView.tsx), and renders nothing until the fetch resolves
 * (or forever, if there's no Wikipedia page for this artist) — never blocks
 * or delays anything else in the panel.
 */
export function ArtistInfo({ artistName }: { artistName: string }) {
  const [extract, setExtract] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setExtract(null);
    getArtistSummary(artistName).then((summary) => {
      if (!cancelled && summary) setExtract(summary.extract);
    });
    return () => {
      cancelled = true;
    };
  }, [artistName]);

  if (!extract) return null;

  return (
    <div className={styles.wrapper}>
      <span className={styles.label}>Tentang Artis</span>
      <p className={styles.text}>{extract}</p>
    </div>
  );
}
