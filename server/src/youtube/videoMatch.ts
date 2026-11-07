import { cleanChannelName } from './textClean';

/**
 * Which YouTube video is a song's official music video, from YouTube Music's video search results. Pure (no network),
 * so the rules can be tested on real result lists: same artist's channel, the song's title, not a lyric/live/cover
 * upload, a plausible length. See video.ts for where the candidates come from.
 */
export interface MusicVideoMatch {
  videoId: string;
  durationSec: number;
  /** Same length as the song (or the song IS the video): the picture can run muted over the song's own audio. */
  synced: boolean;
}

export interface SongForMatch {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
}

export interface VideoCandidate {
  videoId: string;
  name: string;
  artist: string;
  durationSec: number;
}

// Within this the MV is taken to be the same recording as the song. Measured on real pairs: identical recordings land
// within a second; MVs with an intro or a skit are 20s+ apart.
const SYNC_TOLERANCE_SEC = 2;
// Uploads that are the song but not its video. Skipped unless the song's own title says it (a song that IS a remix).
const NOT_A_MUSIC_VIDEO = ['lyric', 'lirik', 'letra', 'live', 'cover', 'karaoke', 'instrumental', 'slowed', 'reverb', 'sped up', 'nightcore', '8d', 'reaction', 'remix', 'acoustic', 'audio', 'terjemahan', 'tutorial', 'piano', 'guitar', 'concert', 'performance', 'teaser', 'trailer', 'behind the scenes'];
const CANDIDATES_CHECKED = 6;

function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The title without its parenthesised extras: "drop dead (feat. X)" and "drop dead [Official Video]" both match "drop dead". */
function coreTitle(title: string): string {
  return normalize(title.replace(/[([{].*?[)\]}]/g, ' ').split(/\s[-–|]\s/)[0] ?? title);
}

function artistsOf(text: string): string[] {
  return text
    .split(/,|&| x | feat\.? | ft\.? | and /i)
    .map((part) => normalize(cleanChannelName(part)))
    .filter(Boolean);
}

/** Whole word (plural too): "lyrics" counts as "lyric", "alive" doesn't count as "live". */
function hasWord(text: string, word: string): boolean {
  return ` ${text} `.includes(` ${word} `) || ` ${text} `.includes(` ${word}s `);
}

/** Pure, for the tests: the first candidate that is the song's official video, or null. */
export function pickMusicVideo(song: SongForMatch, candidates: VideoCandidate[]): MusicVideoMatch | null {
  const title = coreTitle(song.title);
  const songArtists = artistsOf(song.artist);
  const songText = normalize(song.title);
  if (!title || songArtists.length === 0) return null;

  for (const candidate of candidates.slice(0, CANDIDATES_CHECKED)) {
    // The song being one of the results is no reason to take it: songs that came from a radio or "similar" list are
    // often a lyric channel's upload (Dan Music, 7clouds) of the real song, and showing that "video" is exactly what
    // this is meant to avoid. It goes through the same artist/title checks as every other result.
    const channel = normalize(cleanChannelName(candidate.artist));
    const sameArtist = songArtists.some((artist) => channel === artist || channel.includes(artist) || artist.includes(channel));
    if (!sameArtist || !channel) continue;
    const name = normalize(candidate.name);
    if (!name.includes(title)) continue;
    if (NOT_A_MUSIC_VIDEO.some((word) => hasWord(name, word) && !hasWord(songText, word))) continue;
    // A compilation or a full live set under the same title is not this song's video.
    if (song.durationSec > 0 && candidate.durationSec > 0 && (candidate.durationSec < song.durationSec * 0.75 || candidate.durationSec > song.durationSec * 1.8 + 30)) continue;
    const synced = candidate.videoId === song.id || (song.durationSec > 0 && Math.abs(candidate.durationSec - song.durationSec) <= SYNC_TOLERANCE_SEC);
    return { videoId: candidate.videoId, durationSec: candidate.durationSec, synced };
  }
  return null;
}

