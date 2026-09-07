import { Router } from 'express';
import { sql } from '../db/client';
import { deviceAuth } from '../auth/deviceAuth';

export const libraryRouter = Router();

libraryRouter.use(deviceAuth);

/** Returns this account's synced liked-songs + playlists snapshot (empty arrays if never synced). */
libraryRouter.get('/library', async (req, res) => {
  try {
    const [row] = await sql<{ liked_songs: unknown; playlists: unknown }[]>`
      select liked_songs, playlists from library_snapshots where account_id = ${req.accountId!}
    `;
    res.json({ likedSongs: row?.liked_songs ?? [], playlists: row?.playlists ?? [] });
  } catch (error) {
    res.status(502).json({ error: 'Failed to load library.', message: (error as Error).message });
  }
});

/**
 * Whole-snapshot write-through (see server/src/db/schema.ts for why this
 * isn't normalized into per-song rows) — called by the frontend's
 * src/sync/librarySync.ts, debounced, whenever likedSongs/playlists change.
 * Last-write-wins is an intentional, acceptable simplification here: casual
 * family use, not a system that needs conflict resolution.
 */
libraryRouter.put('/library', async (req, res) => {
  const likedSongs = Array.isArray(req.body?.likedSongs) ? req.body.likedSongs : [];
  const playlists = Array.isArray(req.body?.playlists) ? req.body.playlists : [];

  try {
    await sql`
      insert into library_snapshots (account_id, liked_songs, playlists, updated_at)
      values (${req.accountId!}, ${sql.json(likedSongs)}, ${sql.json(playlists)}, now())
      on conflict (account_id)
      do update set liked_songs = excluded.liked_songs, playlists = excluded.playlists, updated_at = now()
    `;
    res.status(204).end();
  } catch (error) {
    res.status(502).json({ error: 'Failed to save library.', message: (error as Error).message });
  }
});
