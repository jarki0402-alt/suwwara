import { BoundedTtlCache } from './boundedCache';
import { getYTMusic } from './ytmusic';

/**
 * Track lengths for songs whose list entry came without one. YouTube Music leaves the duration out of some shelves
 * (an artist's top songs, chart rows, home shelves), and asking for it there would mean one extra call per song on
 * endpoints that are otherwise a single request — so the client asks for the missing ones AFTER the list is on screen,
 * in one batch (see src/utils/songDurations.ts). `getSong` is ~200ms and a length never changes, so answers are cached
 * for a month; a failed lookup is remembered briefly so a broken id is not retried on every render.
 */
export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
export const MAX_DURATION_IDS = 30;

const LOOKUP_CONCURRENCY = 3;
const LOOKUP_TIMEOUT_MS = 8000;

const known = new BoundedTtlCache<number>(3000, 30 * 24 * 60 * 60 * 1000);
const failed = new BoundedTtlCache<true>(1000, 10 * 60 * 1000);

async function lookUp(videoId: string): Promise<number | null> {
  const ytmusic = await getYTMusic();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('duration lookup timed out')), LOOKUP_TIMEOUT_MS);
  });
  try {
    const song = await Promise.race([ytmusic.getSong(videoId), timeout]);
    return song.duration > 0 ? Math.round(song.duration) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** videoId → seconds, for the ids that could be found. */
export async function getDurations(videoIds: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const pending: string[] = [];
  for (const id of new Set(videoIds)) {
    const cached = known.get(id);
    if (cached !== undefined) result[id] = cached;
    else if (failed.get(id) === undefined) pending.push(id);
  }

  // A few at a time: each is a short call, but a dozen at once on this VM only slows everything else down.
  const worker = async () => {
    for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
      const seconds = await known.getOrLoad(id, async () => {
        const found = await lookUp(id);
        if (found === null) throw new Error('no duration');
        return found;
      }).then(
        (value) => value,
        () => {
          failed.set(id, true);
          return null;
        },
      );
      if (seconds !== null) result[id] = seconds;
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, pending.length) }, worker));
  return result;
}
