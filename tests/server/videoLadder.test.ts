import { describe, expect, it } from 'vitest';
import { buildMasterPlaylist } from '../../server/src/youtube/videoPlaylist';
import { parseVideoTier, pickVariant, type VideoSet, type VideoTier } from '../../server/src/youtube/videoPlaylist';

function variant(tier: VideoTier, width: number, height: number, kbps: number) {
  return { tier, width, height, kbps, codecs: 'avc1.4d401f', stream: { url: `https://x/${tier}`, mimeType: 'video/mp4', durationSec: 170 } };
}

// Real ladder of R8FHtIhWqNo (visionos, 2026-11), trimmed.
const set: VideoSet = {
  variants: [variant('240', 426, 240, 102), variant('360', 640, 360, 211), variant('480', 854, 480, 351), variant('720', 1280, 720, 589), variant('1080', 1920, 1080, 2266)],
};

describe('video quality ladder', () => {
  it('lists every quality up to the cap, 360p first so Safari opens small but not blurry', () => {
    const playlist = buildMasterPlaylist('abc', set.variants, '720');
    const entries = playlist.split('\n').filter((line) => line.startsWith('/api/'));
    expect(entries).toEqual(['/api/video/abc/hls.m3u8?h=360', '/api/video/abc/hls.m3u8?h=240', '/api/video/abc/hls.m3u8?h=480', '/api/video/abc/hls.m3u8?h=720']);
    expect(playlist).toContain('BANDWIDTH=274300,AVERAGE-BANDWIDTH=211000,RESOLUTION=640x360,CODECS="avc1.4d401f"');
  });

  it('includes 1080p only when the cap allows it', () => {
    expect(buildMasterPlaylist('abc', set.variants, '720')).not.toContain('h=1080');
    expect(buildMasterPlaylist('abc', set.variants, '1080')).toContain('h=1080');
  });

  it('still lists one quality when the video has none under the cap', () => {
    const only1080: VideoSet = { variants: [variant('1080', 1920, 1080, 2000)] };
    expect(buildMasterPlaylist('abc', only1080.variants, '480')).toContain('h=1080');
  });

  it('serves the quality below when a rung is missing, and reads old ?h= values', () => {
    const gappy: VideoSet = { variants: [variant('360', 640, 360, 200), variant('720', 1280, 720, 600)] };
    expect(pickVariant(gappy, '480').tier).toBe('360');
    expect(pickVariant(gappy, '1080').tier).toBe('720');
    expect(pickVariant(gappy, '240').tier).toBe('360');
    expect(parseVideoTier('480')).toBe('480');
    expect(parseVideoTier('9999')).toBe('720');
  });
});
