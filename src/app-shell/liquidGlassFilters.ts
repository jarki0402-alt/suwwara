// Displacement map for feDisplacementMap: R = x offset, G = y offset, 0.5 = none. Steep near the
// rim and nearly flat in the middle, so the pill bends what's under its edge like a lens while
// the active icon in its center stays readable (slightly magnified, not smeared).
// `size` is the raster the map is drawn at — give it the element's own size, or a 100×100 map
// stretched over a 400px bar interpolates coarsely enough to show up as steps in the bend.
export function gradientMap(axis: 'x' | 'y', stops: [offset: number, value: number][], size = { width: 100, height: 100 }) {
  const color = (v: number) => {
    const c = Math.round(v * 255);
    return axis === 'x' ? `rgb(${c},0,0)` : `rgb(0,${c},0)`;
  };
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" preserveAspectRatio="none">` +
    `<linearGradient id="g" x2="${axis === 'x' ? 1 : 0}" y2="${axis === 'y' ? 1 : 0}">` +
    stops.map(([offset, value]) => `<stop offset="${offset}" stop-color="${color(value)}"/>`).join('') +
    `</linearGradient><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Each color channel is displaced by a slightly different amount — that's the rainbow fringe real
// glass shows at its rim. The three single-channel passes are recombined with `screen`, which for
// an opaque backdrop (the page behind the tab bar) adds them back exactly; splitting alpha into
// thirds and tripling it again (the earlier way) cost enough 8-bit precision to blur icon edges.
export const CHANNELS = [
  ['r', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
  ['g', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
  ['b', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'],
] as const;

export const LENS_FILTER_ID = 'bn-lens';
/** Displacement scale of the tab bubble's lens at full lift; its maps are laid out against it. */
export const BUBBLE_LENS_SCALE = 26;
