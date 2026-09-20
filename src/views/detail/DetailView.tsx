import { lazy, Suspense } from 'react';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { useUiStore } from '../../stores/uiStore';
import styles from './Detail.module.css';

// Loaded on first use: these pages (and their styles) are not needed to open the app, so they
// stay out of the initial bundle that an iPhone has to download and parse before showing Home.
const ArtistView = lazy(() => import('./ArtistView').then((module) => ({ default: module.ArtistView })));
const AlbumView = lazy(() => import('./AlbumView').then((module) => ({ default: module.AlbumView })));

/** The artist/album page on top of the detail stack (see uiStore.detailStack). */
export function DetailView() {
  const route = useUiStore((state) => state.detailStack[state.detailStack.length - 1]);
  if (!route) return null;

  return (
    <Suspense
      fallback={
        <div className={styles.skeletonStack}>
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={`detail-skeleton-${index}`} height={56} borderRadius="var(--radius-md)" />
          ))}
        </div>
      }
    >
      {route.type === 'artist' ? <ArtistView route={route} /> : <AlbumView route={route} />}
    </Suspense>
  );
}
