/**
 * YouTube itself (not YouTube Music) for the Podcast tab: channel search, a channel's page (banner, videos, playlists),
 * playlists, video search, and the channel RSS feed for new episodes. YT Music only knows music artists, so a
 * storyteller like Nadia Omara is not findable there.
 *
 * The same internal API youtube.com's own page calls ("innertube", POST /youtubei/v1/...), one plain HTTP request each,
 * no yt-dlp. Unofficial, so the parsers below are defensive: a shape that changes yields fewer items, never a throw
 * that takes the page down. A channel page's raw answer is ~400KB; only the compact result is kept (caches in
 * routes/podcast.ts).
 */

const TIMEOUT_MS = 12_000;
const CLIENT_VERSION = '2.20251101.00.00';

export type Hl = 'id' | 'en';

export interface ChannelHit {
  id: string;
  name: string;
  avatar: string;
  /** As YouTube writes it in the asked language ("18,6 jt subscriber"). */
  subscribers: string;
  handle: string;
}

export interface Episode {
  id: string;
  title: string;
  thumbnail: string;
  durationSec: number;
  /** "23 jam yang lalu" etc., as YouTube writes it. Null when the source doesn't say (RSS gives a date instead). */
  publishedText: string | null;
  /** ISO date, from RSS only. */
  publishedAt: string | null;
  viewsText: string | null;
  channelId: string | null;
  channelName: string | null;
}

export interface Series {
  id: string;
  title: string;
  thumbnail: string;
  countText: string;
}

export interface ChannelPage {
  id: string;
  name: string;
  avatar: string;
  banner: string;
  handle: string;
  subscribers: string;
  episodes: Episode[];
  /** Opaque token for the next page of the same list. */
  more: string | null;
  /** Token that reloads the list sorted by popularity (the "Populer" tab). */
  popular: string | null;
  /** browse params for the playlists tab ("Seri"), read from the page so it survives YouTube changing it. */
  seriesParams: string | null;
}

async function innertube(endpoint: 'search' | 'browse' | 'next', body: Record<string, unknown>, hl: Hl): Promise<unknown> {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: CLIENT_VERSION, hl, gl: 'ID' } }, ...body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`YouTube answered ${res.status}`);
  return res.json();
}

// ---- tolerant tree helpers ---------------------------------------------------------------------------------------

type Node = Record<string, unknown>;
const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null;

/** Every value stored under `key` anywhere in the tree, in document order. */
function findAll(tree: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(tree)) {
    for (const item of tree) findAll(item, key, out);
  } else if (isNode(tree)) {
    for (const [k, v] of Object.entries(tree)) {
      if (k === key) out.push(v);
      findAll(v, key, out);
    }
  }
  return out;
}

