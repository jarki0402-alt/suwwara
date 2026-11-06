import { useEffect, useState } from 'react';
import type { ImageVariant, Song } from '../../api/types';
import { msg, useT, type Translate } from '../../i18n/i18n';
import { getDailyDiscoveryMix } from '../../recommendation/dailyDiscovery';
import { getOnRepeatMix } from '../../recommendation/onRepeat';
import { getTrendingSongsIndonesia } from '../../recommendation/trendingChart';
import { getArtistMixByName } from '../../recommendation/topArtistMix';
import { getWeeklyDiscoveryMix } from '../../recommendation/weeklyDiscovery';
import { getArtistRadio, getMoodMix, getTimeMix, timeMixTitle } from '../../recommendation/smartMixes';
import type { GeneratedCollectionId } from '../../stores/uiStore';

const ARTIST_MIX_PREFIX = 'artist-mix:';
const RADIO_PREFIX = 'radio:';

type Meta = { title: string; description: string; fetch: () => Promise<Song[]> };

// Titles and descriptions are marked Indonesian (msg) and translated where they are shown, so an open mix follows a
// language switch instead of keeping the text of the language it was opened in.
const STATIC_META: Partial<Record<string, Meta>> = {
  'weekly-discovery': {
    title: msg('Temuan Mingguan'),
    description: msg('Campuran lagu berdasarkan riwayat putarmu, diperbarui tiap minggu.'),
    fetch: getWeeklyDiscoveryMix,
  },
  'daily-discovery': {
    title: msg('Temuan Harian'),
    description: msg('Lagu baru untukmu hari ini, beda dari Temuan Mingguan dan dari yang baru saja kamu dengarkan.'),
    fetch: getDailyDiscoveryMix,
  },
  'on-repeat': {
    title: msg('Sering Kamu Putar'),
    description: msg('Lagu yang paling sering kamu putar dalam 30 hari terakhir.'),
    fetch: getOnRepeatMix,
  },
  'viral-indonesia': {
    title: msg('Lagi Viral di Indonesia'),
    description: msg('Lagu-lagu yang lagi ramai diputar di Indonesia sekarang.'),
    fetch: () => getTrendingSongsIndonesia(30),
  },
  'mood-focus': {
    title: msg('Mix Fokus'),
    description: msg('Instrumental yang tenang untuk kerja dan belajar, diperbarui tiap hari.'),
    fetch: () => getMoodMix('focus'),
  },
  'mood-chill': {
    title: msg('Mix Santai'),
    description: msg('Akustik dan lagu santai, dicampur dengan artis yang sering kamu dengar.'),
    fetch: () => getMoodMix('chill'),
  },
  // 'artist-mix:{name}', 'radio:{name}' and 'time-mix' are handled separately below: their title depends on the
  // artist in the id or on the time of day.
};

/** Songs of the ids whose meta is not fixed. */
function dynamicFetch(collectionId: string): (() => Promise<Song[]>) | null {
  if (collectionId === 'time-mix') return () => getTimeMix();
  if (collectionId.startsWith(RADIO_PREFIX)) {
    const artistName = collectionId.slice(RADIO_PREFIX.length);
    return () => getArtistRadio(artistName);
  }
  return null;
}

function fetcherFor(collectionId: string): (() => Promise<Song[]>) | null {
  return STATIC_META[collectionId]?.fetch ?? dynamicFetch(collectionId);
}

/** Title and description of a generated collection, in the current language. */
function collectionText(collectionId: string, t: Translate): { title: string; description: string } {
  const fixed = STATIC_META[collectionId];
  if (fixed) return { title: t(fixed.title), description: t(fixed.description) };
  if (collectionId === 'time-mix') {
    return { title: timeMixTitle(), description: t('Lagu yang biasa kamu putar di jam seperti ini, dicampur yang mirip. Berganti mengikuti waktu.') };
  }
  if (collectionId.startsWith(RADIO_PREFIX)) {
    const artist = collectionId.slice(RADIO_PREFIX.length);
    return { title: t('Radio {artist}', { artist }), description: t('Lagu-lagu yang mirip dengan {artist}, diperbarui tiap hari.', { artist }) };
  }
  if (collectionId.startsWith(ARTIST_MIX_PREFIX)) {
    const artist = collectionId.slice(ARTIST_MIX_PREFIX.length);
    return { title: t('Mix {artist}', { artist }), description: t('Lagu-lagu populer {artist} dan yang mirip dengannya.', { artist }) };
  }
  return { title: '', description: '' };
}

/** The songs of any generated collection, for what needs them without opening it (the Home covers). */
export async function fetchCollectionSongs(collectionId: GeneratedCollectionId): Promise<Song[]> {
  if (collectionId.startsWith(ARTIST_MIX_PREFIX)) {
    const result = await getArtistMixByName(collectionId.slice(ARTIST_MIX_PREFIX.length));
    return result?.songs ?? [];
  }
  const load = fetcherFor(collectionId);
  return load ? load() : [];
}

export function useGeneratedCollection(collectionId: GeneratedCollectionId | null) {
  const t = useT();
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
      const load = fetcherFor(collectionId);
      if (!load) return;
      load()
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
  return { ...collectionText(collectionId, t), songs, image, isLoading };
}
