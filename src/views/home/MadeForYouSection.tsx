import { useEffect, useState } from 'react';
import { bestImageUrl, isVideoFrame } from '../../api/mappers';
import type { Song } from '../../api/types';
import { Icon, type IconName } from '../../components/Icon/Icon';
import { getTrendingSongsIndonesia } from '../../recommendation/trendingChart';
import { getDailyDiscoveryMix } from '../../recommendation/dailyDiscovery';
import { getOnRepeatMix } from '../../recommendation/onRepeat';
import { getWeeklyDiscoveryMix } from '../../recommendation/weeklyDiscovery';
import { useUiStore, type GeneratedCollectionId } from '../../stores/uiStore';
import styles from './MadeForYouSection.module.css';

interface Tile {
  id: GeneratedCollectionId;
  title: string;
  subtitle: string;
  icon: IconName;
  covers: string[];
}

/**
 * Four auto-generated "playlist" tiles (Temuan Mingguan, Temuan Harian, Sering Kamu Putar, Lagi Viral di Indonesia) (Spotify's Daily Mix/Discover Weekly
 * pattern) — clicking either opens the full track list (GeneratedCollectionView)
 * instead of playing immediately, since these represent a whole collection,
 * not a single track. The cover is the collection's own first four covers as a 2×2 mosaic (fetched here, on mount —
 * the same cached fetchers useGeneratedCollection.ts calls when the tile is actually opened, so clicking through
 * never re-fetches), so it changes with whatever's actually in the mix. Plain images: the blurred collage it replaces
 * cost a filter pass per cover.
 *
 * Phone: square cards in a sideways row (Apple Music). Desktop: compact cover + title tiles right under the greeting
 * (Spotify's shortcut grid). Same markup, MadeForYouSection.module.css switches the shape.
 */
export function MadeForYouSection() {
  const openCollection = useUiStore((state) => state.openCollection);
  const [tiles, setTiles] = useState<Tile[]>([
    { id: 'weekly-discovery', title: 'Temuan Mingguan', subtitle: 'Dari yang kamu dengarkan', icon: 'refresh', covers: [] },
    { id: 'daily-discovery', title: 'Temuan Harian', subtitle: 'Segar setiap hari', icon: 'clock', covers: [] },
    { id: 'on-repeat', title: 'Sering Kamu Putar', subtitle: 'Yang paling kamu ulang', icon: 'repeat', covers: [] },
    { id: 'viral-indonesia', title: 'Lagi Viral di Indonesia', subtitle: 'Yang lagi rame diputar', icon: 'pulse', covers: [] },
  ]);

  useEffect(() => {
    let cancelled = false;
    const coversOf = (songs: Song[]) => songs.slice(0, 4).map((song) => bestImageUrl(song.image, '150x150'));

    getWeeklyDiscoveryMix()
      .then((songs) => {
        if (cancelled) return;
        setTiles((prev) => prev.map((tile) => (tile.id === 'weekly-discovery' ? { ...tile, covers: coversOf(songs) } : tile)));
      })
      .catch(() => {});

    getDailyDiscoveryMix()
      .then((songs) => {
        if (cancelled) return;
        setTiles((prev) => prev.map((tile) => (tile.id === 'daily-discovery' ? { ...tile, covers: coversOf(songs) } : tile)));
      })
      .catch(() => {});

    getOnRepeatMix()
      .then((songs) => {
        if (cancelled) return;
        setTiles((prev) => prev.map((tile) => (tile.id === 'on-repeat' ? { ...tile, covers: coversOf(songs) } : tile)));
      })
      .catch(() => {});

    getTrendingSongsIndonesia(30)
      .then((songs) => {
        if (cancelled) return;
        setTiles((prev) => prev.map((tile) => (tile.id === 'viral-indonesia' ? { ...tile, covers: coversOf(songs) } : tile)));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Dibuat untukmu</h2>
      <div className={styles.row}>
        {tiles.map((tile) => {
          // A mosaic needs four; with fewer, the first cover alone reads better than a half-empty grid.
          const covers = tile.covers.length >= 4 ? tile.covers : tile.covers.slice(0, 1);
          return (
            <button key={tile.id} type="button" className={styles.card} onClick={() => openCollection(tile.id)}>
              <span className={[styles.cover, covers.length === 4 ? styles.mosaic : ''].join(' ')} aria-hidden="true">
                {covers.length > 0 ? (
                  covers.map((src, index) => (
                    // Each cell clips its own image, so a zoomed video-frame cover can't spill into its neighbours.
                    <span key={index} className={styles.cell}>
                      <img src={src} alt="" loading="lazy" decoding="async" className={isVideoFrame(src) ? styles.videoFrame : undefined} />
                    </span>
                  ))
                ) : (
                  <span className={styles.coverIcon}>
                    <Icon name={tile.icon} size={28} />
                  </span>
                )}
              </span>
              <span className={styles.text}>
                <span className={styles.title}>{tile.title}</span>
                <span className={styles.subtitle}>{tile.subtitle}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
