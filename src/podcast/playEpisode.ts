import type { ImageVariant, Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import { isCurrentSong, startIfUnchanged } from '../playback/playSongList';
import { addToQueue as addToJamQueue, setQueue } from '../jam/jamQueueActions';
import { useJamStore } from '../stores/jamStore';
import { markEpisode } from './episodeRegistry';
import { usePodcastStore } from './podcastStore';
import type { Episode } from './types';

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

/** The episode after the playing one in the list it was started from, if any and not already heard. */
export function nextEpisodeFor(currentId: string): Episode | null {
  const { context, progress } = usePodcastStore.getState();
  if (!context) return null;
  const index = context.episodes.findIndex((e) => e.id === currentId);
  if (index < 0) return null;
  return context.episodes.slice(index + 1).find((e) => !progress[e.id]?.finished) ?? null;
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
