import { describe, expect, it } from 'vitest';
import { guessTier, judgeFrames, nextAutoTier, resolveTier, type DeviceHints } from '../../src/hooks/glassQuality';

const strongAndroid: DeviceHints = { reducedTransparency: false, reducedMotion: false, lensSupported: true, deviceMemory: 8, cores: 8 };

describe('guessTier', () => {
  it('gives a capable Chromium device the lens', () => {
    expect(guessTier(strongAndroid)).toBe('full');
  });

  it('starts a 4GB phone (Galaxy A15 class) at lite', () => {
    expect(guessTier({ ...strongAndroid, deviceMemory: 4 })).toBe('lite');
  });

  it('never gives Apple WebKit the lens', () => {
    expect(guessTier({ ...strongAndroid, lensSupported: false })).toBe('lite');
  });

  it('follows the system asking for less transparency or motion', () => {
    expect(guessTier({ ...strongAndroid, reducedTransparency: true })).toBe('off');
    expect(guessTier({ ...strongAndroid, reducedMotion: true })).toBe('lite');
  });
});

describe('resolveTier', () => {
  it('pins whatever the user chose', () => {
    expect(resolveTier('off', null, strongAndroid)).toBe('off');
    expect(resolveTier('full', 'lite', strongAndroid)).toBe('full');
  });

  it('lets a measured ceiling lower Otomatis but never raise it', () => {
    expect(resolveTier('auto', 'lite', strongAndroid)).toBe('lite');
    expect(resolveTier('auto', 'full', { ...strongAndroid, deviceMemory: 4 })).toBe('lite');
  });
});

describe('judgeFrames', () => {
  const frames = (smooth: number, missed: number, refresh = 1000 / 60) => [
    ...Array<number>(smooth).fill(refresh),
    // Each stall shows one frame where three were due — two dropped.
    ...Array<number>(missed).fill(refresh * 3),
  ];

  it('calls a clean 60Hz or 90Hz animation smooth', () => {
    expect(judgeFrames(frames(36, 0))).toBe('smooth');
    expect(judgeFrames(frames(50, 4, 1000 / 90))).toBe('smooth');
  });

  it('grades missed frames', () => {
    expect(judgeFrames(frames(25, 11))).toBe('janky');
    expect(judgeFrames(frames(15, 21))).toBe('severe');
  });

  it('does not let a phone stuck at 30fps call 30fps its normal', () => {
    expect(judgeFrames(Array<number>(30).fill(33.3))).toBe('severe');
  });

  it('judges a fold that crawled through only a handful of frames', () => {
    expect(judgeFrames([160, 170, 150, 180])).toBe('severe');
  });

  it('counts a long stall inside an otherwise smooth animation', () => {
    expect(judgeFrames([...frames(30, 0), 400])).toBe('janky');
  });

  it('leaves a tap too short to judge alone', () => {
    expect(judgeFrames(frames(5, 2))).toBe('unknown');
    expect(judgeFrames([16.7])).toBe('unknown');
  });
});

describe('nextAutoTier', () => {
  it('keeps the lens through a single busy moment', () => {
    expect(nextAutoTier('full', ['smooth', 'janky', 'smooth'])).toBeNull();
  });

  it('drops the lens once glass animations keep missing frames', () => {
    expect(nextAutoTier('full', ['janky', 'smooth', 'janky'])).toBe('lite');
    expect(nextAutoTier('full', ['smooth', 'severe'])).toBe('lite');
  });

  it('only turns glass off after repeated severe stutter on lite', () => {
    expect(nextAutoTier('lite', ['severe', 'janky', 'severe'])).toBeNull();
    expect(nextAutoTier('lite', ['severe', 'severe', 'smooth', 'severe'])).toBe('off');
  });

  it('skips samples it could not judge', () => {
    expect(nextAutoTier('full', ['janky', 'unknown', 'unknown', 'unknown', 'janky'])).toBe('lite');
  });
});
