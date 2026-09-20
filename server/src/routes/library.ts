import { Router } from 'express';
import { sql } from '../db/client';
import { deviceAuth } from '../auth/deviceAuth';
import { bearerDeviceId, deviceRef } from '../auth/deviceRef';
import { notifyLibraryChanged } from '../connect/connectHub';

export const libraryRouter = Router();

libraryRouter.use(deviceAuth);

/**
 * Returns this account's synced liked-songs + playlists snapshot (empty arrays if never synced).
 * `?since=<version>` lets a device that already holds that version skip the download entirely —
 * devices poll this, and the snapshot can be hundreds of KB.
 */
libraryRouter.get('/library', async (req, res) => {
  const since = Number(req.query.since);
  try {
    const [row] = await sql<{ liked_songs: unknown; playlists: unknown; version: string }[]>`
      select liked_songs, playlists, version from library_snapshots where account_id = ${req.accountId!}
    `;
    const version = row ? Number(row.version) : 0;
    if (Number.isFinite(since) && since === version) {
      res.json({ unchanged: true, version });
      return;
    }
    res.json({ likedSongs: row?.liked_songs ?? [], playlists: row?.playlists ?? [], version });
  } catch (error) {
    res.status(502).json({ error: 'Failed to load library.', message: (error as Error).message });
  }
});

/**
 * Whole-snapshot write-through (see server/src/db/schema.ts for why this isn't normalized
 * into per-song rows) — called by the frontend's src/sync/librarySync.ts, debounced, whenever
 * likedSongs/playlists change.
 *
 * `baseVersion` is the version the client last saw. If the account has moved past it, another
 * linked device saved in the meantime: the write is refused with 409 and the current snapshot,
 * and the client merges its changes into it and saves again — instead of silently overwriting
 * what the other device just did.
 */
libraryRouter.put('/library', async (req, res) => {
  const likedSongs = Array.isArray(req.body?.likedSongs) ? req.body.likedSongs : [];
  const playlists = Array.isArray(req.body?.playlists) ? req.body.playlists : [];
  const baseVersion = Number.isFinite(Number(req.body?.baseVersion)) ? Number(req.body.baseVersion) : null;

  try {
    const result = await sql.begin(async (tx) => {
      const [row] = await tx<{ liked_songs: unknown; playlists: unknown; version: string }[]>`
        select liked_songs, playlists, version from library_snapshots where account_id = ${req.accountId!} for update`;
      const current = row ? Number(row.version) : 0;
      if (baseVersion !== null && row && current !== baseVersion) {
        return { conflict: true as const, likedSongs: row.liked_songs, playlists: row.playlists, version: current };
      }
      const next = current + 1;
      await tx`
        insert into library_snapshots (account_id, liked_songs, playlists, updated_at, version)
        values (${req.accountId!}, ${tx.json(likedSongs)}, ${tx.json(playlists)}, now(), ${next})
        on conflict (account_id)
        do update set liked_songs = excluded.liked_songs, playlists = excluded.playlists, updated_at = now(), version = ${next}`;
      return { conflict: false as const, version: next };
    });
    if (result.conflict) {
      res.status(409).json({ conflict: true, likedSongs: result.likedSongs, playlists: result.playlists, version: result.version });
      return;
    }
    // Other linked devices pull it now instead of waiting for their next poll.
    notifyLibraryChanged(req.accountId!, deviceRef(bearerDeviceId(req)), result.version);
    res.json({ version: result.version });
  } catch (error) {
    res.status(502).json({ error: 'Failed to save library.', message: (error as Error).message });
  }
});
