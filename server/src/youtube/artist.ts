import { BoundedTtlCache } from './boundedCache';
import type { SearchSong } from './search';
import { cleanTitle } from './textClean';
import { getYTMusic } from './ytmusic';

interface ArtistTopSongs {
  artistName: string;
  /** The artist's own photo — the cover of their "Mix" card on Home. */
  image: string;
  songs: SearchSong[];
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// Keyed by whatever name the client sends (listening history), so it needs a ceiling (CLAUDE.md rule #1).
const cache = new BoundedTtlCache<ArtistTopSongs | null>(100, CACHE_TTL_MS);

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
export function getArtistTopSongs(artistName: string): Promise<ArtistTopSongs | null> {
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
        isOfficial: true,
      });
    }

    // The search hit's avatar is a square portrait; getArtist's own image is a wide banner.
    return { artistName: artist.name, image: bestThumbnail(artistRef.thumbnails) || bestThumbnail(artist.thumbnails), songs };
  });
}
