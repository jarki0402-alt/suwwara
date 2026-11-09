import { withoutEmDash } from '../utils/noEmDash';

/**
 * Reads what Exportify (exportify.net, github.com/pavelkomarov/exportify) gives you: one CSV per playlist, or all of
 * them in spotify_playlists.zip. Read in the browser so the server never receives a file, only the track list.
 *
 * Exportify's quirks, from its source: the ZIP is JSZip's default (entries STORED, not compressed); a file is named
 * after its playlist with spaces turned into "_" and "/\:*?"<>|" dropped, and a second playlist with the same name
 * gets "_" appended; the liked songs are "Liked_Songs.csv" and "Saved_Albums.csv" is every track of every saved
 * album; a missing field is written as the text "undefined"; artists are joined with ";"; a track Spotify has since
 * deleted is a row with an empty name and a duration of 0.
 */

export interface ExportifyTrack {
  /** ISRC when there is one (the same recording across playlists and albums), else the Spotify URI. */
  key: string;
  name: string;
  artists: string[];
  durationSec: number;
  /** Spotify's "Added At", in ms. */
  addedAt: number | null;
}

export interface ExportifyPlaylist {
  fileName: string;
  name: string;
  kind: 'liked' | 'savedAlbums' | 'playlist';
  tracks: ExportifyTrack[];
  /** Rows that can't be imported: deleted tracks, local files, podcast episodes. */
  skipped: number;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((cells) => Object.fromEntries(header.map((name, index) => [name.trim(), cells[index] ?? ''])));
}

const present = (value: string | undefined): string => {
  const trimmed = (value ?? '').trim();
  return trimmed === 'undefined' || trimmed === 'null' ? '' : trimmed;
};

/** "10's_vibe.csv" -> "10's vibe". The original spacing is gone; underscores read worse than the odd lost character. */
export function playlistNameFromFile(fileName: string): string {
  const base = fileName.replace(/^.*[/\\]/, '').replace(/\.csv$/i, '').replace(/_+$/, '');
  return withoutEmDash(base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()) || 'Spotify';
}

export function playlistFromCsv(fileName: string, text: string): ExportifyPlaylist | null {
  const rows = parseCsv(text);
  const base = fileName.replace(/^.*[/\\]/, '');
  if (rows.length > 0 && !('Track URI' in rows[0] && 'Track Name' in rows[0])) return null;
  const tracks: ExportifyTrack[] = [];
  let skipped = 0;
  for (const row of rows) {
    const uri = present(row['Track URI']);
    const name = present(row['Track Name']);
    const artists = present(row['Artist Name(s)']).split(';').map((a) => a.trim()).filter(Boolean);
    const durationSec = Math.round(Number(present(row['Duration (ms)'])) / 1000);
    if (!uri.startsWith('spotify:track:') || !name || artists.length === 0 || !(durationSec > 0)) {
      skipped++;
      continue;
    }
    const isrc = present(row.ISRC).toUpperCase();
    const addedAt = Date.parse(present(row['Added At']));
    tracks.push({
      key: /^[A-Z0-9]{12}$/.test(isrc) ? isrc : uri,
      name,
      artists,
      durationSec,
      addedAt: Number.isFinite(addedAt) ? addedAt : null,
    });
  }
  const kind = /^Liked_Songs_*\.csv$/i.test(base) ? 'liked' : /^Saved_Albums_*\.csv$/i.test(base) ? 'savedAlbums' : 'playlist';
  return { fileName: base, name: playlistNameFromFile(base), kind, tracks, skipped };
}

// ---- ZIP --------------------------------------------------------------------------------------------------------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The CSV files in a ZIP. Small on purpose instead of a zip library: Exportify's ZIP is stored (method 0), and the
 * browser's own DecompressionStream covers a ZIP someone re-saved with compression (method 8).
 */
export async function csvFilesFromZip(buffer: ArrayBuffer): Promise<{ name: string; text: string }[]> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const files: { name: string; text: string }[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('bad zip directory');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    if (!/\.csv$/i.test(name) || name.startsWith('__MACOSX/')) continue;
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) files.push({ name, text: decoder.decode(raw) });
    else if (method === 8) files.push({ name, text: decoder.decode(await inflateRaw(raw)) });
  }
  return files;
}

/** Every playlist in the picked files (ZIPs and CSVs, mixed), in a stable order: liked songs first. */
export async function readExportifyFiles(files: File[]): Promise<ExportifyPlaylist[]> {
  const csvs: { name: string; text: string }[] = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) csvs.push(...(await csvFilesFromZip(await file.arrayBuffer())));
    else if (/\.csv$/i.test(file.name)) csvs.push({ name: file.name, text: await file.text() });
  }
  const playlists = csvs.map((csv) => playlistFromCsv(csv.name, csv.text)).filter((p): p is ExportifyPlaylist => p !== null);
  const order = { liked: 0, playlist: 1, savedAlbums: 2 } as const;
  return playlists.sort((a, b) => order[a.kind] - order[b.kind]);
}

export interface ImportPayload {
  tracks: { key: string; name: string; artists: string[]; durationSec: number }[];
  playlists: { name: string; liked: boolean; items: { key: string; addedAt: number | null }[] }[];
}

/**
 * What POST /api/import/spotify takes: each unique track once (a song in five playlists is searched once), in the
 * order the server works through them, so the liked songs, first in `playlists`, are matched first.
 */
export function buildImportPayload(playlists: ExportifyPlaylist[]): ImportPayload {
  const tracks = new Map<string, ImportPayload['tracks'][number]>();
  const out: ImportPayload['playlists'] = [];
  for (const playlist of playlists) {
    const seen = new Set<string>();
    const items: ImportPayload['playlists'][number]['items'] = [];
    for (const track of playlist.tracks) {
      if (seen.has(track.key)) continue;
      seen.add(track.key);
      items.push({ key: track.key, addedAt: track.addedAt });
      if (!tracks.has(track.key)) tracks.set(track.key, { key: track.key, name: track.name, artists: track.artists, durationSec: track.durationSec });
    }
    if (items.length > 0) out.push({ name: playlist.name, liked: playlist.kind === 'liked', items });
  }
  return { tracks: [...tracks.values()], playlists: out };
}
