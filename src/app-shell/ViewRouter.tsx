import { useUiStore } from '../stores/uiStore';
import { HomeView } from '../views/home/HomeView';
import { LibraryView } from '../views/library/LibraryView';
import { SearchView } from '../views/search/SearchView';
import { SettingsView } from '../views/settings/SettingsView';

export function ViewRouter() {
  const currentView = useUiStore((state) => state.currentView);

  switch (currentView) {
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
