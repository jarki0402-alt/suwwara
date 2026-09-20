/**
 * Album art from YouTube Music comes as ONE small URL (`…=w120-h120-l90-rj`) — and the app used to
 * show that same 120px file everywhere, including the ~340px Now Playing art, which is why it looked
 * pixelated. Google's image CDN produces any size on request by rewriting that `=w…-h…` part, so
 * each place asks for roughly what it displays (×2 for retina): small files for list rows, a
 * sharp one for the big art. URLs that aren't Google-CDN ones are returned untouched.
 */
const RESIZABLE_HOST = /^https:\/\/[a-z0-9-]+\.(googleusercontent|ggpht)\.com\//i;
const SIZE_PARAM = /=w\d+-h\d+/;

export function resizeGoogleImage(url: string, pixels: number): string {
  if (!RESIZABLE_HOST.test(url) || !SIZE_PARAM.test(url)) return url;
  return url.replace(SIZE_PARAM, `=w${pixels}-h${pixels}`);
}

/** Pixel size to request for each of the app's three image tiers. */
export const TIER_PIXELS = { '50x50': 160, '150x150': 320, '500x500': 640 } as const;
