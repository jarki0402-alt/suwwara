import { useT } from '../../i18n/i18n';
import { useUiStore } from '../../stores/uiStore';
import { ArtistMixesSection } from './ArtistMixesSection';
import { GeneratedCollectionView } from './GeneratedCollectionView';
import { HomeHeader } from './HomeHeader';
import { useState } from 'react';
import { HomeMixes, MixFilterChips } from './HomeMixes';
import type { MixFilter } from './mixCatalog';
import { QuickTiles } from './QuickTiles';
import { RecentlyPlayedSection } from './RecentlyPlayedSection';
import { RecommendedSection } from './RecommendedSection';
import { TopChartSection } from './TopChartSection';
import { useGeneratedCollection } from './useGeneratedCollection';
import styles from './HomeView.module.css';

export function HomeView() {
  const t = useT();
  const openedCollectionId = useUiStore((state) => state.openedCollectionId);
  const closeCollection = useUiStore((state) => state.closeCollection);
  const collection = useGeneratedCollection(openedCollectionId);
  const [mixFilter, setMixFilter] = useState<MixFilter>('all');

  if (collection) {
    const isArtistMix = openedCollectionId?.startsWith('artist-mix:') ?? false;
    return (
      <GeneratedCollectionView
        title={collection.title}
        description={collection.description}
        kind={isArtistMix ? t('Mix artis') : openedCollectionId === 'viral-indonesia' ? t('Chart') : t('Untukmu')}
        songs={collection.songs}
        cover={collection.image}
        isLoading={collection.isLoading}
        onBack={closeCollection}
        artistName={isArtistMix && openedCollectionId ? openedCollectionId.slice('artist-mix:'.length) : undefined}
      />
    );
  }

  return (
    <div className={styles.view}>
      {/* 2026-11 redesign: shortcut tiles, the mixes ("Dibuat untukmu", with the phone's chips and hero card), then
          what was already here. Koleksi Kamu moved out: Lagu Disukai and the playlists are among the tiles. */}
      <HomeHeader />
      <MixFilterChips value={mixFilter} onChange={setMixFilter} />
      <QuickTiles />
      <HomeMixes filter={mixFilter} />
      <TopChartSection />
      <RecentlyPlayedSection />
      <RecommendedSection />
      <ArtistMixesSection />
    </div>
  );
}
