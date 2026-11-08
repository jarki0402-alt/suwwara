// For a long stretch (until 2026-11) the backend could only get YouTube's 360p video+audio file (itag 18), and phones
// stored those as "songs" (Simpan lagu di perangkat, Unduh). The backend cleaned its own copies (diskCache.ts); the
// ones on devices stayed. Chrome on Android treats a file with a picture track as a video and pauses it once the app
// is in the background: the engine plays it again at once, but the user hears a ~1s gap every time they leave the
// app. An audio-only m4a is never paused, so the stored video copy is swapped for the audio file.

// The moov box of that format sits at the start of the file, so its handlers are within the first few KB.
const HEADER_BYTES = 64 * 1024;
const HDLR = [0x68, 0x64, 0x6c, 0x72]; // "hdlr"
const VIDE = [0x76, 0x69, 0x64, 0x65]; // "vide"

function matchesAt(bytes: Uint8Array, at: number, word: number[]): boolean {
  for (let i = 0; i < word.length; i += 1) if (bytes[at + i] !== word[i]) return false;
  return true;
}

/** Whether these first bytes of an MP4 declare a video handler ("hdlr" box, handler type "vide" 8 bytes after it). */
export function headerHasVideoTrack(bytes: Uint8Array): boolean {
  for (let at = 0; at + 16 <= bytes.length; at += 1) {
    if (!matchesAt(bytes, at, HDLR)) continue;
    // Same leeway as the backend's check: the handler type within the 12 bytes after the box name.
    for (let off = 4; off <= 12; off += 1) if (matchesAt(bytes, at + off, VIDE)) return true;
  }
  return false;
}

/** Reads only the head of the blob (64KB), never the whole file. Unreadable counts as "no video": it plays as before. */
export async function blobHasVideoTrack(blob: Blob): Promise<boolean> {
  try {
    return headerHasVideoTrack(new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer()));
  } catch {
    return false;
  }
}
