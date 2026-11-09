import { notifyUnauthorized } from '../auth/authStore';
import { getDeviceId } from '../auth/deviceIdentity';
import { useLanguageStore } from '../i18n/i18n';
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

// YouTube writes counts and dates in the asked language ("18,6 jt subscriber" / "18.6M subscribers").
const hl = () => (useLanguageStore.getState().locale === 'en' ? 'en' : 'id');
const q = encodeURIComponent;

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
  progress: (videoId: string, p: { positionSec: number; durationSec: number; finished: boolean; episode: Episode }) =>
    call(`/api/podcast/progress/${q(videoId)}`, { method: 'PUT', body: JSON.stringify(p), keepalive: true }),
  save: (episode: Episode) => call(`/api/podcast/saved/${q(episode.id)}`, { method: 'PUT', body: JSON.stringify({ episode }) }),
  unsave: (videoId: string) => call(`/api/podcast/saved/${q(videoId)}`, { method: 'DELETE' }),
  picks: async () => (await call<{ picks: Pick[] }>('/api/podcast/picks'))?.picks ?? [],
};
