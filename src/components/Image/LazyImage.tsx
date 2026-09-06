import { useEffect, useRef, useState } from 'react';
import type { ImageVariant } from '../../api/types';
import { bestImageUrl } from '../../api/mappers';
import styles from './LazyImage.module.css';

interface LazyImageProps {
  images: ImageVariant[];
  quality: '50x50' | '150x150' | '500x500';
  alt: string;
  className?: string;
}

/**
 * IntersectionObserver-gated image loading to avoid decode storms during fast
 * scrolling on low-RAM Android devices — nothing decodes until the tile is
 * near the viewport.
 */
export function LazyImage({ images, quality, alt, className }: LazyImageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const src = bestImageUrl(images, quality);
  const showImage = isVisible && src.length > 0 && !hasError;

  return (
    <div ref={wrapperRef} className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      {showImage ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setHasError(true)} />
      ) : (
        <div className={styles.placeholder} aria-hidden="true" />
      )}
    </div>
  );
}
