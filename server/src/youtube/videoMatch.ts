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
  /** As YouTube Music shows it. Not to be trusted on its own: it rewrites a lyric channel's "dhruv - double take
   *  (Lyrics)" by Dan Music into "double take" by "Dhruv", so a copy looks exactly like the artist's own upload. */
  name: string;
  artist: string;
  durationSec: number;
  /** The upload's real title and channel, from YouTube itself (oEmbed, see video.ts). What the choice rests on. */
  uploadTitle?: string;
  channel?: string;
}

// Within this the MV is taken to be the same recording as the song. Measured on real pairs: identical recordings land
// within a second; MVs with an intro or a skit are 20s+ apart.
const SYNC_TOLERANCE_SEC = 2;
// Uploads that are the song but not its video. Skipped unless the song's own title says it (a song that IS a remix).
const NOT_A_MUSIC_VIDEO = ['lyric', 'lirik', 'letra', 'live', 'cover', 'karaoke', 'instrumental', 'slowed', 'reverb', 'sped up', 'nightcore', '8d', 'reaction', 'remix', 'acoustic', 'audio', 'terjemahan', 'traducao', 'legendado', 'tutorial', 'piano', 'guitar', 'ukulele', 'chords', 'concert', 'performance', 'teaser', 'trailer', 'behind the scenes', 'visualizer', 'visualiser', 'playlist', 'loop', 'hour'];
// What an official upload calls itself. "performance" is only a video with "official" in front of it (an official
// performance video), not a live one.
const MUSIC_VIDEO_WORDS = ['official music video', 'official video', 'music video', 'official mv', 'mv', 'm v', 'official performance video', 'official performance', 'performance video'];
// YouTube Music lists a few on-topic results first; the real MV is sometimes 8th behind copies, so look a bit further.
const CANDIDATES_SHORTLISTED = 10;
// At most this many get their real channel looked up per song (one tiny request each, cached with the match).
export const CANDIDATES_VERIFIED = 6;

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

function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function channelIsArtist(channel: string, songArtists: string[]): boolean {
  // "Artist - Topic" is YouTube's auto-made channel of the album tracks: a still cover, never a video.
  if (/\s-\s*topic$/i.test(channel)) return false;
  const name = normalize(cleanChannelName(channel).replace(/\bofficial\b/gi, ''));
  if (!name) return false;
  return songArtists.some((artist) => name === artist || name.replace(/ /g, '') === artist.replace(/ /g, ''));
}

function plausibleLength(song: SongForMatch, durationSec: number): boolean {
  // A compilation or a full live set under the same title is not this song's video.
  if (song.durationSec <= 0 || durationSec <= 0) return true;
  return durationSec >= song.durationSec * 0.75 && durationSec <= song.durationSec * 1.8 + 30;
}

/**
 * Pure: the results worth looking up the real channel of, in search order. Judged on what YouTube Music says, which
 * is generous (it credits copies to the artist), so this only drops what is clearly something else.
 */
export function shortlistVideoCandidates(song: SongForMatch, candidates: VideoCandidate[]): VideoCandidate[] {
  const title = coreTitle(song.title);
  const songArtists = artistsOf(song.artist);
  if (!title || songArtists.length === 0) return [];
  return candidates
    .slice(0, CANDIDATES_SHORTLISTED)
    // A blank name is kept: YouTube Music sometimes sends none (aespa's own "Supernova" MV), the real title decides.
    .filter((candidate) => {
      const name = normalize(candidate.name);
      return (name === '' || name.includes(title)) && plausibleLength(song, candidate.durationSec);
    })
    .slice(0, CANDIDATES_VERIFIED);
}

/**
 * Pure, for the tests: the song's official video among results, or null. Judged on the upload's real title and channel
 * when known (always, in the app). Best first:
 * 1. the artist's own channel (SZAVEVO, Dhruv), titled as a video ("Official Video", "MV", "Official Performance");
 * 2. a label's channel (HYBE LABELS, SMTOWN), titled with the artist and as an official video: K-pop lives there;
 * 3. the artist's own channel, plain title ("back to friends"), nothing that marks it as lyrics/audio/live.
 * Lyric channels never title a copy "Official Video", and they are never the artist's channel, so they never qualify.
 */
export function pickMusicVideo(song: SongForMatch, candidates: VideoCandidate[]): MusicVideoMatch | null {
  const title = coreTitle(song.title);
  const songArtists = artistsOf(song.artist);
  const songText = normalize(song.title);
  if (!title || songArtists.length === 0) return null;

  let best: { candidate: VideoCandidate; tier: number } | null = null;
  for (const candidate of candidates.slice(0, CANDIDATES_SHORTLISTED)) {
    // The song being one of the results is no reason to take it: songs that came from a radio or "similar" list are
    // often a lyric channel's upload of the real song, and showing that "video" is exactly what this avoids.
    const name = normalize(candidate.uploadTitle ?? candidate.name);
    const channel = candidate.channel ?? candidate.artist;
    if (!name.includes(title) || !plausibleLength(song, candidate.durationSec)) continue;
    const official = MUSIC_VIDEO_WORDS.some((phrase) => hasPhrase(name, phrase));
    const rejected = NOT_A_MUSIC_VIDEO.some((word) => hasWord(name, word) && !hasWord(songText, word) && !(word === 'performance' && official));
    if (rejected) continue;
    const ownChannel = channelIsArtist(channel, songArtists);
    const tier = ownChannel && official ? 1 : official && songArtists.some((artist) => name.includes(artist)) ? 2 : ownChannel ? 3 : 0;
    if (tier === 0) continue;
    if (!best || tier < best.tier) best = { candidate, tier };
    if (tier === 1) break;
  }
  if (!best) return null;
  const { candidate } = best;
  const synced = candidate.videoId === song.id || (song.durationSec > 0 && Math.abs(candidate.durationSec - song.durationSec) <= SYNC_TOLERANCE_SEC);
  return { videoId: candidate.videoId, durationSec: candidate.durationSec, synced };
}
