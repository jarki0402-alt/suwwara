import { describe, expect, it } from 'vitest';
import { stripFeaturedArtist } from '../../src/lyrics/lyricsResolver';

describe('stripFeaturedArtist', () => {
  it('strips a parenthesized feat. mention', () => {
    expect(stripFeaturedArtist('Calon Mantu Idaman (feat. Ncum)')).toBe('Calon Mantu Idaman');
  });

  it('strips a bracketed ft. mention', () => {
    expect(stripFeaturedArtist('Song Title [ft. Someone]')).toBe('Song Title');
  });

  it('strips an unbracketed featuring mention', () => {
    expect(stripFeaturedArtist('Song Title featuring Someone Else')).toBe('Song Title');
  });

  it('is case-insensitive', () => {
    expect(stripFeaturedArtist('Song Title (FEAT. Someone)')).toBe('Song Title');
  });

  it('leaves titles with no feature mention untouched', () => {
    expect(stripFeaturedArtist('Plain Song Title')).toBe('Plain Song Title');
  });

  it('does not touch "feat"-like substrings that are not a trailing feature credit', () => {
    expect(stripFeaturedArtist('Defeated')).toBe('Defeated');
  });
});
