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
  durationSec: number;
  thumbnail: string;
  album?: string | null;
}

/** YouTube thumbnail URLs are deterministic for any video id — this gives genuinely tiered image quality instead of reusing one flat image at every size. */
function buildImageVariants(videoId: string, bestThumbnail: string): ImageVariant[] {
  const fallbackHq = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return [
    { quality: '50x50', url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` },
    { quality: '150x150', url: fallbackHq },
    { quality: '500x500', url: bestThumbnail || fallbackHq },
  ];
}

/** Maps our backend's YouTube-derived song shape into the app's internal Song type. */
export function mapBackendSong(raw: BackendSong): Song {
  const artistName = decodeHtmlEntities(raw.artist || 'Unknown Artist');
  const artistRef: ArtistRef = { id: artistName, name: artistName, role: 'primary_artists', image: [], url: '' };
  const albumName = raw.album ? decodeHtmlEntities(raw.album) : null;

  return {
    id: raw.id,
    name: decodeHtmlEntities(raw.title || 'Untitled'),
    duration: raw.durationSec || 0,
    album: albumName ? { id: albumName, name: albumName, url: '' } : null,
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
