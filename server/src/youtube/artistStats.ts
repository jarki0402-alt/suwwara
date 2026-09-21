/**
 * Numbers the artist page shows that `ytmusic-api` parses away: monthly listeners in the header, and a play count next
 * to each top song. Both arrive as short display text ("17.1M monthly audience", "312M plays"), so what we can recover
 * is the ROUNDED value (3 significant digits at best) — never the exact figure. The client shows it as full digits
 * (17.100.000), the way Spotify does, which makes the trailing zeros a property of the source, not a rounding of ours.
 */

const MULTIPLIERS: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };

/**
 * "17.1M" → 17100000, "312M" → 312000000, "1.2B" → 1200000000, "980K" → 980000, "1,234" / "523" → 1234 / 523.
 * Only the English format is handled — the client asks YouTube Music for `HL: 'en'` (see ytmusic.ts), and a locale that
 * swaps the separators ("17,1 jt") would be misread; those return null rather than a wrong number.
 */
export function parseCompactCount(text: string): number | null {
  const match = /^\s*(\d[\d.,]*)\s*([KMB])?\b/.exec(text);
  if (!match) return null;
  const suffix = match[2];
  if (suffix) {
    // "1,2M" is a decimal comma (another locale) — refuse instead of guessing.
    if (match[1].includes(',')) return null;
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) ? Math.round(value * MULTIPLIERS[suffix]) : null;
  }
  // No suffix: an exact count, where "," (or ".") is only a thousands separator.
  const value = Number.parseInt(match[1].replace(/[.,]/g, ''), 10);
  return Number.isFinite(value) ? value : null;
}

export interface ArtistStats {
  monthlyListeners: number | null;
  /** videoId → plays, for the songs in the artist's "Top songs" shelf that show one. */
  playCounts: Record<string, number>;
}

// The raw browse response is deeply nested and untyped; every step tolerates a missing level, because a shape change on
// YouTube's side must cost us the extra numbers, never the artist page.
function dig(value: unknown, ...path: Array<string | number>): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function joinRuns(runs: unknown): string {
  if (!Array.isArray(runs)) return '';
  return runs.map((run) => (typeof dig(run, 'text') === 'string' ? (dig(run, 'text') as string) : '')).join('');
}

export function readArtistStats(raw: unknown): ArtistStats {
  const stats: ArtistStats = { monthlyListeners: null, playCounts: {} };

  const monthly = joinRuns(dig(raw, 'header', 'musicImmersiveHeaderRenderer', 'monthlyListenerCount', 'runs'));
  if (monthly) stats.monthlyListeners = parseCompactCount(monthly);

  const sections = dig(raw, 'contents', 'singleColumnBrowseResultsRenderer', 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer', 'contents');
  for (const section of Array.isArray(sections) ? sections : []) {
    const items = dig(section, 'musicShelfRenderer', 'contents');
    for (const entry of Array.isArray(items) ? items : []) {
      const item = dig(entry, 'musicResponsiveListItemRenderer');
      const videoId = dig(item, 'playlistItemData', 'videoId');
      if (typeof videoId !== 'string') continue;
      const columns = dig(item, 'flexColumns');
      for (const column of Array.isArray(columns) ? columns : []) {
        const text = joinRuns(dig(column, 'musicResponsiveListItemFlexColumnRenderer', 'text', 'runs'));
        if (!/\bplays?\b/i.test(text)) continue;
        const plays = parseCompactCount(text);
        if (plays !== null) stats.playCounts[videoId] = plays;
        break;
      }
    }
  }
  return stats;
}
