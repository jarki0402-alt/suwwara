import { resizeGoogleImage, TIER_PIXELS } from './imageSize';
import type { ArtistRef, ImageVariant, Song } from './types';

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

/** Cheap insurance against stray HTML entities occasionally present in scraped titles. */
export function decodeHtmlEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = Number.parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return NAMED_HTML_ENTITIES[entity] ?? match;
  });
}

export interface BackendSong {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  durationSec: number;
  thumbnail: string;
  album?: string | null;
  /** YT Music's album id (`MPREb_…`) — what an album page is keyed by. */
  albumId?: string | null;
}

/**
 * All three tiers deliberately use the SAME source (YT Music's own curated
 * square album-art thumbnail, from search/browse results) instead of the
 * smaller two falling back to raw i.ytimg.com/vi/{id}/{mq,hq}default.jpg video
 * thumbnails like an earlier version of this function did. Those raw video
 * thumbnails are auto-extracted frames from the video itself — for videos
 * whose own content has black letterboxing baked into the frame (common for
 * "official audio" uploads that center square album art on a 16:9 canvas),
 * that letterboxing is baked into the pixels, not something object-fit:cover
 * can crop away in CSS. YT Music's own thumbnail doesn't have this problem
 * (it's the actual album art, not a video frame), so reusing it everywhere
 * trades a little bandwidth on small tiles for tiles that are reliably a
 * clean, full-bleed square.
 */
function buildImageVariants(videoId: string, bestThumbnail: string): ImageVariant[] {
  const fallback = bestThumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return [
    { quality: '50x50', url: resizeGoogleImage(fallback, TIER_PIXELS['50x50']) },
    { quality: '150x150', url: resizeGoogleImage(fallback, TIER_PIXELS['150x150']) },
    { quality: '500x500', url: resizeGoogleImage(fallback, TIER_PIXELS['500x500']) },
  ];
}

/** The three image tiers for a plain image URL that isn't tied to a video (an artist's photo). */
export function imagesFromUrl(url: string): ImageVariant[] {
  if (!url) return [];
  return (['50x50', '150x150', '500x500'] as const).map((quality) => ({ quality, url: resizeGoogleImage(url, TIER_PIXELS[quality]) }));
}

/** Maps our backend's YouTube-derived song shape into the app's internal Song type. */
export function mapBackendSong(raw: BackendSong): Song {
  const artistName = decodeHtmlEntities(raw.artist || 'Unknown Artist');
  const artistRef: ArtistRef = { id: artistName, name: artistName, role: 'primary_artists', image: [], url: '' };
  if (raw.artistId) artistRef.browseId = raw.artistId;
  const albumName = raw.album ? decodeHtmlEntities(raw.album) : null;

  return {
    id: raw.id,
    name: decodeHtmlEntities(raw.title || 'Untitled'),
    duration: raw.durationSec || 0,
    album: albumName ? { id: raw.albumId || albumName, name: albumName, url: '' } : null,
    year: null,
    language: '',
    hasLyrics: true,
    lyricsId: null,
    artists: { primary: [artistRef], featured: [], all: [artistRef] },
    image: buildImageVariants(raw.id, raw.thumbnail),
  };
}

export function mapBackendSongs(raw: BackendSong[]): Song[] {
  return raw.map(mapBackendSong);
}

export function primaryArtistNames(song: Song): string {
  if (song.artists.primary.length === 0) return 'Unknown Artist';
  return song.artists.primary.map((artist) => artist.name).join(', ');
}

export function bestImageUrl(images: ImageVariant[], preferred: '50x50' | '150x150' | '500x500'): string {
  const exact = images.find((img) => img.quality === preferred);
  if (exact) return exact.url;
  return images[images.length - 1]?.url ?? '';
}
