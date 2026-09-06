import { CollectionSection } from './CollectionSection';
import { RecentlyPlayedSection } from './RecentlyPlayedSection';
import { RecommendedSection } from './RecommendedSection';
import { TopChartSection } from './TopChartSection';
import styles from './HomeView.module.css';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 4) return 'Selamat malam';
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 19) return 'Selamat sore';
  return 'Selamat malam';
}

export function HomeView() {
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <span className={styles.greeting}>{getGreeting()}</span>
        <span className={styles.brand}>Suwwara</span>
      </header>
      <CollectionSection />
      <RecentlyPlayedSection />
      <TopChartSection />
      <RecommendedSection />
    </div>
  );
}
