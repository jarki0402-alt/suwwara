import { Router, type Request } from 'express';
import { deviceAuth } from '../auth/deviceAuth';
import { requireAdmin } from '../auth/sessions';
import { sql } from '../db/client';
import { getEpisodeExtras } from '../podcast/extras';
import {
  fetchChannel,
  fetchEpisodeOverview,
  fetchFeed,
  fetchMore,
  fetchSeries,
  fetchSeriesList,
  searchChannels,
  searchEpisodes,
  type ChannelPage,
  type EpisodeOverview,
  type Episode,
  type Hl,
  type Series,
} from '../podcast/youtubeClient';
import { BoundedTtlCache } from '../youtube/boundedCache';

/**
 * The Podcast tab: YouTube channels and their videos, listened to as audio (the audio itself goes through
 * /api/audio like a song, see routes/audio.ts). Reads from YouTube are cached in memory with hard caps (CLAUDE.md #1);
 * a channel page's raw answer is ~400KB but only its compact form (~30 episodes) is kept. Per-account state (follows,
 * positions, saved) is in Postgres. deviceAuth per route like linkRouter, so it is safe ahead of authRouter.
 */
export const podcastRouter = Router();

const searches = new BoundedTtlCache<{ channels: unknown[]; episodes: Episode[] }>(200, 10 * 60 * 1000);
const channels = new BoundedTtlCache<ChannelPage>(100, 30 * 60 * 1000);
const pages = new BoundedTtlCache<{ episodes: Episode[]; more: string | null }>(200, 30 * 60 * 1000);
const seriesLists = new BoundedTtlCache<Series[]>(100, 60 * 60 * 1000);
const seriesPages = new BoundedTtlCache<Awaited<ReturnType<typeof fetchSeries>>>(100, 30 * 60 * 1000);
// An episode's overview doesn't change much in a few hours, and the home recommendations ask for the same few.
const overviews = new BoundedTtlCache<EpisodeOverview>(300, 6 * 60 * 60 * 1000);
// Shared by everyone following the channel: one feed read per channel per half hour, however many followers.
const feeds = new BoundedTtlCache<Episode[]>(500, 30 * 60 * 1000);

const hlOf = (req: Request): Hl => (req.query.hl === 'en' ? 'en' : 'id');
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

function fail(res: { status: (n: number) => { json: (b: unknown) => void } }, error: unknown, what: string): void {
  res.status(502).json({ error: `Failed to load ${what}.`, message: (error as Error).message });
}

// ---- YouTube reads -----------------------------------------------------------------------------------------------

podcastRouter.get('/podcast/search', deviceAuth, async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (!query) {
    res.json({ channels: [], episodes: [] });
    return;
  }
  const hl = hlOf(req);
  try {
    res.json(
      await searches.getOrLoad(`${hl}|${query.toLowerCase()}`, async () => {
        const [foundChannels, episodes] = await Promise.all([searchChannels(query, hl), searchEpisodes(query, hl).catch(() => [])]);
        return { channels: foundChannels, episodes };
      }),
    );
  } catch (error) {
    fail(res, error, 'search');
  }
});

podcastRouter.get('/podcast/channel/:id', deviceAuth, async (req, res) => {
  const id = String(req.params.id);
  if (!CHANNEL_ID.test(id)) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  const hl = hlOf(req);
  try {
    res.json(await channels.getOrLoad(`${hl}|${id}`, () => fetchChannel(id, hl)));
  } catch (error) {
    fail(res, error, 'channel');
  }
});

/** The next page of a channel's or a series' list, or the list sorted by popularity (`token` from the page). */
podcastRouter.get('/podcast/more', deviceAuth, async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const channelId = typeof req.query.channelId === 'string' && CHANNEL_ID.test(req.query.channelId) ? req.query.channelId : '';
  const channelName = typeof req.query.channelName === 'string' ? req.query.channelName.slice(0, 120) : '';
  if (!token || token.length > 2000) {
    res.status(400).json({ error: 'bad token' });
    return;
  }
  const hl = hlOf(req);
  try {
    res.json(await pages.getOrLoad(`${hl}|${token}`, () => fetchMore(token, hl, { id: channelId, name: channelName })));
  } catch (error) {
    fail(res, error, 'episodes');
  }
});

podcastRouter.get('/podcast/channel/:id/series', deviceAuth, async (req, res) => {
  const id = String(req.params.id);
  const params = typeof req.query.params === 'string' ? req.query.params : '';
  if (!CHANNEL_ID.test(id) || !params || params.length > 200) {
    res.status(400).json({ error: 'bad request' });
    return;
  }
  const hl = hlOf(req);
  try {
    res.json({ series: await seriesLists.getOrLoad(`${hl}|${id}`, () => fetchSeriesList(id, params, hl)) });
  } catch (error) {
    fail(res, error, 'series');
  }
});

