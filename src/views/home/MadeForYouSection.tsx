import { useEffect, useState } from 'react';
import { bestImageUrl } from '../../api/mappers';
import type { Song } from '../../api/types';
import { Icon, type IconName } from '../../components/Icon/Icon';
import { getTrendingSongsIndonesia } from '../../recommendation/trendingChart';
import { getDailyDiscoveryMix } from '../../recommendation/dailyDiscovery';
import { getOnRepeatMix } from '../../recommendation/onRepeat';
import { getWeeklyDiscoveryMix } from '../../recommendation/weeklyDiscovery';
import { useUiStore, type GeneratedCollectionId } from '../../stores/uiStore';
import styles from './MadeForYouSection.module.css';

type Tint = 'weekly' | 'daily' | 'repeat' | 'viral';

interface Tile {
  id: GeneratedCollectionId;
  title: string;
  subtitle: string;
  icon: IconName;
  tint: Tint;
  covers: string[];
}

/**
 * Four auto-generated "playlist" tiles (Temuan Mingguan, Temuan Harian, Sering Kamu Putar, Lagi Viral di Indonesia) (Spotify's Daily Mix/Discover Weekly
 * pattern) — clicking either opens the full track list (GeneratedCollectionView)
 * instead of playing immediately, since these represent a whole collection,
 * not a single track. The backdrop is a blurred collage of the collection's
 * own first couple of covers (fetched here, on mount — the same cached
 * fetchers useGeneratedCollection.ts calls when the tile is actually opened,
 * so clicking through never re-fetches), not a flat gradient — it changes
 * with whatever's actually in the mix, same as Spotify's own Daily Mix art.
 *
 * The per-artist "Mix {artist}" collections live in their own sideways shelf (ArtistMixesSection); the four tiles
 * here fill a 2×2 grid on a phone and one row on desktop.
 */
export function MadeForYouSection() {
  const openCollection = useUiStore((state) => state.openCollection);
  const [tiles, setTiles] = useState<Tile[]>([
    { id: 'weekly-discovery', title: 'Temuan Mingguan', subtitle: 'Berdasarkan yang kamu dengarkan', icon: 'refresh', tint: 'weekly', covers: [] },
    { id: 'daily-discovery', title: 'Temuan Harian', subtitle: 'Segar setiap hari, beda dari mingguan', icon: 'clock', tint: 'daily', covers: [] },
    { id: 'on-repeat', title: 'Sering Kamu Putar', subtitle: 'Yang paling kamu ulang', icon: 'repeat', tint: 'repeat', covers: [] },
    { id: 'viral-indonesia', title: 'Lagi Viral di Indonesia', subtitle: 'Yang lagi rame diputar', icon: 'pulse', tint: 'viral', covers: [] },
  ]);

  useEffect(() => {
    let cancelled = false;
    const coversOf = (songs: Song[]) => songs.slice(0, 2).map((song) => bestImageUrl(song.image, '150x150'));

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

  const tintClass: Record<Tint, string> = { weekly: styles.tileWeekly, daily: styles.tileDaily, repeat: styles.tileRepeat, viral: styles.tileViral };

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Dibuat Untukmu</h2>
      <div className={styles.grid}>
        {tiles.map((tile) => (
          <button key={tile.id} type="button" className={[styles.tile, tintClass[tile.tint]].join(' ')} onClick={() => openCollection(tile.id)}>
            {tile.covers.map((src, index) => (
              <img key={index} src={src} alt="" aria-hidden="true" className={styles.collageImg} />
            ))}
            <span className={styles.scrim} aria-hidden="true" />
            {/* The top song's own cover — dynamic and content-driven, unlike a
                fixed icon that can't reflect "Mix {artist}" changing artist
                to artist, or a "viral" chart changing week to week. Falls
                back to the generic icon only for the brief window before the
                collection's own fetch (see the effect above) resolves. */}
            {tile.covers[0] ? (
              <img src={tile.covers[0]} alt="" aria-hidden="true" className={styles.tileIconImage} />
            ) : (
              <span className={styles.tileIcon}>
                <Icon name={tile.icon} size={22} />
              </span>
            )}
            <span className={styles.tileText}>
              <span className={styles.tileTitle}>{tile.title}</span>
              <span className={styles.tileSubtitle}>{tile.subtitle}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
