import { BoundedTtlCache } from './boundedCache';
import { readArtistStats } from './artistStats';
import type { SearchSong } from './search';
import { bestThumbnail } from './search';
import { cleanTitle } from './textClean';
import { getYTMusic } from './ytmusic';

export interface AlbumSummary {
  id: string;
  name: string;
  year: number | null;
  thumbnail: string;
  artist: string;
  artistId: string | null;
}

export interface ArtistPage {
  artistId: string;
  name: string;
  /** Wide banner (YT Music serves these ~2.4:1) — the hero image. */
  banner: string;
  topSongs: SearchSong[];
  /** Rounded, as YouTube Music reports it; null when the artist has none or the page could not be read for it. */
  monthlyListeners: number | null;
  /** videoId → plays for the top songs that show one (rounded, like monthlyListeners). */
  playCounts: Record<string, number>;
  albums: AlbumSummary[];
  singles: AlbumSummary[];
  similarArtists: Array<{ id: string; name: string; thumbnail: string }>;
}

export interface AlbumPage extends AlbumSummary {
  songs: SearchSong[];
}

// All of these are read-mostly catalog data that changes over days, and each miss is a couple
// of round trips to YouTube Music on a 1-vCPU VM — so long TTLs, small hard caps.
const TTL_MS = 6 * 60 * 60 * 1000;
const artistPages = new BoundedTtlCache<ArtistPage>(120, TTL_MS);
const albumPages = new BoundedTtlCache<AlbumPage>(300, TTL_MS);
const allSongs = new BoundedTtlCache<SearchSong[]>(40, TTL_MS);
const resolvedNames = new BoundedTtlCache<string | null>(400, 24 * 60 * 60 * 1000);

/**
 * The hero only ever shows ~1400 CSS px of width at most, and YT Music offers the banner up to
 * 2880px (~310KB). The smallest one that is still wide enough is a third of that on a phone's
 * mobile data, with no visible difference.
 */
function pickBanner(thumbnails: { url: string; width: number }[]): string {
  if (thumbnails.length === 0) return '';
  const sorted = [...thumbnails].sort((a, b) => a.width - b.width);
  return (sorted.find((thumbnail) => thumbnail.width >= 1400) ?? sorted[sorted.length - 1]).url;
}

// Browse ids YouTube Music hands out: artists are `UC…` channel ids, albums `MPREb_…`.
export const ARTIST_ID_PATTERN = /^UC[A-Za-z0-9_-]{10,40}$/;
export const ALBUM_ID_PATTERN = /^MPREb_[A-Za-z0-9_-]{4,40}$/;

// Concurrency for the fan-out that assembles "all songs" (one getAlbum per release). Small on
// purpose: each is a short network call, but 10+ at once on this VM only slows everything else.
const ALL_SONGS_FETCH_CONCURRENCY = 3;
const ALL_SONGS_MAX_RELEASES = 30;

interface RawAlbum {
  albumId: string;
  name: string;
  year: number | null;
  thumbnails: { url: string; width: number }[];
  artist: { artistId: string | null; name: string };
}

function toAlbumSummary(album: RawAlbum): AlbumSummary {
  return {
    id: album.albumId,
    name: cleanTitle(album.name),
    year: album.year ?? null,
    thumbnail: bestThumbnail(album.thumbnails),
    artist: album.artist?.name ?? '',
    artistId: album.artist?.artistId ?? null,
  };
}

/**
 * YouTube Music's release shelves also carry things that only look like albums: playlists made
 * by other users (ids like `UC…`, owner as "artist", no year) — e.g. "Kompilasi Lagu Pop
 * Indonesia 90an" showed up on Lewis Capaldi's page. A real release always has an `MPREb_…` id,
 * which is also the only kind getAlbum can open; anything else would land on an empty page.
 */
function isRealRelease(album: AlbumSummary): boolean {
  return ALBUM_ID_PATTERN.test(album.id);
}

function dedupeAlbums(albums: AlbumSummary[]): AlbumSummary[] {
  const seen = new Set<string>();
  return albums.filter((album) => (seen.has(album.id) ? false : (seen.add(album.id), true)));
}

/** Newest first; releases with no year go last. */
function byYearDesc(a: AlbumSummary, b: AlbumSummary): number {
  return (b.year ?? 0) - (a.year ?? 0);
}

