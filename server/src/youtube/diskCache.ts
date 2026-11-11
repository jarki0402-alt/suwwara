import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Whole tracks kept on the VM's disk (not RAM — see CLAUDE.md, this box has 1GB), so a song someone already listened to
 * is served without asking yt-dlp or YouTube for anything: no resolve, no expired-link recovery, ~instant on every device.
 *
 * Bounded: total size is capped and the least recently played file goes first (its mtime is bumped on every hit).
 * Files are written under a temp name and renamed only once complete and the right size, so a half-written file is
 * never served.
 */
const DIR = process.env.AUDIO_CACHE_DIR ?? '/data/audio-cache';
const MAX_BYTES = Number(process.env.AUDIO_CACHE_MAX_MB ?? 6144) * 1024 * 1024;
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

export interface CachedTrack {
  path: string;
  size: number;
  mimeType: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{6,20}$/;
const storing = new Set<string>();
let ready: Promise<boolean> | null = null;

function ensureDir(): Promise<boolean> {
  ready ??= mkdir(DIR, { recursive: true }).then(
    () => true,
    () => false, // read-only or missing volume: the cache just stays off
  );
  return ready;
}

function fileFor(videoId: string, quality: string): string {
  return path.join(DIR, `${videoId}.${quality}`);
}

export async function getCachedTrack(videoId: string, quality: string): Promise<CachedTrack | null> {
  if (!SAFE_ID.test(videoId) || !(await ensureDir())) return null;
  const file = fileFor(videoId, quality);
  try {
    const [info, meta] = await Promise.all([stat(file), readFile(`${file}.mime`, 'utf8').then((text) => text.trim())]);
    if (info.size === 0 || !meta) return null;
    const now = new Date();
    void utimes(file, now, now).catch(() => {}); // recently played = last to be evicted
    return { path: file, size: info.size, mimeType: meta };
  } catch {
    return null;
  }
}

export function openTrackStream(track: CachedTrack, start: number, end: number) {
  return createReadStream(track.path, { start, end });
}

/** Adds a track by asking `readChunk` for its pieces in order. Skips silently on any problem — it is only a shortcut. */
export async function storeTrack(
  videoId: string,
  quality: string,
  mimeType: string,
  total: number,
  chunkCount: number,
  readChunk: (index: number) => Promise<Buffer>,
): Promise<void> {
  if (!SAFE_ID.test(videoId) || total <= 0 || total > MAX_BYTES / 4 || !(await ensureDir())) return;
  const key = `${videoId}.${quality}`;
  if (storing.has(key) || (await getCachedTrack(videoId, quality))) return;
  storing.add(key);
  const file = fileFor(videoId, quality);
  const temp = `${file}.tmp`;
  try {
    const handle = await open(temp, 'w');
    try {
      let written = 0;
      for (let index = 0; index < chunkCount; index += 1) {
        const buffer = await readChunk(index);
        await handle.write(buffer);
        written += buffer.length;
      }
      if (written !== total) throw new Error('size mismatch');
    } finally {
      await handle.close();
    }
    await writeFile(`${file}.mime`, mimeType);
    await rename(temp, file);
    void sweep();
  } catch {
    await rm(temp, { force: true }).catch(() => {});
  } finally {
    storing.delete(key);
  }
}

/** Deletes least-recently-played files until the total fits the budget. */
export async function sweep(): Promise<void> {
  if (!(await ensureDir())) return;
  try {
    const names = (await readdir(DIR)).filter((name) => !name.endsWith('.mime') && !name.endsWith('.tmp'));
    const files = (
      await Promise.all(
        names.map(async (name) => {
          try {
            const info = await stat(path.join(DIR, name));
            return { name, size: info.size, at: info.mtimeMs };
          } catch {
            return null;
          }
        }),
      )
    ).filter((entry): entry is { name: string; size: number; at: number } => entry !== null);
    let total = files.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of files.sort((a, b) => a.at - b.at)) {
      if (total <= MAX_BYTES) break;
      await rm(path.join(DIR, entry.name), { force: true });
      await rm(path.join(DIR, `${entry.name}.mime`), { force: true });
      total -= entry.size;
    }
    // Leftovers of an interrupted write.
    for (const name of await readdir(DIR)) {
      if (name.endsWith('.tmp')) {
        const info = await stat(path.join(DIR, name)).catch(() => null);
        if (info && Date.now() - info.mtimeMs > 10 * 60 * 1000) await rm(path.join(DIR, name), { force: true });
      }
    }
  } catch {
    // best effort
  }
}

setInterval(() => void sweep(), SWEEP_INTERVAL_MS).unref();

// One-off clean-up (2026-11): for a long stretch yt-dlp could only get YouTube's 360p video+audio file, so the tracks
// stored then are videos, 2-3x the bytes of the m4a now resolved, with a picture track Chrome on Android pauses in the
// background. They're found by the video handler in the file's header (the moov box of that format sits at the start)
// and deleted; the next play stores the audio-only file. The marker ends in .mime so sweep() never counts it.
const AUDIO_ONLY_MARKER = '.audio-only-v1.mime';
const HEADER_BYTES = 64 * 1024;

async function hasVideoTrack(file: string): Promise<boolean> {
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(HEADER_BYTES), 0, HEADER_BYTES, 0);
    const head = buffer.subarray(0, bytesRead);
    for (let at = head.indexOf('hdlr'); at !== -1; at = head.indexOf('hdlr', at + 4)) {
      if (head.subarray(at + 4, at + 16).includes('vide')) return true;
    }
    return false;
  } finally {
    await handle.close();
  }
}

async function purgeVideoTracksOnce(): Promise<void> {
  if (!(await ensureDir())) return;
  try {
    if (await stat(path.join(DIR, AUDIO_ONLY_MARKER)).then(() => true, () => false)) return;
    let removed = 0;
    // One file at a time: a slow background read, never a burst of disk I/O on the small VM.
    for (const name of await readdir(DIR)) {
      if (name.endsWith('.mime') || name.endsWith('.tmp')) continue;
      const file = path.join(DIR, name);
      if (await hasVideoTrack(file).catch(() => false)) {
        await rm(file, { force: true });
        await rm(`${file}.mime`, { force: true });
        removed += 1;
      }
    }
    await writeFile(path.join(DIR, AUDIO_ONLY_MARKER), 'done');
    // eslint-disable-next-line no-console
    console.log(`[audio-cache] removed ${removed} stored tracks that were video files`);
  } catch {
    // best effort: tried again on the next start
  }
}

setTimeout(() => void purgeVideoTracksOnce(), 20_000).unref();

/** How many tracks the disk cache holds and their total size, for the admin console (metrics/systemSamples.ts every 5 minutes). */
export async function diskCacheStats(): Promise<{ files: number; bytes: number; maxBytes: number } | null> {
  if (!(await ensureDir())) return null;
  try {
    const names = (await readdir(DIR)).filter((name) => !name.endsWith('.mime') && !name.endsWith('.tmp'));
    let bytes = 0;
    for (const name of names) bytes += (await stat(path.join(DIR, name)).catch(() => null))?.size ?? 0;
    return { files: names.length, bytes, maxBytes: MAX_BYTES };
  } catch {
    return null;
  }
}
