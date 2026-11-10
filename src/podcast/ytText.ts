import { useLanguageStore } from '../i18n/i18n';

/**
 * YouTube's own small print (view counts, subscribers, "3 hari yang lalu", episode counts) for the Podcast tab.
 *
 * The data is always fetched in Indonesian (podcastApi): asked in English, YouTube also swaps the titles of Indonesian
 * episodes for machine translations ("PULAU" → "THE ISLAND"), and the listener wants the title the creator wrote. So
 * with the app in English, only these counts and dates are turned into English here. Anything not recognised is shown
 * as YouTube wrote it: a little Indonesian beats a wrong number.
 */

const UNITS: Record<string, string> = {
  detik: 'second',
  dtk: 'second',
  menit: 'minute',
  mnt: 'minute',
  jam: 'hour',
  hari: 'day',
  h: 'day',
  minggu: 'week',
  mgg: 'week',
  bulan: 'month',
  bln: 'month',
  tahun: 'year',
  thn: 'year',
};

const MONTHS: Record<string, string> = {
  jan: 'Jan', januari: 'January',
  feb: 'Feb', februari: 'February',
  mar: 'Mar', maret: 'March',
  apr: 'Apr', april: 'April',
  mei: 'May',
  jun: 'Jun', juni: 'June',
  jul: 'Jul', juli: 'July',
  agu: 'Aug', agt: 'Aug', agustus: 'August',
  sep: 'Sep', september: 'September',
  okt: 'Oct', oktober: 'October',
  nov: 'Nov', november: 'November',
  des: 'Dec', desember: 'December',
};

const plural = (n: string, word: string) => `${n} ${word}${n === '1' ? '' : 's'}`;

/** "1,2 jt" → "1.2M", "105 rb" → "105K", "1.010.508" → "1,010,508". */
function englishNumbers(text: string): string {
  return text
    .replace(/(\d+(?:,\d+)?)[\s ]?(rb|jt|M)\b/g, (_, n: string, unit: string) => `${n.replace(',', '.')}${unit === 'rb' ? 'K' : unit === 'jt' ? 'M' : 'B'}`)
    .replace(/\d{1,3}(?:\.\d{3})+/g, (n) => n.replace(/\./g, ','));
}

export function ytTextToEnglish(text: string): string {
  let out = text.trim();
  // "3 hari yang lalu", "3 h lalu", "Streaming 2 minggu yang lalu"
  out = out.replace(/(\d+)\s+([a-z]+)\s+(?:yang\s+)?lalu/gi, (whole, n: string, unit: string) => {
    const english = UNITS[unit.toLowerCase()];
    return english ? `${plural(n, english)} ago` : whole;
  });
  out = out.replace(/^Streaming\b/i, 'Streamed').replace(/^(?:Tayang perdana|Ditayangkan)(?: pada)?\b/i, 'Premiered');
  // "8 Nov 2025" / "8 November 2025"
  out = out.replace(/\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/g, (whole, d: string, m: string, y: string) => {
    const month = MONTHS[m.toLowerCase()];
    return month ? `${month} ${d}, ${y}` : whole;
  });
  out = englishNumbers(out);
  out = out
    .replace(/\s*x ditonton\b/i, ' views')
    .replace(/\s*(?:orang )?menonton\b/i, ' watching')
    .replace(/\bsubscriber\b/i, 'subscribers')
    .replace(/^([\d.,]+[KMB]?) video$/i, (_, n: string) => plural(n, 'video'))
    .replace(/^([\d.,]+[KMB]?) episode$/i, (_, n: string) => plural(n, 'episode'));
  return out;
}

/** As the app's language wants it: unchanged in Indonesian, see ytTextToEnglish otherwise. */
export function useYtText(): (text: string | null | undefined) => string {
  const english = useLanguageStore((state) => state.locale === 'en');
  return (text) => (!text ? '' : english ? ytTextToEnglish(text) : text);
}

/**
 * A release date (the RSS feed's, for new episodes) as day, month name, year: "9 November 2026", not "11/9/2026",
 * whose order depends on the device's own settings and reads either way. en-GB keeps the same day-first order in
 * English. Empty when there is no usable date.
 */
export function formatEpisodeDate(iso: string | null | undefined, locale: 'id' | 'en'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** formatEpisodeDate in the app's current language. */
export function useEpisodeDate(): (iso: string | null | undefined) => string {
  const locale = useLanguageStore((state) => (state.locale === 'en' ? 'en' : 'id'));
  return (iso) => formatEpisodeDate(iso, locale);
}
