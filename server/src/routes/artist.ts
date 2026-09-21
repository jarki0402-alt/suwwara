import { Router } from 'express';
import { getArtistTopSongs } from '../youtube/artist';
import { ALBUM_ID_PATTERN, ARTIST_ID_PATTERN, getAlbumPage, getArtistAllSongs, getArtistPage, resolveArtistId } from '../youtube/artistPage';

export const artistRouter = Router();

artistRouter.get('/artist/:name/songs', async (req, res) => {
  const { name } = req.params;
  if (!name || name.trim().length === 0) {
    res.status(400).json({ error: 'Artist name is required.' });
    return;
  }

  try {
    const limit = Number(req.query.limit) || undefined;
    const result = await getArtistTopSongs(name, limit);
    if (!result) {
      res.status(404).json({ error: 'Artist not found.' });
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch artist songs.', message: (error as Error).message });
  }
});

// --- Artist / album pages -------------------------------------------------------------------
// `/artists/resolve` must stay ahead of `/artists/:artistId` or "resolve" would be read as an id.

artistRouter.get('/artists/resolve', async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name : '';
  if (name.trim().length === 0 || name.length > 120) {
    res.status(400).json({ error: 'A name is required.' });
    return;
  }
  try {
    const artistId = await resolveArtistId(name);
    if (!artistId) {
      res.status(404).json({ error: 'Artist not found.' });
      return;
    }
    res.json({ artistId });
  } catch (error) {
    res.status(502).json({ error: 'Failed to look up the artist.', message: (error as Error).message });
  }
});

artistRouter.get('/artists/:artistId', async (req, res) => {
  const { artistId } = req.params;
  if (!ARTIST_ID_PATTERN.test(artistId)) {
    res.status(400).json({ error: 'Invalid artist id.' });
    return;
  }
  try {
    res.json(await getArtistPage(artistId));
  } catch (error) {
    res.status(502).json({ error: 'Failed to load the artist.', message: (error as Error).message });
  }
});

artistRouter.get('/artists/:artistId/songs', async (req, res) => {
  const { artistId } = req.params;
  if (!ARTIST_ID_PATTERN.test(artistId)) {
    res.status(400).json({ error: 'Invalid artist id.' });
    return;
  }
  try {
    res.json({ songs: await getArtistAllSongs(artistId) });
  } catch (error) {
    res.status(502).json({ error: 'Failed to load the artist songs.', message: (error as Error).message });
  }
});

artistRouter.get('/albums/:albumId', async (req, res) => {
  const { albumId } = req.params;
  if (!ALBUM_ID_PATTERN.test(albumId)) {
    res.status(400).json({ error: 'Invalid album id.' });
    return;
  }
  try {
    res.json(await getAlbumPage(albumId));
  } catch (error) {
    res.status(502).json({ error: 'Failed to load the album.', message: (error as Error).message });
  }
});
