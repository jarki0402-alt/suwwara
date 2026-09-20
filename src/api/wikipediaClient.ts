const BASE_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const FETCH_TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ArtistSummary {
  extract: string;
  thumbnailUrl: string | null;
}

const cache = new Map<string, { summary: ArtistSummary | null; fetchedAt: number }>();

/**
 * Wikipedia's REST summary endpoint — called directly from the browser (no
 * backend proxy) same as LRCLIB's client (lrclibClient.ts): it's a public,
 * CORS-enabled API meant for exactly this kind of client-side use, so
 * routing it through our own backend would just add a hop for no benefit.
 * Best-effort only: an artist with no Wikipedia page, a disambiguation page,
 * or a network hiccup all just mean the "Tentang artis" section quietly
 * doesn't render (see ArtistInfo.tsx) instead of showing an error.
 */
export async function getArtistSummary(artistName: string): Promise<ArtistSummary | null> {
  const cached = cache.get(artistName);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.summary;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let summary: ArtistSummary | null = null;
  try {
    const response = await fetch(`${BASE_URL}/${encodeURIComponent(artistName)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const data = (await response.json()) as { extract?: string; type?: string; thumbnail?: { source?: string } };
      // "disambiguation" pages (name matches multiple unrelated things) have no
      // single useful summary — treated the same as "not found".
      if (data.extract && data.type !== 'disambiguation') {
        summary = { extract: data.extract, thumbnailUrl: data.thumbnail?.source ?? null };
      }
    }
  } catch {
    summary = null;
  } finally {
    clearTimeout(timeoutId);
  }

  cache.set(artistName, { summary, fetchedAt: Date.now() });
  return summary;
}
