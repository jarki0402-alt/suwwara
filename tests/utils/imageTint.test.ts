import { describe, expect, it } from 'vitest';
import { tintFromPixels } from '../../src/hooks/useImageTint';

function image(pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flat());
}
const repeat = (n: number, px: [number, number, number]) => Array.from({ length: n }, () => [...px, 255] as [number, number, number, number]);
const parse = (tint: string | null) => (tint ?? '').split(' ').map(Number);

describe('tintFromPixels', () => {
  it('prefers a smaller lively colour over a larger grey area', () => {
    const [r, g, b] = parse(tintFromPixels(image([...repeat(300, [128, 128, 128]), ...repeat(120, [220, 30, 40])])));
    expect(r).toBeGreaterThan(g * 2);
    expect(r).toBeGreaterThan(b * 2);
  });

  it('ignores near-black and near-white backgrounds', () => {
    const [r, g, b] = parse(tintFromPixels(image([...repeat(400, [2, 2, 2]), ...repeat(200, [255, 255, 255]), ...repeat(60, [30, 90, 220])])));
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('is always dark enough for white text', () => {
    for (const px of [[250, 240, 120], [255, 200, 230], [20, 200, 90]] as [number, number, number][]) {
      const [r, g, b] = parse(tintFromPixels(image(repeat(100, px))));
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      expect(luminance).toBeLessThan(0.45);
    }
  });

  it('keeps a black-and-white photo grey', () => {
    const [r, g, b] = parse(tintFromPixels(image(repeat(100, [150, 150, 150]))));
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('gives nothing for a fully transparent picture', () => {
    expect(tintFromPixels(new Uint8ClampedArray(400))).toBeNull();
  });
});
