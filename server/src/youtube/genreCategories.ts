import { getArtistTopSongs } from './artist';
import { BoundedTtlCache } from './boundedCache';
import type { SearchSong } from './search';

/**
 * The Search tab's genre/mood tiles. Their songs used to come from a keyword search
 * ("pop songs 2026 official audio"), which matches TITLES — a tile called Pop returned songs
 * with "pop" in the name, whatever genre they were. There is no genre API to lean on
 * (ytmusic-api has none, and searching playlists returns arbitrary user-made ones), so a
 * category is defined by who is in it: a hand-picked set of unmistakable artists per genre,
 * each contributing their own top songs. Deterministic, and every song in a tile is by
 * someone who really belongs there. Edit the lists to change what a tile shows.
 */
const CATEGORY_ARTISTS: Record<string, string[]> = {
  pop: ['Dua Lipa', 'Ariana Grande', 'Taylor Swift', 'Ed Sheeran', 'Harry Styles', 'Sabrina Carpenter'],
  hiphop: ['Kendrick Lamar', 'Drake', 'Eminem', 'Travis Scott', 'J. Cole', 'Post Malone'],
  rnb: ['SZA', 'Usher', 'Frank Ocean', 'Daniel Caesar', 'Summer Walker', 'Chris Brown'],
  rock: ['Foo Fighters', 'Imagine Dragons', 'Linkin Park', 'Arctic Monkeys', 'Green Day', 'Queen'],
  kpop: ['BTS', 'BLACKPINK', 'NewJeans', 'Stray Kids', 'aespa', 'TWICE'],
  indonesia: ['Tulus', 'Raisa', 'Sheila On 7', 'NOAH', 'Hindia', 'Nadin Amizah'],
  edm: ['Calvin Harris', 'David Guetta', 'Avicii', 'Martin Garrix', 'Marshmello', 'Alan Walker'],
  chill: ['Cigarettes After Sex', 'Rex Orange County', 'Clairo', 'Mac DeMarco', 'Jack Johnson', 'Norah Jones'],
  sad: ['Adele', 'Lewis Capaldi', 'Sam Smith', 'Billie Eilish', 'Nadin Amizah', 'Juicy Luicy'],
  party: ['Pitbull', 'LMFAO', 'Black Eyed Peas', 'Rihanna', 'Lady Gaga', 'Bruno Mars'],
  workout: ['Eminem', 'Imagine Dragons', 'Kanye West', 'Fall Out Boy', 'Metallica', 'David Guetta'],
  throwback: ['Backstreet Boys', 'Britney Spears', 'Maroon 5', 'Linkin Park', 'Michael Jackson', 'Beyoncé'],
};

export const CATEGORY_IDS = new Set(Object.keys(CATEGORY_ARTISTS));

const MAX_SONGS_PER_CATEGORY = 36;
// Each artist is one search + one getArtist call; a few at a time keeps a cold tile quick
// without a burst of a dozen simultaneous requests on this VM.
const FETCH_CONCURRENCY = 3;

const cache = new BoundedTtlCache<SearchSong[]>(20, 6 * 60 * 60 * 1000);

export function getCategorySongs(categoryId: string): Promise<SearchSong[]> {
  return cache.getOrLoad(categoryId, async () => {
    const names = CATEGORY_ARTISTS[categoryId] ?? [];
    const perArtist: SearchSong[][] = names.map(() => []);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < names.length) {
        const index = cursor;
        cursor += 1;
        perArtist[index] = await getArtistTopSongs(names[index]).then((result) => result?.songs ?? []).catch(() => []);
      }
    };
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));

    // Round-robin across the artists (one song from each in turn) rather than one artist's
    // block after another, so the list opens with variety.
    const seen = new Set<string>();
    const songs: SearchSong[] = [];
    for (let round = 0; songs.length < MAX_SONGS_PER_CATEGORY; round += 1) {
      let tookAny = false;
      for (const list of perArtist) {
        const song = list[round];
        if (!song) continue;
        tookAny = true;
        if (seen.has(song.id)) continue;
        seen.add(song.id);
        songs.push(song);
        if (songs.length >= MAX_SONGS_PER_CATEGORY) break;
      }
      if (!tookAny) break;
    }
    if (songs.length === 0) throw new Error('no songs for category'); // don't cache an empty result
    return songs;
  });
}
