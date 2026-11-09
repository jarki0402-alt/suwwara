import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { deviceAuth } from '../auth/deviceAuth';
import { sql } from '../db/client';
import { kickImportWorker } from '../importer/importWorker';

/**
 * Spotify import (Library -> Impor dari Spotify). The browser reads the Exportify ZIP/CSV itself and sends only the
 * tracks (never the file), the worker matches them in the background, and the device that started it claims each
 * playlist's songs once that playlist is done and adds them to the library, which then syncs like any other edit.
 * deviceAuth per route, like linkRouter: a router-wide one would answer 401 for routers registered after this.
 */
export const spotifyImportRouter = Router();

// Bounded by the body limit too (1mb, index.ts): a track here is ~100 bytes.
const MAX_TRACKS = 6000;
const MAX_PLAYLISTS = 300;

interface IncomingTrack {
  key: string;
  name: string;
  artists: string[];
  durationSec: number;
}

/** In spotify_imports.playlists. `items` point into the tracks by key; addedAt is Spotify's, in ms. */
interface StoredPlaylist {
  name: string;
  liked: boolean;
  items: { key: string; addedAt: number | null }[];
  claimed: boolean;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
}

function parseBody(body: unknown): { tracks: IncomingTrack[]; playlists: StoredPlaylist[] } | string {
  const raw = body as { tracks?: unknown; playlists?: unknown } | null;
  if (!raw || !Array.isArray(raw.tracks) || !Array.isArray(raw.playlists)) return 'tracks and playlists are required';
  if (raw.tracks.length === 0) return 'no tracks';
  if (raw.tracks.length > MAX_TRACKS) return 'too_many_tracks';
  if (raw.playlists.length === 0 || raw.playlists.length > MAX_PLAYLISTS) return 'bad playlist count';

  const tracks: IncomingTrack[] = [];
  const seen = new Set<string>();
  for (const item of raw.tracks as unknown[]) {
    const t = item as Partial<IncomingTrack>;
    const key = cleanText(t.key, 80);
    const name = cleanText(t.name, 300);
    const artists = Array.isArray(t.artists) ? t.artists.map((a) => cleanText(a, 120)).filter(Boolean).slice(0, 12) : [];
    const durationSec = Math.round(Number(t.durationSec));
    if (!key || !name || artists.length === 0 || seen.has(key)) continue;
    if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 3 * 60 * 60) continue;
    seen.add(key);
    tracks.push({ key, name, artists, durationSec });
  }

  const playlists: StoredPlaylist[] = [];
  for (const item of raw.playlists as unknown[]) {
    const p = item as { name?: unknown; liked?: unknown; items?: unknown };
    if (!Array.isArray(p.items)) continue;
    const items = (p.items as unknown[])
      .map((entry) => {
        const e = entry as { key?: unknown; addedAt?: unknown };
        const key = cleanText(e.key, 80);
        const addedAt = Number(e.addedAt);
        return { key, addedAt: Number.isFinite(addedAt) && addedAt > 0 ? addedAt : null };
      })
      .filter((entry) => seen.has(entry.key));
    if (items.length === 0) continue;
    playlists.push({ name: cleanText(p.name, 80) || 'Spotify', liked: p.liked === true, items, claimed: false });
  }
  if (tracks.length === 0 || playlists.length === 0) return 'nothing to import';
  return { tracks, playlists };
}

interface ImportRow {
  id: string;
  status: string;
  playlists: StoredPlaylist[];
  created_at: Date;
}

async function statusOf(row: ImportRow) {
  const tracks = await sql<{ key: string; status: string }[]>`select key, status from spotify_import_tracks where import_id = ${row.id}`;
  const statusByKey = new Map(tracks.map((t) => [t.key, t.status]));
  const isDone = (key: string) => (statusByKey.get(key) ?? 'none') !== 'pending';
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    total: tracks.length,
    done: tracks.filter((t) => t.status !== 'pending').length,
    playlists: row.playlists.map((p, index) => {
      const done = p.items.filter((item) => isDone(item.key)).length;
      return { index, name: p.name, liked: p.liked, total: p.items.length, done, complete: done === p.items.length, claimed: p.claimed };
    }),
  };
}

async function findImport(id: string, accountId: string): Promise<ImportRow | null> {
  const [row] = await sql<ImportRow[]>`
    select id, status, playlists, created_at from spotify_imports where id = ${id} and account_id = ${accountId}`;
  return row ?? null;
}

