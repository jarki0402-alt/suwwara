import { getSimilarSongs } from '../api/endpoints/similar';
import type { Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import { addToQueue, canAutoExtendQueue, setQueue } from '../jam/jamQueueActions';
import { loadHistory, recentlyPlayedIds } from '../recommendation/historyLog';
import { recentDistinctSongIds } from '../recommendation/recommendationEngine';
import { useQueueStore } from '../stores/queueStore';

const SEEDS_PER_QUEUE = 3;
const PER_SEED_LOOKUP = 12;
const QUEUE_LENGTH_CAP = 18;
// How long a song stays off-limits for radio suggestions after being played —
// long enough that it doesn't feel like the same handful of songs on repeat,
// short enough that it can still come back around in a longer session.
const REPEAT_COOLDOWN_MS = 3 * 60 * 60 * 1000;

/**
 * Builds a "radio" queue for a single picked song — genuinely similar tracks, not
 * "more songs by this same artist" (explicitly not the goal here) and not one song's
 * raw up-next chain taken all the way to 20 (YT Music's own signal drifts further from
 * the seed the deeper into that list you go, which is what caused mood swings —
 * calm songs suddenly followed by something loud and unrelated).
 *
 * The mitigation, with no audio/mood ML available: blend a *few* seeds — the clicked
 * song plus a couple of the user's other recent plays — and take only each seed's own
 * top slice (PER_SEED_LOOKUP), not its full length. A candidate that shows up as
 * "similar" to more than one of those seeds is a much stronger coherence signal than
 * anything in one seed's raw ordering, so those get prioritized first.
 */
export async function buildRadioQueue(song: Song, excludeIds: Set<string> = new Set()): Promise<Song[]> {
  const history = loadHistory();
  const otherRecentIds = recentDistinctSongIds(history, SEEDS_PER_QUEUE).filter((id) => id !== song.id);
  const seedIds = [song.id, ...otherRecentIds].slice(0, SEEDS_PER_QUEUE);
  // Time-based, not just "whatever's currently in the queue" — a fresh radio built
  // from a newly-clicked song resets the queue entirely, which would otherwise lose
  // all memory of what just played and let it resurface immediately.
  const cooldownIds = recentlyPlayedIds(REPEAT_COOLDOWN_MS, history);

  const results = await Promise.allSettled(seedIds.map((id) => getSimilarSongs(id, PER_SEED_LOOKUP)));

  const appearanceCount = new Map<string, number>();
  const bySongId = new Map<string, Song>();
  const firstSeenOrder: string[] = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const candidate of result.value) {
      if (candidate.id === song.id || excludeIds.has(candidate.id) || cooldownIds.has(candidate.id)) continue;
      if (!bySongId.has(candidate.id)) {
        bySongId.set(candidate.id, candidate);
        firstSeenOrder.push(candidate.id);
      }
      appearanceCount.set(candidate.id, (appearanceCount.get(candidate.id) ?? 0) + 1);
    }
  }

  // Without this, a candidate that showed up in only ONE of the "other recent plays"
  // seeds — a completely unrelated song from hours ago, possibly a different genre or
  // language than what's actually playing right now — got queued anyway (just ranked
  // lower). That's exactly how a Western pop song's radio ended up pulling in an
  // Indonesian dangdut track: the dangdut song wasn't similar to the seed the user was
  // actually listening to, it was similar to some unrelated song from their history.
  // Now a candidate must EITHER come from the primary seed's own list (the song
  // actually playing) OR be corroborated by at least two seeds — a lone secondary-seed
  // hit, with nothing tying it back to what's playing, gets dropped instead of queued.
  const primaryResult = results[0];
  const primarySeedSucceeded = primaryResult?.status === 'fulfilled';
  const primarySeedIds = new Set(primarySeedSucceeded ? primaryResult.value.map((candidate) => candidate.id) : []);

  const coherentOrder = primarySeedSucceeded
    ? firstSeenOrder.filter((id) => primarySeedIds.has(id) || (appearanceCount.get(id) ?? 0) >= 2)
    : firstSeenOrder; // primary seed fetch failed — nothing to anchor coherence to, fall back to the old blend.

  return coherentOrder
    .sort((a, b) => (appearanceCount.get(b) ?? 0) - (appearanceCount.get(a) ?? 0))
    .map((id) => bySongId.get(id))
    .filter((candidate): candidate is Song => candidate !== undefined)
    .slice(0, QUEUE_LENGTH_CAP);
}

// Module-level (not per-hook-instance) so every caller — the initial radio build
// below, and usePlaybackController's proactive top-up / "queue ran dry" fallback —
// shares one lock. Without this, playing a fresh single-song queue would trigger
// TWO independent radio builds for the same seed at once (this function's own call,
// plus the proactive effect noticing the queue is down to 0 remaining tracks and
// topping it up itself) — neither aware of the other's still-in-flight candidates,
// so the same song could get added to the queue twice once both resolved.
let queueExtensionInFlight = false;

/**
 * Builds a radio extension from `seedSong` and appends it to the queue, guarded by
 * the shared in-flight lock above. `guard` (if given) is re-checked right before
 * appending, in case the queue moved on to something unrelated while this awaited.
 */
export async function extendQueueWithRadio(seedSong: Song, guard?: () => boolean): Promise<void> {
  // In a Jam, only the room's creator auto-extends the shared queue (see
  // canAutoExtendQueue's own doc comment) — avoids several devices
  // independently adding different filler songs at the same moment.
  if (!canAutoExtendQueue()) return;
  if (queueExtensionInFlight) return;
  queueExtensionInFlight = true;
  try {
    const excludeIds = new Set(useQueueStore.getState().queue.map((existing) => existing.id));
    const extension = await buildRadioQueue(seedSong, excludeIds);
    if (guard && !guard()) return;
    for (const candidate of extension) {
      addToQueue(candidate);
    }
  } finally {
    queueExtensionInFlight = false;
  }
}

/**
 * Starts playback of a single song picked from an incidental context (search
 * results, browse category, trending, recommendations) — see buildRadioQueue for why
 * this isn't just "queue the rest of whatever list it came from" (that list has no
 * reason to sound like the picked song) or "one song's raw up-next chain" (drifts).
 *
 * Deliberately NOT used for intentional/curated lists (a playlist, Liked Songs) —
 * there, "the rest of the list" already IS what the user wants queued next.
 */
export function playSongRadio(song: Song): void {
  void audioEngine.unlock();
  setQueue([song], 0);

  // The user may have already moved on (clicked something else) while this was
  // loading — don't append stale suggestions onto an unrelated queue.
  void extendQueueWithRadio(song, () => {
    const { queue } = useQueueStore.getState();
    return queue.length === 1 && queue[0]?.id === song.id;
  }).catch(() => {
    // Radio queue is a nicety — if it fails, the single picked song still plays fine.
  });
}
