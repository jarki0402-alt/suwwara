import YTMusic from 'ytmusic-api';

let instance: YTMusic | null = null;
let initPromise: Promise<YTMusic> | null = null;

/**
 * Singleton YouTube Music client. Unlike youtube-sr (which scrapes generic
 * youtube.com search and returns any matching video — vlogs, reactions,
 * fancams), this talks to YouTube Music's own internal API, which is scoped
 * to actual catalog songs/albums/artists — this is what keeps search results
 * "music only" and makes search itself faster (a real indexed API call
 * instead of parsing a search-results page).
 */
export async function getYTMusic(): Promise<YTMusic> {
  if (instance) return instance;
  if (!initPromise) {
    initPromise = (async () => {
      const client = new YTMusic();
      // Forces the US/English catalog regardless of where this backend
      // happens to run — without this, YT Music's region-aware ranking can
      // surface locally-trending (e.g. Bollywood) results for generic
      // queries, which is exactly the non-global bias this app avoids.
      await client.initialize({ GL: 'US', HL: 'en' });
      instance = client;
      return client;
    })();
  }
  return initPromise;
}
