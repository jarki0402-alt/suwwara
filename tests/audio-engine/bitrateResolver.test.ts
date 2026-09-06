import { describe, expect, it } from 'vitest';
import { resolveAudioUrl } from '../../src/audio-engine/bitrateResolver';

describe('resolveAudioUrl', () => {
  it('requests high quality when Data Saver is off', () => {
    expect(resolveAudioUrl('abc123', false)).toBe('/api/audio/abc123?quality=high');
  });

  it('requests low quality when Data Saver is on', () => {
    expect(resolveAudioUrl('abc123', true)).toBe('/api/audio/abc123?quality=low');
  });

  it('URL-encodes the song id', () => {
    expect(resolveAudioUrl('a b/c', false)).toBe('/api/audio/a%20b%2Fc?quality=high');
  });
});
