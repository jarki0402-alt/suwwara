import { notifyUnauthorized } from '../auth/authStore';
import { getDeviceId } from '../auth/deviceIdentity';
import { parseJsonWithoutEmDash } from '../utils/noEmDash';
import type { ChannelHit, ChannelPage, Episode, EpisodeExtras, EpisodeOverview, Follow, Pick, Progress, Series, SeriesPage } from './types';

/** Calls to routes/podcast.ts. Titles and names are YouTube's, so responses go through the em-dash filter. */

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(new URL(path, window.location.origin), {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${getDeviceId()}`,
    },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    notifyUnauthorized(res.status);
    throw new Error(`HTTP ${res.status}`);
  }
  return parseJsonWithoutEmDash<T>(await res.text());
}

// Always Indonesian, whatever the app's language: asked in English, YouTube replaces Indonesian episode titles (and
// descriptions) with machine translations, and an episode should be listed under the title its creator gave it. The
// counts and dates that come back in Indonesian are put into English on screen instead (ytText.ts). One language
// also means one server cache entry per page, not one per language.
const hl = () => 'id';
const q = encodeURIComponent;

export interface RemoteProgress {
  positionSec: number;
  durationSec: number;
  finished: boolean;
  /** Server clock, epoch ms. */
  updatedAt: number;
}

export const podcastApi = {
  search: async (query: string) =>
    (await call<{ channels: ChannelHit[]; episodes: Episode[] }>(`/api/podcast/search?q=${q(query)}&hl=${hl()}`)) ?? { channels: [], episodes: [] },
  channel: async (id: string) => (await call<ChannelPage>(`/api/podcast/channel/${q(id)}?hl=${hl()}`))!,
  more: async (token: string, channelId: string | null, channelName: string | null) =>
    (await call<{ episodes: Episode[]; more: string | null }>(
      `/api/podcast/more?token=${q(token)}&channelId=${q(channelId ?? '')}&channelName=${q(channelName ?? '')}&hl=${hl()}`,
    )) ?? { episodes: [], more: null },
  seriesList: async (channelId: string, params: string) =>
    (await call<{ series: Series[] }>(`/api/podcast/channel/${q(channelId)}/series?params=${q(params)}&hl=${hl()}`))?.series ?? [],
  series: async (id: string) => (await call<SeriesPage>(`/api/podcast/series/${q(id)}?hl=${hl()}`))!,
  feed: async () => (await call<{ episodes: Episode[] }>('/api/podcast/feed'))?.episodes ?? [],
  episode: async (videoId: string) => (await call<EpisodeOverview>(`/api/podcast/episode/${q(videoId)}?hl=${hl()}`))!,
  extras: async (videoId: string) => (await call<EpisodeExtras>(`/api/podcast/extras/${q(videoId)}`)) ?? { chapters: [], transcript: null },
  state: async () =>
    (await call<{
      follows: Follow[];
      progress: (Omit<Progress, 'episode'> & { videoId: string; episode: Episode })[];
      saved: { videoId: string; episode: Episode }[];
    }>('/api/podcast/state')) ?? { follows: [], progress: [], saved: [] },
  follow: (f: Follow) => call(`/api/podcast/follows/${q(f.channelId)}`, { method: 'PUT', body: JSON.stringify({ name: f.name, avatar: f.avatar }) }),
  unfollow: (channelId: string) => call(`/api/podcast/follows/${q(channelId)}`, { method: 'DELETE' }),
  /** Resolves with the server's time of the write (its clock, not this device's). */
  progress: async (videoId: string, p: { positionSec: number; durationSec: number; finished: boolean; episode: Episode }) =>
    (await call<{ updatedAt: number }>(`/api/podcast/progress/${q(videoId)}`, { method: 'PUT', body: JSON.stringify(p), keepalive: true }))?.updatedAt ?? 0,
  /** One episode's saved spot. Short timeout: it is asked as the episode starts, and a late answer is no use. */
  progressOf: async (videoId: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      return (await call<{ progress: RemoteProgress | null }>(`/api/podcast/progress/${q(videoId)}`, { signal: controller.signal, cache: 'no-store' }))?.progress ?? null;
    } finally {
      clearTimeout(timer);
    }
  },
  save: (episode: Episode) => call(`/api/podcast/saved/${q(episode.id)}`, { method: 'PUT', body: JSON.stringify({ episode }) }),
  unsave: (videoId: string) => call(`/api/podcast/saved/${q(videoId)}`, { method: 'DELETE' }),
  picks: async () => (await call<{ picks: Pick[] }>('/api/podcast/picks'))?.picks ?? [],
};