spotifyImportRouter.post('/import/spotify', deviceAuth, async (req, res) => {
  const parsed = parseBody(req.body);
  if (typeof parsed === 'string') {
    res.status(400).json({ error: parsed });
    return;
  }
  const id = randomUUID();
  try {
    await sql.begin(async (tx) => {
      // One running import per account: a new upload replaces the old one (its finished matches stay in the cache).
      await tx`update spotify_imports set status = 'cancelled', finished_at = now() where account_id = ${req.accountId!} and status = 'running'`;
      await tx`insert into spotify_imports (id, account_id, playlists) values (${id}, ${req.accountId!}, ${tx.json(parsed.playlists as never)})`;
      const rows = parsed.tracks.map((t, position) => ({
        import_id: id,
        key: t.key,
        position,
        name: t.name,
        artists: t.artists,
        duration_sec: t.durationSec,
      }));
      // Chunked: one statement per 1000 rows keeps each under Postgres' parameter limit.
      for (let start = 0; start < rows.length; start += 1000) {
        const chunk = rows.slice(start, start + 1000);
        await tx`
          insert into spotify_import_tracks (import_id, key, position, name, artists, duration_sec)
          select * from jsonb_to_recordset(${tx.json(chunk as never)})
            as r(import_id text, key text, position int, name text, artists jsonb, duration_sec int)`;
      }
    });
  } catch (error) {
    res.status(502).json({ error: 'Failed to start import.', message: (error as Error).message });
    return;
  }
  kickImportWorker();
  const row = await findImport(id, req.accountId!);
  res.status(201).json(row ? await statusOf(row) : { id });
});

/** The account's newest import, so any device can show its progress. 204 when there is none. */
spotifyImportRouter.get('/import/spotify/latest', deviceAuth, async (req, res) => {
  try {
    const [row] = await sql<ImportRow[]>`
      select id, status, playlists, created_at from spotify_imports where account_id = ${req.accountId!}
      order by created_at desc limit 1`;
    if (!row) {
      res.status(204).end();
      return;
    }
    res.json(await statusOf(row));
  } catch (error) {
    res.status(502).json({ error: 'Failed to load import.', message: (error as Error).message });
  }
});

spotifyImportRouter.get('/import/spotify/:id', deviceAuth, async (req, res) => {
  try {
    const row = await findImport(String(req.params.id), req.accountId!);
    if (!row) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(await statusOf(row));
  } catch (error) {
    res.status(502).json({ error: 'Failed to load import.', message: (error as Error).message });
  }
});

/**
 * Hands over a finished playlist's songs exactly once (marks it claimed in the same statement), so two tabs or two
 * devices polling the same import can't both add it and leave the library with the playlist twice.
 */
spotifyImportRouter.post('/import/spotify/:id/playlists/:index/claim', deviceAuth, async (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PLAYLISTS) {
    res.status(400).json({ error: 'bad index' });
    return;
  }
  try {
    const row = await findImport(String(req.params.id), req.accountId!);
    const playlist = row?.playlists[index];
    if (!row || !playlist) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const tracks = await sql<{ key: string; name: string; artists: string[]; status: string; song: unknown }[]>`
      select key, name, artists, status, song from spotify_import_tracks where import_id = ${row.id}`;
    const byKey = new Map(tracks.map((t) => [t.key, t]));
    if (playlist.items.some((item) => byKey.get(item.key)?.status === 'pending')) {
      res.status(409).json({ error: 'not_finished' });
      return;
    }
    const claimed = await sql`
      update spotify_imports set playlists = jsonb_set(playlists, ${`{${index},claimed}`}::text[], 'true'::jsonb)
      where id = ${row.id} and not coalesce((playlists -> ${index}::int ->> 'claimed')::boolean, false)
      returning id`;
    if (claimed.length === 0) {
      res.status(409).json({ error: 'already_claimed' });
      return;
    }
    const songs: { song: unknown; addedAt: number | null; verdict: string }[] = [];
    const missing: { name: string; artists: string[] }[] = [];
    for (const item of playlist.items) {
      const track = byKey.get(item.key);
      if (!track) continue;
      if (track.song && track.status !== 'none') songs.push({ song: track.song, addedAt: item.addedAt, verdict: track.status });
      else missing.push({ name: track.name, artists: track.artists });
    }
    res.json({ name: playlist.name, liked: playlist.liked, songs, missing });
  } catch (error) {
    res.status(502).json({ error: 'Failed to claim playlist.', message: (error as Error).message });
  }
});

spotifyImportRouter.post('/import/spotify/:id/cancel', deviceAuth, async (req, res) => {
  try {
    await sql`
      update spotify_imports set status = 'cancelled', finished_at = now()
      where id = ${String(req.params.id)} and account_id = ${req.accountId!} and status = 'running'`;
    res.status(204).end();
  } catch (error) {
    res.status(502).json({ error: 'Failed to cancel import.', message: (error as Error).message });
  }
});
