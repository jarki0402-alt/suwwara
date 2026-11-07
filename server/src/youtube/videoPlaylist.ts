import type { ResolvedStream } from './stream';

/** Pure parts of the music video's quality ladder (youtube/video.ts resolves it, routes/video.ts serves it). */

/** Quality names of the ladder (ytdlp-service VIDEO_LADDER). '480'/'720' are also what older clients ask for. */
export const VIDEO_TIERS = ['240', '360', '480', '720', '1080'] as const;
export type VideoTier = (typeof VIDEO_TIERS)[number];

export function parseVideoTier(value: unknown, fallback: VideoTier = '720'): VideoTier {
  return VIDEO_TIERS.includes(value as VideoTier) ? (value as VideoTier) : fallback;
}

export interface VideoVariant {
  tier: VideoTier;
  stream: ResolvedStream;
  width: number | null;
  height: number | null;
  kbps: number | null;
  codecs: string | null;
}

/** Every quality of one video, from a single yt-dlp turn. */
export interface VideoSet {
  variants: VideoVariant[];
}


// The quality a player opens on: listed first for Safari, and the one whose index the warm-up fetches ahead.
export const START_TIER: VideoTier = '360';

// When yt-dlp gave no bitrate: YouTube's usual H.264 rates per quality, in kbps.
const TYPICAL_KBPS: Record<VideoTier, number> = { '240': 250, '360': 500, '480': 900, '720': 1500, '1080': 2800 };
// The listed rate is an average and the fragments vary around it; the player compares its measured speed against
// BANDWIDTH, so this headroom keeps it from picking a quality the connection only carries on average.
const PEAK_FACTOR = 1.3;

/**
 * The adaptive playlist: one entry per quality up to `max`, each pointing at its media playlist below. 360p is listed
 * first, the rest lowest to highest: Safari starts on the first entry, so a video opens on a small picture fast and
 * climbs (240p first would look like a broken video for the first seconds; hls.js starts from its own speed estimate
 * and ignores the order). Pure, for the tests.
 */
export function buildMasterPlaylist(videoId: string, variants: VideoVariant[], max: VideoTier): string {
  const allowed = variants.filter((variant) => Number(variant.tier) <= Number(max));
  const ordered = allowed.length > 0 ? allowed : variants.slice(0, 1);
  const listed = [...ordered.filter((variant) => variant.tier === START_TIER), ...ordered.filter((variant) => variant.tier !== START_TIER)];
  const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const variant of listed) {
    const average = Math.round((variant.kbps ?? TYPICAL_KBPS[variant.tier]) * 1000);
    const attributes = [`BANDWIDTH=${Math.round(average * PEAK_FACTOR)}`, `AVERAGE-BANDWIDTH=${average}`];
    if (variant.width && variant.height) attributes.push(`RESOLUTION=${variant.width}x${variant.height}`);
    if (variant.codecs?.startsWith('avc1')) attributes.push(`CODECS="${variant.codecs}"`);
    lines.push(`#EXT-X-STREAM-INF:${attributes.join(',')}`, `/api/video/${encodeURIComponent(videoId)}/hls.m3u8?h=${variant.tier}`);
  }
  return `${lines.join('\n')}\n`;
}


/** The given quality, or the best one below it, or (a video without low rungs) the lowest it has. */
export function pickVariant(set: VideoSet, tier: VideoTier): VideoVariant {
  const wanted = Number(tier);
  const below = set.variants.filter((variant) => Number(variant.tier) <= wanted);
  return below[below.length - 1] ?? set.variants[0]!;
}

