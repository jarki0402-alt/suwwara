import { describe, expect, it } from 'vitest';
import { formatEpisodeDate, ytTextToEnglish } from '../../src/podcast/ytText';

describe('ytTextToEnglish', () => {
  it.each([
    ['1,2 jt x ditonton', '1.2M views'],
    ['105 rb x ditonton', '105K views'],
    ['1.010.508 x ditonton', '1,010,508 views'],
    ['18,6 jt subscriber', '18.6M subscribers'],
    ['1,14 jt subscriber', '1.14M subscribers'],
    ['3 hari yang lalu', '3 days ago'],
    ['1 hari yang lalu', '1 day ago'],
    ['2 h lalu', '2 days ago'],
    ['11 bln lalu', '11 months ago'],
    ['1 thn lalu', '1 year ago'],
    ['10 jam lalu', '10 hours ago'],
    ['Streaming 2 minggu yang lalu', 'Streamed 2 weeks ago'],
    ['8 Nov 2025', 'Nov 8, 2025'],
    ['12 Agu 2024', 'Aug 12, 2024'],
    ['15 video', '15 videos'],
    ['1 video', '1 video'],
    ['103 rb video', '103K videos'],
    ['1.021 episode', '1,021 episodes'],
  ])('%s -> %s', (input, expected) => {
    expect(ytTextToEnglish(input)).toBe(expected);
  });

  it('leaves what it does not know as YouTube wrote it', () => {
    expect(ytTextToEnglish('Tayangan langsung')).toBe('Tayangan langsung');
  });
});

describe('formatEpisodeDate', () => {
  it('writes the month as a word, day first', () => {
    expect(formatEpisodeDate('2026-11-09T12:00:00Z', 'id')).toBe('9 November 2026');
    expect(formatEpisodeDate('2026-08-17T12:00:00Z', 'id')).toBe('17 Agustus 2026');
    expect(formatEpisodeDate('2026-11-09T12:00:00Z', 'en')).toBe('9 November 2026');
  });

  it('gives nothing for a missing or broken date', () => {
    expect(formatEpisodeDate(null, 'id')).toBe('');
    expect(formatEpisodeDate('not a date', 'en')).toBe('');
  });
});
