import { describe, expect, it } from 'vitest';
import { blobHasVideoTrack, headerHasVideoTrack } from '../../src/audio-engine/videoTrack';

// An "hdlr" box as an MP4 writes it: size, name, version/flags, pre_defined, then the handler type.
function hdlr(type: string): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0, 0, 0, 32], 0);
  bytes.set(new TextEncoder().encode('hdlr'), 4);
  bytes.set(new TextEncoder().encode(type), 16);
  return bytes;
}

function file(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(64 + parts.reduce((sum, part) => sum + part.length, 0) + 64);
  let at = 64;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('stored songs that are really video files', () => {
  it('finds the video handler of a video+audio MP4 (the old itag 18 file)', () => {
    expect(headerHasVideoTrack(file(hdlr('vide'), hdlr('soun')))).toBe(true);
  });

  it('leaves an audio-only m4a alone', () => {
    expect(headerHasVideoTrack(file(hdlr('soun')))).toBe(false);
    expect(headerHasVideoTrack(new Uint8Array(0))).toBe(false);
  });

  it('reads it from a blob', async () => {
    expect(await blobHasVideoTrack(new Blob([file(hdlr('vide'))]))).toBe(true);
    expect(await blobHasVideoTrack(new Blob([file(hdlr('soun'))]))).toBe(false);
  });
});
