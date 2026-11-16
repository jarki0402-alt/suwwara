import type { ImageVariant, Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import { isCurrentSong, startIfUnchanged } from '../playback/playSongList';
import { addToQueue as addToJamQueue, setQueue } from '../jam/jamQueueActions';
import { useJamStore } from '../stores/jamStore';
import { markEpisode } from './episodeRegistry';
import { usePodcastStore } from './podcastStore';
import type { Episode } from './types';
import type { PlayContext } from './podcastStore';

/**
 * An episode as the player's Song. The channel stands in for the artist (its id is the channel id, so nothing
 * mistakes it for a YT Music artist page). Thumbnails: mqdefault is 16:9 with no bars; hqdefault is 4:3 with the
 * 16:9 frame letterboxed in it, which the 16:9 artwork box crops away exactly (object-fit: cover).
 */
export function episodeToSong(episode: Episode): Song {
  markEpisode(episode.id);
  const channel = episode.channelName ?? '';
  const artist = { id: episode.channelId ?? channel, name: channel, role: 'channel', image: [], url: '' };
  const image: ImageVariant[] = [
    { quality: '50x50', url: `https://i.ytimg.com/vi/${episode.id}/mqdefault.jpg` },
    { quality: '150x150', url: `https://i.ytimg.com/vi/${episode.id}/mqdefault.jpg` },
    { quality: '500x500', url: `https://i.ytimg.com/vi/${episode.id}/hqdefault.jpg` },
  ];
  return {
    id: episode.id,
    name: episode.title,
    duration: episode.durationSec,
    album: null,
    year: null,
    language: '',
    hasLyrics: false,
    lyricsId: null,
    artists: { primary: [artist], featured: [], all: [artist] },
    image,
    kind: 'episode',
    ...(episode.channelId ? { channelId: episode.channelId } : {}),
  };
}

export function songToEpisode(song: Song): Episode {
  return {
    id: song.id,
    title: song.name,
    thumbnail: `https://i.ytimg.com/vi/${song.id}/hqdefault.jpg`,
    durationSec: song.duration,
    channelId: song.channelId ?? null,
    channelName: song.artists.primary[0]?.name ?? null,
  };
}

/**
 * Plays one episode on its own: a queue of one, so nothing follows it (no radio, no next song), and remembers the
 * list it came from for the "Berikutnya" offer near its end. Like playSongList, call it straight from the tap: unlock()
 * must run inside the user gesture. In a Jam it replaces the room's queue for everyone, exactly like playing a song
 * there (jamQueueActions.setQueue): a podcast listened to together.
 */
export function playEpisode(episode: Episode, from: Episode[] = []): boolean {
  void audioEngine.unlock();
  const wasCurrent = isCurrentSong(episode.id);
  usePodcastStore.getState().setContext({ episodes: from.length > 0 ? from : [episode] });
  setQueue([episodeToSong(episode)], 0);
  startIfUnchanged(wasCurrent);
  return true;
}

// Clips and trailers in YouTube's "up next" are not the next episode of anything.
const MIN_AUTO_NEXT_SEC = 5 * 60;
// Episodes this session already continued into: YouTube's up next often points back at the one just heard (A, B, A).
const MAX_RECENT = 50;
const recentlyContinued: string[] = [];

export function noteContinued(id: string): void {
  recentlyContinued.push(id);
  if (recentlyContinued.length > MAX_RECENT) recentlyContinued.shift();
}

/**
 * What an episode continues into when the listener queued nothing (2026-11: episodes used to just stop, and a friend
 * listening to a horror series had to pick every next one by hand). In order:
 *  1. the next one in the list it was started from, when that list is this same show (a channel's or a series' page):
 *     part 2 after part 1;
 *  2. YouTube's own "up next" for this episode (EpisodeOverview.related), in YouTube's order: a horror story leads to
 *     horror, a business talk to business, the way YouTube's autoplay does;
 *  3. the next one in the list it was started from, whatever the show (a search for "horor" is horror too).
 * Never one already heard to the end, one continued into this session, or one too short to be an episode.
 */
export function pickUpNext(input: {
  current: { id: string; channelId: string | null };
  related: Episode[];
  context: PlayContext | null;
  finished: (id: string) => boolean;
  recent?: readonly string[];
}): Episode | null {
  const recent = input.recent ?? recentlyContinued;
  const usable = (episode: Episode) =>
    episode.id !== input.current.id &&
    !input.finished(episode.id) &&
    !recent.includes(episode.id) &&
    (episode.durationSec === 0 || episode.durationSec >= MIN_AUTO_NEXT_SEC);
  const list = input.context?.episodes ?? [];
  const index = list.findIndex((episode) => episode.id === input.current.id);
  const after = index >= 0 ? list.slice(index + 1).filter(usable) : [];
  const sameShow = after.find((episode) => input.current.channelId !== null && episode.channelId === input.current.channelId);
  return sameShow ?? input.related.find(usable) ?? after[0] ?? null;
}

/** The episode after the playing one in the list it was started from, if any and not already heard. */
export function nextEpisodeFor(currentId: string): Episode | null {
  const { context, progress } = usePodcastStore.getState();
  if (!context) return null;
  const index = context.episodes.findIndex((e) => e.id === currentId);
  if (index < 0) return null;
  return context.episodes.slice(index + 1).find((e) => !progress[e.id]?.finished) ?? null;
}

/**
 * What follows `currentId` at its end when nothing is queued: the pick made while it played (usePodcastPlayback), or,
 * if YouTube's up next had not arrived yet, the next one in its list. Null when its "Berikutnya" card was closed.
 */
export function upNextFor(currentId: string): Episode | null {
  const { upNext, autoNextOffFor } = usePodcastStore.getState();
  if (autoNextOffFor === currentId) return null;
  if (upNext && upNext.after === currentId) return upNext.episode;
  return nextEpisodeFor(currentId);
}

/**
 * Starts `episode` because the one before it ended (not a tap): same as playEpisode without unlock(), which counts as
 * the listener asking this device to play (Connect reads that), and an automatic start must not.
 */
export function continueWithEpisode(episode: Episode): void {
  noteContinued(episode.id);
  const { context } = usePodcastStore.getState();
  // Still inside the list it came from: keep that list, so its own next part follows it.
  const from = context && context.episodes.some((e) => e.id === episode.id) ? context.episodes : [episode];
  usePodcastStore.getState().setContext({ episodes: from });
  setQueue([episodeToSong(episode)], 0);
}

/**
 * "Tambahkan ke antrean" for an episode: this device's podcast queue (what plays after the current episode ends), or,
 * in a Jam, the room's queue that everyone shares. Returns which, for the toast.
 */
export function queueEpisode(episode: Episode): 'jam' | 'podcast' {
  if (useJamStore.getState().role !== 'solo') {
    addToJamQueue(episodeToSong(episode));
    return 'jam';
  }
  usePodcastStore.getState().addToQueue(episode);
  return 'podcast';
}
