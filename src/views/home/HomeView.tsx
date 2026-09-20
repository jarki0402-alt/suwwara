import { useUiStore } from '../../stores/uiStore';
import { ArtistMixesSection } from './ArtistMixesSection';
import { CollectionSection } from './CollectionSection';
import { GeneratedCollectionView } from './GeneratedCollectionView';
import { MadeForYouSection } from './MadeForYouSection';
import { RecentlyPlayedSection } from './RecentlyPlayedSection';
import { RecommendedSection } from './RecommendedSection';
import { TopChartSection } from './TopChartSection';
import { useGeneratedCollection } from './useGeneratedCollection';
import styles from './HomeView.module.css';

export function HomeView() {
  const openedCollectionId = useUiStore((state) => state.openedCollectionId);
  const closeCollection = useUiStore((state) => state.closeCollection);
  const collection = useGeneratedCollection(openedCollectionId);

  if (collection) {
    return (
      <GeneratedCollectionView
        title={collection.title}
        description={collection.description}
        songs={collection.songs}
        isLoading={collection.isLoading}
        onBack={closeCollection}
        artistName={openedCollectionId?.startsWith('artist-mix:') ? openedCollectionId.slice('artist-mix:'.length) : undefined}
      />
    );
  }

  return (
    <div className={styles.view}>
      <MadeForYouSection />
      <CollectionSection />
      <RecentlyPlayedSection />
      <RecommendedSection />
      <ArtistMixesSection />
      <TopChartSection />
    </div>
  );
}
