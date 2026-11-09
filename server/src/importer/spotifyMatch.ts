/**
 * Which YouTube Music song is the same recording as a Spotify track, from YT Music's song search results. Pure (no
 * network) so the rules can be tested on real result lists; importWorker.ts does the searching.
 *
 * Spotify gives title, artists and an exact duration, but no id YT Music can look up: YT Music has no public ISRC
 * search (Apple Music does, which is why Spotify -> Apple Music transfers are exact and this is not). So the match
 * rests on text + duration. Measured on a real 94-track export with deliberately tricky titles (Taylor's Version vs
 * the original, sped up, remixes, Japanese titles, classical, Indonesian indie): 92 confident and correct, 1 doubtful
 * (a radio edit that YT Music only has as the album cut), 1 a track Spotify itself had deleted.
 */

export interface SpotifyTrackForMatch {
  name: string;
  /** In Spotify's order: the first is the main artist. */
  artists: string[];
  durationSec: number;
}

export interface MatchCandidate {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
}

/** yakin = confident, add it. ragu = probably right (usually another edit of the same song), add it but list it. */
export type MatchVerdict = 'yakin' | 'ragu' | 'none';

export interface ScoredCandidate {
  candidate: MatchCandidate;
  verdict: MatchVerdict;
  total: number;
}

// Words that make a recording a different one. A song is only matched to an upload with the same set, so "Love Story"
// never lands on "Love Story (Taylor's Version)" (the same length within a second) and a sped-up edit stays sped up.
const VERSION_WORDS = [
  'remix', 'sped up', 'slowed', 'reverb', 'live', 'ao vivo', 'acoustic', 'instrumental', 'karaoke', 'taylor s version',
  'from the vault', 'extended', 'demo', 'nightcore', 'cover', 'piano', 'ukulele', 'orchestral', 'unplugged', 'stripped',
];

export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The title without Spotify's " - Radio Edit" / " - From X" suffixes or any bracketed extras, full-width ones included
 * ("Before spring ends（在春天消失之前）" is "Before spring ends" on YT Music).
 */
export function coreTitle(title: string): string {
  return normalize(title.replace(/[([{（【].*?[)\]}）】]/g, ' ').split(/\s[-–|]\s/)[0] ?? title);
}

export function versionWords(title: string): string[] {
  const padded = ` ${normalize(title)} `;
  return VERSION_WORDS.filter((word) => padded.includes(` ${word} `));
}

/**
 * First query: main artist + the title without featured artists or Spotify's suffix, plus the version words so a
 * remix query finds the remix. Second (only when the first gives nothing confident): the full title and every artist.
 */
export function searchQueries(track: SpotifyTrackForMatch): [string, string] {
  const bare = track.name.replace(/[([{]\s*(feat|with|ft)\b.*?[)\]}]/gi, '').split(/\s[-–]\s/)[0] ?? track.name;
  const first = `${track.artists[0] ?? ''} ${bare} ${versionWords(track.name).join(' ')}`;
  const second = `${track.name} ${track.artists.join(' ')}`;
  return [first.replace(/\s+/g, ' ').trim(), second.replace(/\s+/g, ' ').trim()];
}

function titleScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const left = new Set(a.split(' '));
  const right = new Set(b.split(' '));
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / new Set([...left, ...right]).size;
}

export function scoreCandidate(track: SpotifyTrackForMatch, candidate: MatchCandidate): ScoredCandidate {
  const title = titleScore(coreTitle(track.name), coreTitle(candidate.title));
  // YT Music names one artist per song; any of Spotify's artists counts ("Starving" is Hailee Steinfeld's there,
  // Grey's and Zedd's too on Spotify).
  const theirArtist = normalize(candidate.artist);
  const artist = track.artists.some((name) => {
    const ours = normalize(name);
    return ours.length > 0 && theirArtist.length > 0 && (ours === theirArtist || theirArtist.includes(ours) || ours.includes(theirArtist));
  });
  const diff = candidate.durationSec > 0 ? Math.abs(candidate.durationSec - track.durationSec) : Infinity;
  const ours = versionWords(track.name);
  const theirs = versionWords(candidate.title);
  const otherVersion = ours.some((word) => !theirs.includes(word)) || theirs.some((word) => !ours.includes(word));

  const durationPoints = diff <= 2 ? 2 : diff <= 5 ? 1.5 : diff <= 10 ? 0.5 : diff <= 20 ? 0 : -2;
  const total = title * 3 + (artist ? 2 : 0) + durationPoints - (otherVersion ? 3 : 0);

  let verdict: MatchVerdict = 'none';
  // Same recordings land within a second or two; 5s allows a different master of it.
  if (title >= 0.8 && artist && diff <= 5 && !otherVersion) verdict = 'yakin';
  // Without the artist only an exact title will do: the artist's name written another way ("Wang OK" is "王OK" there)
  // passes, a DJ re-upload whose title merely contains the song's ("DJ ETHAM 12.45 FULL ...") does not.
  else if ((title >= 0.6 && artist) || (title === 1 && diff <= 3 && !otherVersion)) verdict = 'ragu';
  return { candidate, verdict, total };
}

const RANK: Record<MatchVerdict, number> = { yakin: 2, ragu: 1, none: 0 };

export function pickBest(track: SpotifyTrackForMatch, candidates: MatchCandidate[]): ScoredCandidate | null {
  let best: ScoredCandidate | null = null;
  for (const candidate of candidates) {
    const scored = scoreCandidate(track, candidate);
    if (!best || RANK[scored.verdict] > RANK[best.verdict] || (scored.verdict === best.verdict && scored.total > best.total)) best = scored;
  }
  return best;
}

export function isBetter(next: ScoredCandidate | null, current: ScoredCandidate | null): boolean {
  if (!next) return false;
  if (!current) return true;
  return RANK[next.verdict] > RANK[current.verdict] || (next.verdict === current.verdict && next.total > current.total);
}
