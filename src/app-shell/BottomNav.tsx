import { Icon, type IconName } from '../components/Icon/Icon';
import { useUiStore, type ViewName } from '../stores/uiStore';
import styles from './BottomNav.module.css';

const TABS: { view: ViewName; label: string; icon: IconName }[] = [
  { view: 'home', label: 'Beranda', icon: 'home' },
  { view: 'search', label: 'Cari', icon: 'search' },
  { view: 'library', label: 'Koleksi', icon: 'library' },
  { view: 'settings', label: 'Pengaturan', icon: 'settings' },
];

export function BottomNav() {
  const currentView = useUiStore((state) => state.currentView);
  const setView = useUiStore((state) => state.setView);

  return (
    <nav className={styles.nav}>
      <span className={styles.brand}>Suwwara</span>
      {TABS.map((tab) => (
        <button
          key={tab.view}
          type="button"
          className={[styles.tabButton, currentView === tab.view ? styles.tabActive : ''].join(' ')}
          onClick={() => setView(tab.view)}
        >
          <Icon name={tab.icon} size={22} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
