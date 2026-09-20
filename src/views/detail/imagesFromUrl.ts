import { resizeGoogleImage, TIER_PIXELS } from '../../api/imageSize';
import type { ImageVariant } from '../../api/types';

/** The app's image components take the three-tier ImageVariant list; catalog art comes as one URL. */
export function imagesFromUrl(url: string): ImageVariant[] {
  return [
    { quality: '50x50', url: resizeGoogleImage(url, TIER_PIXELS['50x50']) },
    { quality: '150x150', url: resizeGoogleImage(url, TIER_PIXELS['150x150']) },
    { quality: '500x500', url: resizeGoogleImage(url, TIER_PIXELS['500x500']) },
  ];
}
