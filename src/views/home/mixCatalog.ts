import { useEffect, useMemo, useState } from 'react';
import { getCachedSongs } from '../../api/songCache';
import { t, useLocale } from '../../i18n/i18n';
import { loadHistory } from '../../recommendation/historyLog';
import { profileReady } from '../../sync/profileReady';
import { rankByPlays } from '../../recommendation/onRepeat';
import { moodTitle, radioArtist, timeMixTitle } from '../../recommendation/smartMixes';
import type { GeneratedCollectionId } from '../../stores/uiStore';

/** The chips above Home's mixes. "Untukmu" shows all of them. */
export type MixFilter = 'all' | 'chill' | 'focus' | 'new';

export interface MixCard {
  id: GeneratedCollectionId;
  title: string;
  subtitle: string;
  /** Which chips (besides Untukmu) show this card. */
  filters: MixFilter[];
  /** Cover colours: the block and the round shape on it. `null` shape colour = the palette's accent. */
  color: string;
  shape: string | null;
}

// Fixed colours per kind of mix (2026-11 redesign), so a mix is recognisable at a glance and the shelf reads as a set,
// whatever songs it holds today. Dark enough for white text on all of them.
const COLORS: Record<string, [string, string | null]> = {
  'time-mix': ['#2B3A63', null],
  'daily-discovery': ['#5A5A2E', '#E6E08A'],
  'weekly-discovery': ['#2E4F6B', '#8FD3F2'],
  'mood-focus': ['#2F5D50', '#9FE0C5'],
  'mood-chill': ['#5A3B6B', '#E0A8F2'],
  radio: ['#7A3B2E', '#F2B38A'],
  'on-repeat': ['#6B3B4A', '#F2A38A'],
  'viral-indonesia': ['#7A2E5A', '#F2A8D3'],
};

function card(id: GeneratedCollectionId, title: string, subtitle: string, filters: MixFilter[], colorKey: string = id): MixCard {
  const [color, shape] = COLORS[colorKey] ?? ['#2B3A63', null];
  return { id, title, subtitle, filters, color, shape };
}

/** Every mix Home can show right now, in shelf order, titled in the current language. Cheap: titles only, no songs are fetched here. */
export function homeMixCards(now = new Date()): MixCard[] {
  const cards: MixCard[] = [
    card('time-mix', timeMixTitle(now), t('Yang biasa kamu putar di jam seperti ini'), ['chill']),
    card('daily-discovery', t('Temuan Harian'), t('Lagu baru untukmu hari ini'), ['new']),
    card('mood-focus', moodTitle('focus'), t('Instrumental tenang untuk kerja dan belajar'), ['focus']),
    card('mood-chill', moodTitle('chill'), t('Akustik dan lagu santai'), ['chill']),
  ];
  const artist = radioArtist();
  if (artist) cards.push(card(`radio:${artist}`, t('Radio {artist}', { artist }), t('Mirip {artist} dan yang sering kamu putar', { artist }), ['chill'], 'radio'));
  cards.push(card('weekly-discovery', t('Temuan Mingguan'), t('Campuran dari riwayat putarmu'), ['new']));
  // Only once there is something to repeat on THIS device: the mix is built from the songs this device has seen
  // (no network), so history synced from another device names songs it cannot show yet, and the card opened empty.
  if (getCachedSongs(rankByPlays(loadHistory(), now.getTime(), 3)).length >= 3) {
    cards.push(card('on-repeat', t('Sering Kamu Putar'), t('Lagu favoritmu 30 hari terakhir'), ['chill']));
  }
  cards.push(card('viral-indonesia', t('Lagi Viral'), t('Yang lagi ramai di Indonesia'), ['new']));
  return cards;
}

/** Two short lines for the cover, "Mix Malam Ini" → "Mix" / "Malam Ini". */
export function coverLines(title: string): [string, string] {
  const words = title.split(' ');
  if (words.length <= 1) return [title, ''];
  return [words[0], words.slice(1).join(' ')];
}

/**
 * homeMixCards, recomputed once this account's play history has arrived from the server: on a fresh device Home
 * shows before that sync, and the cards that depend on history (Radio of the top artist, Sering Kamu Putar) were
 * missing until the next visit. Also recomputed on a language switch: the cards carry their titles as text.
 */
export function useHomeMixCards(): MixCard[] {
  const locale = useLocale();
  const [historyVersion, setHistoryVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void profileReady().then(() => {
      if (!cancelled) setHistoryVersion((version) => version + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => homeMixCards(), [locale, historyVersion]);
}
