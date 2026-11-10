import { useEffect, useState } from 'react';
import { resizeGoogleImage } from '../api/imageSize';
import { usePageTintStore } from '../stores/pageTintStore';

/**
 * The colour a page takes from its picture (artist banner, album cover, a playlist's cover), like Apple Music.
 *
 * Read on the device from a tiny copy of the picture (64px from Google's image CDN, a few KB), fetched the moment the
 * page knows its picture, alongside the picture itself, so the colour arrives with it. Every host the app's art comes
 * from (lh3/yt3.googleusercontent.com, yt3.ggpht.com, i.ytimg.com) answers a CORS request with
 * `Access-Control-Allow-Origin: *` (checked), so a canvas may read it. A copy at its own URL on purpose: the picture
 * on screen was usually loaded before without CORS (the sidebar, a list row), and asking for that same URL with
 * crossOrigin gets the cached copy without the header, which fails to load at all. No server work, no library: a
 * 24x24 canvas, about a millisecond. Kept per URL, bounded, so going back to a page shows its colour at once.
 *
 * The colour is "r g b" (for `rgb(var(--page-tint))`), or null until known / when the picture can't be read; the
 * page then just looks as it did before.
 */

const SAMPLE_PX = 24;
const MAX_CACHED = 120;
const cache = new Map<string, string | null>();

function remember(url: string, tint: string | null): void {
  cache.delete(url);
  cache.set(url, tint);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

// White on a colour of this relative luminance is about 5:1 (WCAG asks 4.5:1 for body text).
const MAX_LUMINANCE = 0.16;

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const linear = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

/**
 * The picture's most present lively colour: pixels grouped into coarse buckets, each weighted by how colourful it is,
 * so a small red jacket beats a large grey wall, and near-black/near-white (backgrounds, letterboxing) count little.
 * Then set to a fixed depth (dark enough for white text on top), whatever the photo's own brightness.
 */
export function tintFromPixels(data: Uint8ClampedArray): string | null {
  const buckets = new Map<number, { r: number; g: number; b: number; w: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const [, s, l] = rgbToHsl(r, g, b);
    const weight = (0.15 + s) * (l < 0.1 || l > 0.92 ? 0.1 : 1);
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, w: 0 };
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
    bucket.w += weight;
    buckets.set(key, bucket);
  }
  let best: { r: number; g: number; b: number; w: number } | null = null;
  for (const bucket of buckets.values()) if (!best || bucket.w > best.w) best = bucket;
  if (!best || best.w === 0) return null;
  const [h, s, l] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
  // Grey stays grey (a black-and-white photo), colour is kept rich but not neon.
  const saturation = s < 0.12 ? s : Math.min(0.72, Math.max(0.35, s));
  // A black-and-white photo gives a quiet near-neutral grey rather than a mid grey that reads as dull.
  let lightness = s < 0.12 ? 0.2 : Math.min(0.36, Math.max(0.24, l));
  let rgb = hslToRgb(h, saturation, lightness);
  // The same lightness is much brighter in green/yellow than in blue: step down until white text keeps >= ~5:1.
  while (relativeLuminance(rgb) > MAX_LUMINANCE && lightness > 0.1) {
    lightness -= 0.02;
    rgb = hslToRgb(h, saturation, lightness);
  }
  const [r, g, b] = rgb;
  return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
}

/** A URL of the picture no <img> on screen uses: small where the CDN can resize, otherwise just a distinct one. */
function sampleUrl(url: string): string {
  const small = resizeGoogleImage(url, 64);
  if (small !== url) return small;
  return `${url}${url.includes('?') ? '&' : '?'}tint=1`;
}

function readTint(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_PX;
        canvas.height = SAMPLE_PX;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, SAMPLE_PX, SAMPLE_PX);
        resolve(tintFromPixels(context.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX).data));
      } catch {
        // A host without CORS taints the canvas: no colour, the page keeps its plain look.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = sampleUrl(url);
  });
}

/** For a page coloured by its picture: while mounted, its colour fills the page's scroll panel (pageTintStore → AppShell), at once and without a fade. */
export function usePageTint(url: string | null | undefined): string | null {
  const [read, setRead] = useState<{ url: string; tint: string | null } | null>(null);
  const tint = !url ? null : read?.url === url ? read.tint : (cache.get(url) ?? null);
  const setPageTint = usePageTintStore((state) => state.setTint);

  useEffect(() => {
    if (!url || cache.has(url)) return;
    let cancelled = false;
    void readTint(url).then((value) => {
      remember(url, value);
      if (!cancelled) setRead({ url, tint: value });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Only a page that has a picture touches the panel's colour: a collection header shown as a card inside another
  // page (no picture of its own to give) must not wipe that page's colour.
  useEffect(() => {
    if (url) setPageTint(tint);
  }, [url, tint, setPageTint]);
  useEffect(() => {
    if (!url) return;
    return () => setPageTint(null);
  }, [url, setPageTint]);
  return tint;
}
