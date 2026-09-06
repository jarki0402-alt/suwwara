export interface ImageVariant {
  quality: '50x50' | '150x150' | '500x500';
  url: string;
}

export interface ArtistRef {
  /** Synthetic id — our backend has no stable numeric artist ids (YouTube gives us a channel per video, not a catalog artist entity), so this is the normalized artist name itself. Used as the grouping key for recommendation affinity. */
  id: string;
  name: string;
  role: string;
  image: ImageVariant[];
  url: string;
}

export interface AlbumRef {
  id: string;
  name: string;
  url: string;
}

export interface Song {
  id: string;
  name: string;
  duration: number;
  album: AlbumRef | null;
  year: string | null;
  language: string;
  hasLyrics: boolean;
  lyricsId: string | null;
  artists: {
    primary: ArtistRef[];
    featured: ArtistRef[];
    all: ArtistRef[];
  };
  image: ImageVariant[];
}

export class MusicApiError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'MusicApiError';
    this.cause = cause;
  }
}
