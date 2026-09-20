import { useUiStore } from '../stores/uiStore';
import { DetailView } from '../views/detail/DetailView';
import { HomeView } from '../views/home/HomeView';
import { LibraryView } from '../views/library/LibraryView';
import { SearchView } from '../views/search/SearchView';
import { SettingsView } from '../views/settings/SettingsView';
import styles from './ViewRouter.module.css';

export function ViewRouter() {
  const currentView = useUiStore((state) => state.currentView);
  const detailDepth = useUiStore((state) => state.detailStack.length);

  return (
    // Keyed by view so the fade replays on every switch.
    <div key={detailDepth > 0 ? `detail-${detailDepth}` : currentView} className={styles.view}>
      {detailDepth > 0 ? <DetailView /> : renderView(currentView)}
    </div>
  );
}

function renderView(view: ReturnType<typeof useUiStore.getState>['currentView']) {
  switch (view) {
    case 'home':
      return <HomeView />;
    case 'search':
      return <SearchView />;
    case 'library':
      return <LibraryView />;
    case 'settings':
      return <SettingsView />;
    default:
      return null;
  }
}
