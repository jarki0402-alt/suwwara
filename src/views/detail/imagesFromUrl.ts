import type { ImageVariant } from '../../api/types';

/** The app's image components take the three-tier ImageVariant list; catalog art comes as one URL. */
export function imagesFromUrl(url: string): ImageVariant[] {
  return [
    { quality: '50x50', url },
    { quality: '150x150', url },
    { quality: '500x500', url },
  ];
}
