import { useEffect, useState } from 'react';
import type { ImageVariant, Song } from '../../api/types';
import { getDailyDiscoveryMix } from '../../recommendation/dailyDiscovery';
import { getOnRepeatMix } from '../../recommendation/onRepeat';
import { getTrendingSongsIndonesia } from '../../recommendation/trendingChart';
import { getArtistMixByName } from '../../recommendation/topArtistMix';
import { getWeeklyDiscoveryMix } from '../../recommendation/weeklyDiscovery';
import type { GeneratedCollectionId } from '../../stores/uiStore';

const ARTIST_MIX_PREFIX = 'artist-mix:';

const STATIC_META: Partial<Record<string, { title: string; description: string; fetch: () => Promise<Song[]> }>> = {
  'weekly-discovery': {
    title: 'Temuan Mingguan',
    description: 'Campuran lagu berdasarkan riwayat putarmu, diperbarui tiap minggu.',
    fetch: getWeeklyDiscoveryMix,
  },
  'daily-discovery': {
    title: 'Temuan Harian',
    description: 'Lagu baru untukmu hari ini — beda dari Temuan Mingguan dan dari yang baru saja kamu dengarkan.',
    fetch: getDailyDiscoveryMix,
  },
  'on-repeat': {
    title: 'Sering Kamu Putar',
    description: 'Lagu yang paling sering kamu putar dalam 30 hari terakhir.',
    fetch: getOnRepeatMix,
  },
  'viral-indonesia': {
    title: 'Lagi Viral di Indonesia',
    description: 'Lagu-lagu yang lagi ramai diputar di Indonesia sekarang.',
    fetch: () => getTrendingSongsIndonesia(30),
  },
  // 'artist-mix:{name}' deliberately excluded — handled separately below,
  // since its title/fetch depend on the artist name encoded in the id itself.
};

export function useGeneratedCollection(collectionId: GeneratedCollectionId | null) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);
  const [image, setImage] = useState<ImageVariant[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!collectionId) return;
    let cancelled = false;
    setIsLoading(true);
    setSongs([]);
    setImage([]);

    if (collectionId.startsWith(ARTIST_MIX_PREFIX)) {
      const artistName = collectionId.slice(ARTIST_MIX_PREFIX.length);
      setTitle(`Mix ${artistName}`);
      setDescription(`Lagu-lagu populer ${artistName} dan yang mirip dengannya.`);
      getArtistMixByName(artistName)
        .then((result) => {
          if (cancelled || !result) return;
          setSongs(result.songs);
          setImage(result.image);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    } else {
      const meta = STATIC_META[collectionId];
      if (!meta) return;
      setTitle(meta.title);
      setDescription(meta.description);
      meta
        .fetch()
        .then((result) => {
          if (!cancelled) setSongs(result);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  if (!collectionId) return null;
  return { title, description, songs, image, isLoading };
}