function at(tree: unknown, ...path: (string | number)[]): unknown {
  let cur = tree;
  for (const step of path) {
    if (Array.isArray(cur) && typeof step === 'number') cur = cur[step];
    else if (isNode(cur) && typeof step === 'string') cur = cur[step];
    else return undefined;
  }
  return cur;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** "33.23", "33:23", "2.41.11" -> seconds (YouTube's Indonesian pages use dots). */
export function parseDuration(text: string): number {
  const parts = text.trim().split(/[.:]/).map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

function lastImage(sources: unknown): string {
  if (!Array.isArray(sources) || sources.length === 0) return '';
  const url = str(at(sources[sources.length - 1], 'url'));
  return url.startsWith('//') ? `https:${url}` : url;
}

function text(v: unknown): string {
  if (!isNode(v)) return '';
  if (typeof v.simpleText === 'string') return v.simpleText;
  if (typeof v.content === 'string') return v.content;
  if (Array.isArray(v.runs)) return v.runs.map((run) => str(at(run, 'text'))).join('');
  return '';
}

/** The stable thumbnail URL for a video, not the signed one in the answer (that one is tied to a size and expires). */
const videoThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

// ---- parsers -----------------------------------------------------------------------------------------------------

export function parseChannelHits(json: unknown): ChannelHit[] {
  return findAll(json, 'channelRenderer')
    .filter(isNode)
    .map((c) => ({
      id: str(c.channelId),
      name: text(c.title),
      avatar: lastImage(at(c, 'thumbnail', 'thumbnails')),
      // YouTube swapped these two fields in its channel results: the handle sits in subscriberCountText and the
      // count in videoCountText. Whichever looks like a handle is the handle.
      ...(() => {
        const a = text(c.subscriberCountText);
        const b = text(c.videoCountText);
        return a.startsWith('@') ? { handle: a, subscribers: b } : { handle: b.startsWith('@') ? b : '', subscribers: a || b };
      })(),
    }))
    .filter((c) => c.id.startsWith('UC') && c.name);
}

/** A video in a channel grid, a playlist, or anywhere YouTube now draws its "lockup". Null for what isn't listenable. */
function lockupEpisode(lockup: Node, channel?: { id: string; name: string }): Episode | null {
  if (lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
  const id = str(lockup.contentId);
  const badges = findAll(lockup.contentImage, 'thumbnailBadgeViewModel');
  // No duration badge: live now or upcoming. Members-only: can't be played without a membership.
  const durationSec = parseDuration(badges.map((b) => str(at(b, 'text'))).find((t) => /\d[.:]\d/.test(t)) ?? '');
  if (!id || durationSec <= 0) return null;
  if (findAll(lockup, 'badgeStyle').includes('BADGE_MEMBERS_ONLY')) return null;
  const parts = findAll(at(lockup, 'metadata', 'lockupMetadataViewModel', 'metadata'), 'metadataParts')
    .flatMap((p) => (Array.isArray(p) ? p : []))
    .map((p) => text(at(p, 'text')));
  // Lists of mixed channels (a video's related videos) name each item's channel in its own metadata.
  const own = channel
    ? null
    : {
        id: str(at(findAll(lockup.metadata, 'browseEndpoint')[0], 'browseId')),
        name: parts.length > 2 ? parts[0] : '',
      };
  return {
    id,
    title: text(at(lockup, 'metadata', 'lockupMetadataViewModel', 'title')),
    thumbnail: videoThumb(id),
    durationSec,
    // "5,4 jt x ditonton • 23 jam yang lalu"; the age is the last part.
    publishedText: parts.length > 1 ? parts[parts.length - 1] : null,
    publishedAt: null,
    viewsText: parts.length > 1 ? parts[parts.length - 2] : (parts[0] ?? null),
    channelId: channel?.id ?? (own?.id.startsWith('UC') ? own.id : null),
    channelName: channel?.name ?? (own?.name || null),
  };
}

const SHORTEST_EPISODE_SEC = 60; // Shorts and trailers aren't something to listen to

export function parseVideoResults(json: unknown): Episode[] {
  return findAll(json, 'videoRenderer')
    .filter(isNode)
    .map((v): Episode | null => {
      const id = str(v.videoId);
      const durationSec = parseDuration(text(v.lengthText));
      if (!id || durationSec < SHORTEST_EPISODE_SEC) return null;
      if (findAll(v.badges, 'style').includes('BADGE_STYLE_TYPE_MEMBERS_ONLY')) return null;
      const owner = at(v, 'ownerText', 'runs', 0);
      return {
        id,
        title: text(v.title),
        thumbnail: videoThumb(id),
        durationSec,
        publishedText: text(v.publishedTimeText) || null,
        publishedAt: null,
        viewsText: text(v.viewCountText) || null,
        channelId: str(at(owner, 'navigationEndpoint', 'browseEndpoint', 'browseId')) || null,
        channelName: text(owner ? { runs: [owner] } : undefined) || null,
      };
    })
    .filter((e): e is Episode => e !== null);
}

function lockupEpisodes(json: unknown, channel?: { id: string; name: string }): Episode[] {
  return findAll(json, 'lockupViewModel')
    .filter(isNode)
    .map((l) => lockupEpisode(l, channel))
    .filter((e): e is Episode => e !== null && e.durationSec >= SHORTEST_EPISODE_SEC);
}

/** The grid's own "load more" token: the continuationItemRenderer at the end of the list, not the ones in menus. */
function gridContinuation(json: unknown): string | null {
  for (const item of findAll(json, 'continuationItemRenderer')) {
    const token = str(at(item, 'continuationEndpoint', 'continuationCommand', 'token'));
    if (token) return token;
  }
  return null;
}

/** The videos tab's sort menu lists Latest, Popular, Oldest in that order (labels are localised, the order isn't). */
function popularToken(json: unknown): string | null {
  const chip = findAll(json, 'chipViewModel').find((c) => at(c, 'displayType') === 'CHIP_VIEW_MODEL_DISPLAY_TYPE_DROP_DOWN');
  const items = findAll(chip, 'listItemViewModel');
  if (items.length < 2) return null;
  return str(findAll(items[1], 'continuationCommand').map((c) => at(c, 'token'))[0]) || null;
}

function seriesTabParams(json: unknown): string | null {
  for (const tab of findAll(json, 'tabRenderer')) {
    const params = str(at(tab, 'endpoint', 'browseEndpoint', 'params'));
    // The playlists tab's params start with the base64 of its name ("\x12\x09playlists").
    if (params.startsWith('EglwbGF5bGlzdH')) return decodeURIComponent(params);
  }
  return null;
}

export function parseChannelPage(json: unknown, id: string): ChannelPage {
  const header = findAll(json, 'pageHeaderViewModel')[0];
  const name = text(at(header, 'title', 'dynamicTextViewModel', 'text')) || text(at(json, 'metadata', 'channelMetadataRenderer', 'title'));
  const metaParts = findAll(at(header, 'metadata'), 'metadataParts')
    .flatMap((p) => (Array.isArray(p) ? p : []))
    .map((p) => text(at(p, 'text')));
  const channel = { id, name };
  return {
    id,
    name,
    avatar: lastImage(at(findAll(header, 'avatarViewModel')[0], 'image', 'sources')) || lastImage(at(json, 'metadata', 'channelMetadataRenderer', 'avatar', 'thumbnails')),
    banner: lastImage(at(findAll(header, 'imageBannerViewModel')[0], 'image', 'sources')),
    handle: metaParts.find((p) => p.startsWith('@')) ?? '',
    subscribers: metaParts.find((p) => /subscriber/i.test(p)) ?? '',
    episodes: lockupEpisodes(json, channel),
    more: gridContinuation(json),
    popular: popularToken(json),
    seriesParams: seriesTabParams(json),
  };
}

// ---- requests ----------------------------------------------------------------------------------------------------

// The videos tab's own params, as youtube.com sends them.
const VIDEOS_TAB = 'EgZ2aWRlb3PyBgQKAjoA';
const CHANNEL_FILTER = 'EgIQAg==';
const VIDEO_FILTER = 'EgIQAQ==';

export async function searchChannels(query: string, hl: Hl): Promise<ChannelHit[]> {
  return parseChannelHits(await innertube('search', { query, params: CHANNEL_FILTER }, hl)).slice(0, 10);
}

export async function searchEpisodes(query: string, hl: Hl): Promise<Episode[]> {
  return parseVideoResults(await innertube('search', { query, params: VIDEO_FILTER }, hl)).slice(0, 20);
}

export async function fetchChannel(id: string, hl: Hl): Promise<ChannelPage> {
  return parseChannelPage(await innertube('browse', { browseId: id, params: VIDEOS_TAB }, hl), id);
}

/** The next page of a channel's list, or the list re-sorted (a sort token answers the same way). */
export async function fetchMore(token: string, hl: Hl, channel: { id: string; name: string }): Promise<{ episodes: Episode[]; more: string | null }> {
  const json = await innertube('browse', { continuation: token }, hl);
  return { episodes: lockupEpisodes(json, channel), more: gridContinuation(json) };
}

export async function fetchSeriesList(channelId: string, params: string, hl: Hl): Promise<Series[]> {
  const json = await innertube('browse', { browseId: channelId, params }, hl);
  return findAll(json, 'lockupViewModel')
    .filter(isNode)
    .filter((l) => l.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST')
    .map((l) => ({
      id: str(l.contentId),
      title: text(at(l, 'metadata', 'lockupMetadataViewModel', 'title')),
      thumbnail: lastImage(at(findAll(l.contentImage, 'thumbnailViewModel')[0], 'image', 'sources')),
      countText: findAll(l.contentImage, 'thumbnailBadgeViewModel').map((b) => str(at(b, 'text'))).find(Boolean) ?? '',
    }))
    .filter((s) => s.id && s.title);
}

export async function fetchSeries(playlistId: string, hl: Hl): Promise<{ title: string; channelId: string | null; channelName: string | null; episodes: Episode[]; more: string | null }> {
  const json = await innertube('browse', { browseId: `VL${playlistId}` }, hl);
  const header = findAll(json, 'pageHeaderViewModel')[0];
  const owner = findAll(json, 'videoOwnerRenderer')[0];
  const channelId = str(at(owner, 'navigationEndpoint', 'browseEndpoint', 'browseId')) || null;
  const channelName = text(at(owner, 'title')) || null;
  const channel = channelId && channelName ? { id: channelId, name: channelName } : undefined;
  return {
    title: text(at(header, 'title', 'dynamicTextViewModel', 'text')),
    channelId,
    channelName,
    episodes: lockupEpisodes(json, channel),
    more: gridContinuation(json),
  };
}

/**
 * The newest 15 uploads, from the channel's public RSS feed: ~30KB, the cheapest way to see what's new for every
 * followed channel. No durations in it, and Shorts are in it (their link is /shorts/), so those are dropped.
 */
export async function fetchFeed(channelId: string): Promise<Episode[]> {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  return parseFeed(await res.text());
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export function parseFeed(xml: string): Episode[] {
  const channelName = unescapeXml(/<author>\s*<name>([^<]*)<\/name>/.exec(xml)?.[1] ?? '') || null;
  const episodes: Episode[] = [];
  for (const entry of xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
    const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry)?.[1] ?? '';
    const link = /<link rel="alternate" href="([^"]+)"/.exec(entry)?.[1] ?? '';
    if (!id || link.includes('/shorts/')) continue;
    episodes.push({
      id,
      title: unescapeXml(/<title>([^<]*)<\/title>/.exec(entry)?.[1] ?? ''),
      thumbnail: videoThumb(id),
      durationSec: 0,
      publishedText: null,
      publishedAt: /<published>([^<]+)<\/published>/.exec(entry)?.[1] ?? null,
      viewsText: null,
      channelId: /<yt:channelId>([^<]+)<\/yt:channelId>/.exec(entry)?.[1] ?? null,
      channelName,
    });
  }
  return episodes;
}

export interface EpisodeOverview {
  id: string;
  title: string;
  /** "8 Nov 2026" and "1 hari yang lalu", as YouTube writes them. */
  dateText: string;
  relativeDate: string;
  viewsText: string;
  /** The video's description: often opens with sponsor links, so the client shows it folded. Capped. */
  description: string;
  channel: { id: string; name: string; avatar: string; subscribers: string } | null;
  /** YouTube's own "up next" for this video: what "Mirip episode ini" and the home recommendations draw from. */
  related: Episode[];
}

const MAX_DESCRIPTION = 5000;

export function parseEpisodeOverview(json: unknown, id: string): EpisodeOverview {
  const primary = findAll(json, 'videoPrimaryInfoRenderer')[0];
  const owner = findAll(json, 'videoOwnerRenderer')[0];
  const ownerId = str(at(owner, 'navigationEndpoint', 'browseEndpoint', 'browseId'));
  const description = str(at(findAll(json, 'attributedDescription')[0], 'content')) || text(findAll(json, 'description')[0]);
  return {
    id,
    title: text(at(primary, 'title')),
    dateText: text(at(primary, 'dateText')),
    relativeDate: text(at(primary, 'relativeDateText')),
    viewsText: text(at(primary, 'viewCount', 'videoViewCountRenderer', 'viewCount')),
    description: description.slice(0, MAX_DESCRIPTION),
    channel: ownerId.startsWith('UC')
      ? { id: ownerId, name: text(at(owner, 'title')), avatar: lastImage(at(owner, 'thumbnail', 'thumbnails')), subscribers: text(at(owner, 'subscriberCountText')) }
      : null,
    related: lockupEpisodes(json).filter((e) => e.id !== id).slice(0, 20),
  };
}

/** One episode's watch-page data (~420KB raw, ~10KB kept): its channel, date, description, and related videos. */
export async function fetchEpisodeOverview(id: string, hl: Hl): Promise<EpisodeOverview> {
  return parseEpisodeOverview(await innertube('next', { videoId: id }, hl), id);
}
