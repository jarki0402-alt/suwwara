import YTMusic from 'ytmusic-api';

let instance: YTMusic | null = null;
let initPromise: Promise<YTMusic> | null = null;

/**
 * Singleton YouTube Music client. Ported as-is from server/src/youtube/ytmusic.ts
 * — this module has no Node-specific/Express coupling, so it's identical here.
 * On Vercel's serverless model this singleton only helps within one warm
 * instance (Fluid Compute reuse), not across cold starts — that's fine, the
 * cost being avoided is per-*request* re-init within a burst, not global.
 */
export async function getYTMusic(): Promise<YTMusic> {
  if (instance) return instance;
  if (!initPromise) {
    initPromise = (async () => {
      const client = new YTMusic();
      await client.initialize({ GL: 'US', HL: 'en' });
      instance = client;
      return client;
    })();
  }
  return initPromise;
}