export function getArtistPage(artistId: string): Promise<ArtistPage> {
  return artistPages.getOrLoad(artistId, async () => {
    const ytmusic = await getYTMusic();
    // Two calls in parallel: getArtist has the header, top songs and top releases (only ~8),
    // getArtistAlbums has the artist's full album list.
    // A third, raw call for what the library drops (monthly listeners, plays per song — see artistStats.ts). It is the
    // same browse request getArtist makes internally, `constructRequest` is only private in the typings, and it runs
    // in parallel so the page waits no longer. If it fails the numbers are simply absent.
    const rawBrowse = (ytmusic as unknown as { constructRequest: (endpoint: string, body: object) => Promise<unknown> })
      .constructRequest('browse', { browseId: artistId })
      .catch(() => null);
    const [artist, allAlbums, raw] = await Promise.all([ytmusic.getArtist(artistId), ytmusic.getArtistAlbums(artistId).catch(() => []), rawBrowse]);
    const stats = readArtistStats(raw);

    const topSongs: SearchSong[] = [];
    for (const song of artist.topSongs) {
      if (!song.videoId) continue;
      topSongs.push({
        id: song.videoId,
        title: cleanTitle(song.name),
        artist: song.artist?.name || artist.name,
        artistId: song.artist?.artistId ?? artistId,
        durationSec: song.duration ?? 0,
        thumbnail: bestThumbnail(song.thumbnails),
        album: song.album?.name ?? null,
        albumId: song.album?.albumId ?? null,
        isOfficial: true,
      });
    }

    return {
      artistId: artist.artistId || artistId,
      name: artist.name,
      banner: pickBanner(artist.thumbnails),
      topSongs,
      monthlyListeners: stats.monthlyListeners,
      playCounts: stats.playCounts,
      albums: dedupeAlbums([...allAlbums, ...artist.topAlbums].map((album) => toAlbumSummary(album as RawAlbum)).filter(isRealRelease)).sort(byYearDesc),
      singles: dedupeAlbums(artist.topSingles.map((album) => toAlbumSummary(album as RawAlbum)).filter(isRealRelease)).sort(byYearDesc),
      // "Similar artists" also comes back containing playlists (ids like `VLRD…`) — only real
      // artist channels are worth linking to.
      similarArtists: artist.similarArtists
        .filter((similar) => similar.artistId && ARTIST_ID_PATTERN.test(similar.artistId))
        .map((similar) => ({ id: similar.artistId as string, name: similar.name, thumbnail: bestThumbnail(similar.thumbnails) })),
    };
  });
}

export function getAlbumPage(albumId: string): Promise<AlbumPage> {
  return albumPages.getOrLoad(albumId, async () => {
    const ytmusic = await getYTMusic();
    const album = await ytmusic.getAlbum(albumId);
    const cover = bestThumbnail(album.thumbnails);
    const songs: SearchSong[] = [];
    for (const song of album.songs) {
      if (!song.videoId) continue;
      songs.push({
        id: song.videoId,
        title: cleanTitle(song.name),
        artist: song.artist?.name || album.artist.name,
        artistId: song.artist?.artistId ?? album.artist.artistId ?? null,
        durationSec: song.duration ?? 0,
        // Album tracks come back with the album art; falling back to it keeps every row square and consistent.
        thumbnail: bestThumbnail(song.thumbnails) || cover,
        album: album.name,
        albumId: album.albumId,
        isOfficial: true,
      });
    }
    return { ...toAlbumSummary(album as unknown as RawAlbum), songs };
  });
}

// Releases that are re-issues of songs already on a studio album — the same track then shows up
// three or four times under different video ids.
const VARIANT_RELEASE = /\b(live|remix(es)?|deluxe|extended|acoustic|tour|version|edition|karaoke|instrumental|sessions?|unplugged|complete)\b/i;
const MAX_ALL_SONGS = 250;

/** "Levitating (feat. DaBaby)" and "Levitating - Live" are the same song for a "songs" list. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[([].*?[)\]]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Every song of an artist, assembled from their releases. YouTube Music's own "all songs"
 * call (ytmusic-api's getArtistSongs) fails with a 400 (see artist.ts), and the artist page's
 * own top-songs shelf is only 5 tracks — so the full list is the union of every album/single's
 * track list. Slow-ish on a miss (one getAlbum per release), hence lazy + long-cached.
 *
 * Studio releases are read first (oldest first) so a song is kept in its original version, and
 * later live/remix/deluxe re-issues of the same title are dropped rather than listed again.
 */
export function getArtistAllSongs(artistId: string): Promise<SearchSong[]> {
  return allSongs.getOrLoad(artistId, async () => {
    const page = await getArtistPage(artistId);
    const releases = dedupeAlbums([...page.albums, ...page.singles])
      .sort((a, b) => Number(VARIANT_RELEASE.test(a.name)) - Number(VARIANT_RELEASE.test(b.name)) || (a.year ?? 9999) - (b.year ?? 9999))
      .slice(0, ALL_SONGS_MAX_RELEASES);

    const trackLists: SearchSong[][] = new Array(releases.length).fill(null).map(() => []);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < releases.length) {
        const index = cursor;
        cursor += 1;
        trackLists[index] = await getAlbumPage(releases[index].id).then((album) => album.songs).catch(() => []);
      }
    };
    await Promise.all(Array.from({ length: ALL_SONGS_FETCH_CONCURRENCY }, worker));

    // Only this artist's own tracks — compilations and "featured on" releases are full of other people's.
    const seenIds = new Set<string>();
    const seenTitles = new Set<string>();
    const songs: SearchSong[] = [];
    for (const song of [...page.topSongs, ...trackLists.flat()]) {
      if (seenIds.has(song.id)) continue;
      if (song.artistId && song.artistId !== artistId) continue;
      const title = normalizeTitle(song.title);
      if (title && seenTitles.has(title)) continue;
      seenIds.add(song.id);
      if (title) seenTitles.add(title);
      songs.push(song);
      if (songs.length >= MAX_ALL_SONGS) break;
    }
    return songs;
  });
}

/** Name -> artist id, for the places that only know a name (older saved songs, mix tiles). */
export async function resolveArtistId(name: string): Promise<string | null> {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return resolvedNames.getOrLoad(key, async () => {
    const ytmusic = await getYTMusic();
    const [first] = await ytmusic.searchArtists(name.trim());
    return first?.artistId ?? null;
  });
}