podcastRouter.get('/podcast/series/:id', deviceAuth, async (req, res) => {
  const id = String(req.params.id);
  if (!PLAYLIST_ID.test(id)) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  const hl = hlOf(req);
  try {
    res.json(await seriesPages.getOrLoad(`${hl}|${id}`, () => fetchSeries(id, hl)));
  } catch (error) {
    fail(res, error, 'series');
  }
});

/** New uploads from every followed channel, newest first. A feed that fails just leaves its channel out. */
podcastRouter.get('/podcast/feed', deviceAuth, async (req, res) => {
  try {
    const follows = await sql<{ channel_id: string }[]>`select channel_id from podcast_follows where account_id = ${req.accountId!}`;
    const lists = await Promise.all(follows.map((f) => feeds.getOrLoad(f.channel_id, () => fetchFeed(f.channel_id)).catch(() => [] as Episode[])));
    const episodes = lists
      .flat()
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
      .slice(0, 40);
    res.json({ episodes });
  } catch (error) {
    fail(res, error, 'feed');
  }
});

podcastRouter.get('/podcast/episode/:videoId', deviceAuth, async (req, res) => {
  const videoId = String(req.params.videoId);
  if (!VIDEO_ID.test(videoId)) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  const hl = hlOf(req);
  try {
    res.json(await overviews.getOrLoad(`${hl}|${videoId}`, () => fetchEpisodeOverview(videoId, hl)));
  } catch (error) {
    fail(res, error, 'episode');
  }
});

podcastRouter.get('/podcast/extras/:videoId', deviceAuth, async (req, res) => {
  const videoId = String(req.params.videoId);
  if (!VIDEO_ID.test(videoId)) {
    res.status(400).json({ error: 'bad id' });
    return;
  }
  try {
    res.json(await getEpisodeExtras(videoId));
  } catch (error) {
    fail(res, error, 'extras');
  }
});

// ---- per-account state -------------------------------------------------------------------------------------------

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const httpsUrl = (v: unknown): string => {
  const url = clean(v, 500);
  return /^https:\/\//.test(url) ? url : '';
};

/** What the client sends to describe an episode; kept so lists render without asking YouTube again. */
function cleanEpisode(raw: unknown): Record<string, unknown> | null {
  const e = (raw ?? {}) as Record<string, unknown>;
  const id = clean(e.id, 20);
  if (!VIDEO_ID.test(id)) return null;
  return {
    id,
    title: clean(e.title, 300),
    thumbnail: httpsUrl(e.thumbnail),
    durationSec: Math.max(0, Math.round(Number(e.durationSec) || 0)),
    channelId: CHANNEL_ID.test(clean(e.channelId, 30)) ? clean(e.channelId, 30) : null,
    channelName: clean(e.channelName, 120) || null,
  };
}

// Positions are only useful for what was heard recently; older rows are dropped past this.
const MAX_PROGRESS_ROWS = 300;

podcastRouter.get('/podcast/state', deviceAuth, async (req, res) => {
  const account = req.accountId!;
  try {
    const [follows, progress, saved] = await Promise.all([
      sql`select channel_id as "channelId", name, avatar, followed_at as "followedAt" from podcast_follows where account_id = ${account} order by followed_at desc`,
      sql`select video_id as "videoId", position_sec as "positionSec", duration_sec as "durationSec", finished, episode,
                 (extract(epoch from updated_at) * 1000)::bigint as "updatedAt"
          from podcast_progress where account_id = ${account} order by updated_at desc limit ${MAX_PROGRESS_ROWS}`,
      sql`select video_id as "videoId", episode, saved_at as "savedAt" from podcast_saved where account_id = ${account} order by saved_at desc`,
    ]);
    res.json({ follows, progress: progress.map((p) => ({ ...p, updatedAt: Number(p.updatedAt) })), saved });
  } catch (error) {
    fail(res, error, 'podcast state');
  }
});

podcastRouter.put('/podcast/follows/:channelId', deviceAuth, async (req, res) => {
  const channelId = String(req.params.channelId);
  const name = clean(req.body?.name, 120);
  if (!CHANNEL_ID.test(channelId) || !name) {
    res.status(400).json({ error: 'bad request' });
    return;
  }
  try {
    await sql`
      insert into podcast_follows (account_id, channel_id, name, avatar) values (${req.accountId!}, ${channelId}, ${name}, ${httpsUrl(req.body?.avatar)})
      on conflict (account_id, channel_id) do update set name = excluded.name, avatar = excluded.avatar`;
    res.status(204).end();
  } catch (error) {
    fail(res, error, 'follow');
  }
});

podcastRouter.delete('/podcast/follows/:channelId', deviceAuth, async (req, res) => {
  try {
    await sql`delete from podcast_follows where account_id = ${req.accountId!} and channel_id = ${String(req.params.channelId)}`;
    res.status(204).end();
  } catch (error) {
    fail(res, error, 'unfollow');
  }
});

