import { getAlbumPage } from './artistPage';
import { BoundedTtlCache } from './boundedCache';
import { normalizeForCompare, stripDecorations } from './lyricsMatch';
import type { SearchSong } from './search';
import { getSimilarSongs } from './similar';
import { cleanTitle } from './textClean';
import { getYTMusic } from './ytmusic';

interface ArtistTopSongs {
  artistName: string;
  /** The artist's own photo — the cover of their "Mix" card on Home. */
  image: string;
  songs: SearchSong[];
}

/** What is kept per artist: the public shape plus what a longer Mix is built from. */
interface LoadedArtist extends ArtistTopSongs {
  artistId: string;
  /** The artist's own releases (albums first, then singles), most representative first. */
  releaseIds: string[];
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Keyed by whatever name the client sends (listening history), so it needs a ceiling (CLAUDE.md rule #1).
const cache = new BoundedTtlCache<LoadedArtist | null>(100, CACHE_TTL_MS);
const mixCache = new BoundedTtlCache<ArtistTopSongs>(100, CACHE_TTL_MS);

/** YT Music's artist page carries only five top songs; a Mix built from that alone felt like a stub. */
export const TOP_SONGS_LIMIT = 5;
export const MAX_MIX_LIMIT = 30;
// How much of the artist's catalogue is read to pad a Mix out: a few releases, a handful of tracks each, so the
// Mix spans several albums instead of being the first album end to end. Each release is one (cached) upstream call.
const RELEASES_READ = 4;
const TRACKS_PER_RELEASE = 5;

function bestThumbnail(thumbnails: { url: string; width: number }[]): string {
  if (thumbnails.length === 0) return '';
  return thumbnails.reduce((best, current) => (current.width > best.width ? current : best)).url;
}

/**
 * "Mix {artist}" home tile — resolves an artist by name (searchArtists, since
 * that's all recommendationEngine.ts's artist affinity map has: display names,
 * not stable ids — see scoring.ts) then pulls their top songs. Uses the same
 * global US/English client as search/similar/trending (not the Indonesia-only
 * one in trendingId.ts) since this needs to resolve whichever artist the
 * user's own history says they listen to most, not a region-curated one.
 *
 * Deliberately getArtist(id).topSongs, NOT the separate getArtistSongs(id)
 * method ytmusic-api also exposes — verified directly against the real API
 * that getArtistSongs() throws a 400 INVALID_ARGUMENT from YouTube's own
 * backend (a bug/limitation in that specific ytmusic-api method, not
 * something wrong on our end), while getArtist()'s own embedded topSongs
 * field returns the same kind of data successfully.
 */
function loadArtist(artistName: string): Promise<LoadedArtist | null> {
  return cache.getOrLoad(artistName, async () => {
    const ytmusic = await getYTMusic();
    const artists = await ytmusic.searchArtists(artistName);
    const artistRef = artists[0];
    if (!artistRef) return null;

    const artist = await ytmusic.getArtist(artistRef.artistId);
    const songs: SearchSong[] = [];
    for (const song of artist.topSongs) {
      if (!song.videoId) continue;
      songs.push({
        id: song.videoId,
        title: cleanTitle(song.name),
        artist: song.artist?.name || artist.name,
        durationSec: song.duration ?? 0,
        thumbnail: bestThumbnail(song.thumbnails),
        album: song.album?.name ?? null,
        albumId: song.album?.albumId ?? null,
        isOfficial: true,
      });
    }

    const releaseIds = [...artist.topAlbums, ...artist.topSingles].map((release) => release.albumId).filter((id): id is string => Boolean(id));
    return {
      artistId: artistRef.artistId,
      releaseIds,
      artistName: artist.name,
      // The search hit's avatar is a square portrait; getArtist's own image is a wide banner.
      image: bestThumbnail(artistRef.thumbnails) || bestThumbnail(artist.thumbnails),
      songs,
    };
  });
}

/**
 * A Mix of `limit` songs: the artist's top songs first, then tracks from a few of their releases, then — if that is
 * still short (a new artist with one EP) — songs YouTube Music calls similar to their top song. Never the same song
 * twice, nor two versions of it ("Song" and "Song - Live").
 */
async function buildMix(base: LoadedArtist, limit: number): Promise<ArtistTopSongs> {
  const songs = [...base.songs];
  const seenIds = new Set(songs.map((song) => song.id));
  const seenTitles = new Set(songs.map((song) => normalizeForCompare(stripDecorations(song.title))));

  const add = (song: SearchSong): boolean => {
    const title = normalizeForCompare(stripDecorations(song.title));
    if (seenIds.has(song.id) || seenTitles.has(title)) return false;
    seenIds.add(song.id);
    seenTitles.add(title);
    songs.push(song);
    return true;
  };

  for (const releaseId of base.releaseIds.slice(0, RELEASES_READ)) {
    if (songs.length >= limit) break;
    try {
      const release = await getAlbumPage(releaseId);
      let taken = 0;
      for (const song of release.songs) {
        // Compilations and "featured on" releases are full of other people's tracks.
        if (song.artistId && song.artistId !== base.artistId) continue;
        if (add(song)) taken += 1;
        if (taken >= TRACKS_PER_RELEASE || songs.length >= limit) break;
      }
    } catch {
      // one release failing to load only makes the Mix a little shorter
    }
  }

  if (songs.length < limit && songs[0]) {
    try {
      for (const song of await getSimilarSongs(songs[0].id, limit)) {
        if (songs.length >= limit) break;
        add(song);
      }
    } catch {
      // same: fewer songs, not an error
    }
  }

  return { artistName: base.artistName, image: base.image, songs: songs.slice(0, limit) };
}

/** `limit` up to TOP_SONGS_LIMIT is just the artist's top songs (cheap: what the Home shelf needs); more builds a Mix. */
export async function getArtistTopSongs(artistName: string, limit = TOP_SONGS_LIMIT): Promise<ArtistTopSongs | null> {
  const base = await loadArtist(artistName);
  if (!base) return null;
  const wanted = Math.min(Math.max(Math.floor(limit), 1), MAX_MIX_LIMIT);
  if (wanted <= TOP_SONGS_LIMIT || wanted <= base.songs.length) return { artistName: base.artistName, image: base.image, songs: base.songs.slice(0, wanted) };
  return mixCache.getOrLoad(`${artistName}|${wanted}`, () => buildMix(base, wanted));
}
