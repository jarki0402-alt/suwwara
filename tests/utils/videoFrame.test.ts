import { describe, expect, it } from 'vitest';
import { isVideoFrame } from '../../src/api/mappers';

describe('isVideoFrame', () => {
  it('flags the letterboxed 4:3 YouTube frames', () => {
    expect(isVideoFrame('https://i.ytimg.com/vi/abc123/hqdefault.jpg')).toBe(true);
    expect(isVideoFrame('https://i.ytimg.com/vi/abc123/sddefault.jpg?sqp=xyz')).toBe(true);
    expect(isVideoFrame('https://i9.ytimg.com/vi_webp/abc123/default.webp')).toBe(true);
  });

  it('leaves the 16:9 frames and real album art alone', () => {
    expect(isVideoFrame('https://i.ytimg.com/vi/abc123/mqdefault.jpg')).toBe(false);
    expect(isVideoFrame('https://i.ytimg.com/vi/abc123/hq720.jpg')).toBe(false);
    expect(isVideoFrame('https://lh3.googleusercontent.com/abc=w544-h544-l90-rj')).toBe(false);
  });
});