// One episode's spot, asked for the moment it starts playing on a device: a primary-key read, so cheap enough to ask
// every time rather than trusting a copy pulled minutes ago while another device kept listening.
podcastRouter.get('/podcast/progress/:videoId', deviceAuth, async (req, res) => {
  try {
    const [row] = await sql`
      select position_sec as "positionSec", duration_sec as "durationSec", finished, (extract(epoch from updated_at) * 1000)::bigint as "updatedAt"
      from podcast_progress where account_id = ${req.accountId!} and video_id = ${String(req.params.videoId)}`;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ progress: row ? { ...row, updatedAt: Number(row.updatedAt) } : null });
  } catch (error) {
    fail(res, error, 'progress');
  }
});

podcastRouter.put('/podcast/progress/:videoId', deviceAuth, async (req, res) => {
  const episode = cleanEpisode({ ...req.body?.episode, id: req.params.videoId });
  const position = Number(req.body?.positionSec);
  const duration = Number(req.body?.durationSec);
  if (!episode || !Number.isFinite(position) || position < 0 || !Number.isFinite(duration) || duration < 0) {
    res.status(400).json({ error: 'bad request' });
    return;
  }
  const account = req.accountId!;
  try {
    const [row] = await sql<{ updatedAt: string }[]>`
      insert into podcast_progress (account_id, video_id, position_sec, duration_sec, finished, episode, updated_at)
      values (${account}, ${episode.id as string}, ${position}, ${duration}, ${req.body?.finished === true}, ${sql.json(episode as never)}, now())
      on conflict (account_id, video_id) do update set position_sec = excluded.position_sec, duration_sec = excluded.duration_sec,
        finished = excluded.finished, episode = excluded.episode, updated_at = now()
      returning (extract(epoch from updated_at) * 1000)::bigint as "updatedAt"`;
    await sql`
      delete from podcast_progress where account_id = ${account} and video_id in (
        select video_id from podcast_progress where account_id = ${account} order by updated_at desc offset ${MAX_PROGRESS_ROWS})`;
    // The server's clock, so a device can later tell its own write from a newer one by another device (usePodcastPlayback).
    res.json({ updatedAt: Number(row?.updatedAt ?? 0) });
  } catch (error) {
    fail(res, error, 'progress');
  }
});

podcastRouter.put('/podcast/saved/:videoId', deviceAuth, async (req, res) => {
  const episode = cleanEpisode({ ...req.body?.episode, id: req.params.videoId });
  if (!episode) {
    res.status(400).json({ error: 'bad request' });
    return;
  }
  try {
    await sql`
      insert into podcast_saved (account_id, video_id, episode) values (${req.accountId!}, ${episode.id as string}, ${sql.json(episode as never)})
      on conflict (account_id, video_id) do nothing`;
    res.status(204).end();
  } catch (error) {
    fail(res, error, 'save');
  }
});

podcastRouter.delete('/podcast/saved/:videoId', deviceAuth, async (req, res) => {
  try {
    await sql`delete from podcast_saved where account_id = ${req.accountId!} and video_id = ${String(req.params.videoId)}`;
    res.status(204).end();
  } catch (error) {
    fail(res, error, 'unsave');
  }
});

// ---- the admin's picks ---------------------------------------------------------------------------------------------

podcastRouter.get('/podcast/picks', async (_req, res) => {
  try {
    res.json({ picks: await sql`select channel_id as "channelId", name, avatar, subscribers from podcast_picks order by position, added_at` });
  } catch (error) {
    fail(res, error, 'picks');
  }
});

podcastRouter.put('/admin/podcast/picks/:channelId', requireAdmin, async (req, res) => {
  const channelId = String(req.params.channelId);
  const name = clean(req.body?.name, 120);
  if (!CHANNEL_ID.test(channelId) || !name) {
    res.status(400).json({ error: 'bad request' });
    return;
  }
  try {
    await sql`
      insert into podcast_picks (channel_id, name, avatar, subscribers, position)
      values (${channelId}, ${name}, ${httpsUrl(req.body?.avatar)}, ${clean(req.body?.subscribers, 60)}, (select coalesce(max(position), 0) + 1 from podcast_picks))
      on conflict (channel_id) do update set name = excluded.name, avatar = excluded.avatar, subscribers = excluded.subscribers`;
    res.status(204).end();
  } catch (error) {
    fail(res, error, 'pick');
  }
});

podcastRouter.delete('/admin/podcast/picks/:channelId', requireAdmin, async (req, res) => {
  try {
    await sql`delete from podcast_picks where channel_id = ${String(req.params.channelId)}`;
    res.status(204).end();
  } catch (error) {
    fail(res, error, 'pick');
  }
});

/** Channel search for the admin's picks: admins have no device bearer (no library), so not behind deviceAuth. */
podcastRouter.get('/admin/podcast/search', requireAdmin, async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  try {
    res.json({ channels: query ? await searchChannels(query, 'id') : [] });
  } catch (error) {
    fail(res, error, 'search');
  }
});
