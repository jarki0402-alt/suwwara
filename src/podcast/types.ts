/** Shapes of the Podcast tab's data, as server/src/podcast/youtubeClient.ts and routes/podcast.ts send them. */

export interface Episode {
  id: string;
  title: string;
  thumbnail: string;
  /** 0 when the source doesn't say (the RSS feed of new episodes). */
  durationSec: number;
  publishedText?: string | null;
  publishedAt?: string | null;
  viewsText?: string | null;
  channelId: string | null;
  channelName: string | null;
}

export interface ChannelHit {
  id: string;
  name: string;
  avatar: string;
  subscribers: string;
  handle: string;
}

export interface ChannelPage {
  id: string;
  name: string;
  avatar: string;
  banner: string;
  handle: string;
  subscribers: string;
  episodes: Episode[];
  more: string | null;
  popular: string | null;
  seriesParams: string | null;
}

export interface Series {
  id: string;
  title: string;
  thumbnail: string;
  countText: string;
}

export interface SeriesPage {
  title: string;
  channelId: string | null;
  channelName: string | null;
  episodes: Episode[];
  more: string | null;
}

export interface Follow {
  channelId: string;
  name: string;
  avatar: string;
}

export interface Progress {
  positionSec: number;
  durationSec: number;
  finished: boolean;
  updatedAt: number;
  episode: Episode;
}

export interface Chapter {
  title: string;
  start: number;
}

export interface EpisodeExtras {
  chapters: Chapter[];
  transcript: { lang: string | null; auto: boolean; cues: { s: number; t: string }[] } | null;
}

export interface EpisodeOverview {
  id: string;
  title: string;
  dateText: string;
  relativeDate: string;
  viewsText: string;
  description: string;
  channel: { id: string; name: string; avatar: string; subscribers: string } | null;
  related: Episode[];
}

export interface Pick {
  channelId: string;
  name: string;
  avatar: string;
  subscribers: string;
}
