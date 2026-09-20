import { describe, expect, it } from 'vitest';
import { clampOffset, OFFSET_LIMIT_SEC } from '../../src/lyrics/lyricsOffset';

describe('clampOffset', () => {
  it('keeps the nudge within the limit and to a tenth of a second', () => {
    expect(clampOffset(0.5 + 0.5)).toBe(1);
    expect(clampOffset(0.30000000000000004)).toBe(0.3);
    expect(clampOffset(99)).toBe(OFFSET_LIMIT_SEC);
    expect(clampOffset(-99)).toBe(-OFFSET_LIMIT_SEC);
  });
});
