import { Fragment } from 'react';
import { BUBBLE_LENS_SCALE, CHANNELS, LENS_FILTER_ID, gradientMap } from './liquidGlassFilters';

// The bubble's box (a 64px tab bar → ~92×56). The maps stretch to its real size anyway; this only
// sets the px amounts below and the raster, drawn at 4× so the map itself never steps.
const BOX = { width: 92, height: 56 };
const RASTER = { width: BOX.width * 4, height: BOX.height * 4 };
const SAMPLES = 48;

// Chrome's feDisplacementMap samples nearest-neighbour: any fractional shift turns thin icon
// strokes jagged (measured: a zero-shift filter leaves icons perfectly sharp; the old centre
// magnification speckled them). So the middle doesn't move at all — an icon sitting in the bubble
// stays exactly as crisp as outside it — and all the bending is at the rim, strong enough that
// icons crossing it smear and stretch the way they do under Apple's tab-bar lens. One smooth
// half-cosine curve, finely sampled (gradient-stop corners showed as steps in the bend).
function bubbleStops(length: number): [number, number][] {
  const rimPull = 9;
  const edgeZone = length * 0.28;
  const magnify = 0;
  return Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const p = (i / SAMPLES) * length;
    const fromEdge = Math.min(p, length - p);
    const rim = fromEdge >= edgeZone ? 0 : 0.5 * (1 + Math.cos((Math.PI * fromEdge) / edgeZone));
    const side = p < length / 2 ? 1 : -1;
    const dx = side * rimPull * rim + magnify * (length / 2 - p);
    return [i / SAMPLES, 0.5 + dx / BUBBLE_LENS_SCALE];
  });
}

const MAP_X = gradientMap('x', bubbleStops(BOX.width), RASTER);
const MAP_Y = gradientMap('y', bubbleStops(BOX.height), RASTER);

// Referenced by id from BottomNav.module.css (backdrop-filter: url(#...)); never painted itself.
// Each feDisplacementMap's scale starts at 0 and is written every frame by useLiquidPill, so the
// refraction strength follows the pill's lift. Memo-free on purpose: the props never change, so
// React never re-touches those attributes after mount.
export function LiquidGlassLensDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <filter id={LENS_FILTER_ID} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feImage href={MAP_X} preserveAspectRatio="none" result="mx" />
          <feImage href={MAP_Y} preserveAspectRatio="none" result="my" />
          <feComposite in="mx" in2="my" operator="arithmetic" k2={1} k3={1} result="map" />
          {CHANNELS.map(([name, matrix]) => (
            <Fragment key={name}>
              <feDisplacementMap
                in="SourceGraphic"
                in2="map"
                scale={0}
                xChannelSelector="R"
                yChannelSelector="G"
                result={`d${name}`}
              />
              <feColorMatrix in={`d${name}`} type="matrix" values={matrix} result={name} />
            </Fragment>
          ))}
          <feBlend in="r" in2="g" mode="screen" result="rg" />
          <feBlend in="rg" in2="b" mode="screen" />
        </filter>
      </defs>
    </svg>
  );
}
