import { useUiStore } from '../stores/uiStore';
import { HomeView } from '../views/home/HomeView';
import { LibraryView } from '../views/library/LibraryView';
import { SearchView } from '../views/search/SearchView';
import { SettingsView } from '../views/settings/SettingsView';
import styles from './ViewRouter.module.css';

export function ViewRouter() {
  const currentView = useUiStore((state) => state.currentView);

  return (
    // Keyed by view so the fade replays on every switch.
    <div key={currentView} className={styles.view}>
      {renderView(currentView)}
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
