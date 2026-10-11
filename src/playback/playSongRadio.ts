import { getSimilarSongs } from '../api/endpoints/similar';
import type { Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import { addToQueue, canAutoExtendQueue, setQueue } from '../jam/jamQueueActions';
import { loadHistory, recentlyPlayedIds } from '../recommendation/historyLog';
import { useQueueStore } from '../stores/queueStore';

const PRIMARY_LOOKUP = 25;
const TOPUP_LOOKUP = 20;
const QUEUE_LENGTH_CAP = 18;
// How long a song stays off-limits for radio suggestions after being played —
// long enough that it doesn't feel like the same handful of songs on repeat,
// short enough that it can still come back around in a longer session.
const REPEAT_COOLDOWN_MS = 3 * 60 * 60 * 1000;

/**
 * Builds a "radio" queue for a single picked song — genuinely similar tracks anchored
 * strictly to `song`, preserving YouTube Music's high-coherence "up next" similarity ranking.
 *
 * Crucially, this does NOT blend unrelated songs from past listening history as seeds.
 * Blending past history caused mood/genre contamination (e.g. earlier hip-hop sessions
 * suddenly hijacking the radio queue of a slow ballad). History is only referenced for
 * cooldown filtering (`cooldownIds`) so recently heard songs don't immediately repeat.
 */
export async function buildRadioQueue(song: Song, excludeIds: Set<string> = new Set()): Promise<Song[]> {
  const history = loadHistory();
  const cooldownIds = recentlyPlayedIds(REPEAT_COOLDOWN_MS, history);

  try {
    const primaryCandidates = await getSimilarSongs(song.id, PRIMARY_LOOKUP);
    const candidates: Song[] = [];
    const seenIds = new Set<string>();

    for (const candidate of primaryCandidates) {
      if (candidate.id === song.id || excludeIds.has(candidate.id) || cooldownIds.has(candidate.id)) continue;
      if (seenIds.has(candidate.id)) continue;
      seenIds.add(candidate.id);
      candidates.push(candidate);
    }

    // Graceful fallback: if cooldown was so aggressive that it starved the queue to 0
    // (e.g. user has been looping this genre all evening), re-allow cooldown tracks rather
    // than leaving the queue empty.
    if (candidates.length === 0 && primaryCandidates.length > 0) {
      for (const candidate of primaryCandidates) {
        if (candidate.id === song.id || excludeIds.has(candidate.id)) continue;
        if (seenIds.has(candidate.id)) continue;
        seenIds.add(candidate.id);
        candidates.push(candidate);
      }
    }

    // If we still need more tracks to fill the queue, top up using the top candidate
    // from this SAME radio session (guaranteed same mood/vibe), never from historical plays.
    if (candidates.length < QUEUE_LENGTH_CAP && candidates.length > 0) {
      try {
        const topCandidate = candidates[0];
        const secondaryCandidates = await getSimilarSongs(topCandidate.id, TOPUP_LOOKUP);
        for (const candidate of secondaryCandidates) {
          if (candidates.length >= QUEUE_LENGTH_CAP) break;
          if (
            candidate.id === song.id ||
            seenIds.has(candidate.id) ||
            excludeIds.has(candidate.id) ||
            cooldownIds.has(candidate.id)
          ) {
            continue;
          }
          seenIds.add(candidate.id);
          candidates.push(candidate);
        }
      } catch {
        // Top-up failure is non-fatal — preserve whatever candidates we already have.
      }
    }

    return candidates.slice(0, QUEUE_LENGTH_CAP);
  } catch {
    // If fetching similar songs fails (e.g. network/offline), return empty gracefully.
    return [];
  }
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
