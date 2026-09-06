import { BROWSE_CATEGORIES, type BrowseCategory } from '../../data/browseCategories';
import styles from './BrowseCategoriesGrid.module.css';

export function BrowseCategoriesGrid({ onSelect }: { onSelect: (category: BrowseCategory) => void }) {
  return (
    <div className={styles.grid}>
      {BROWSE_CATEGORIES.map((category) => (
        <button
          key={category.id}
          type="button"
          className={styles.tile}
          style={{ background: `linear-gradient(135deg, ${category.gradientFrom}, ${category.gradientTo})` }}
          onClick={() => onSelect(category)}
        >
          {category.label}
        </button>
      ))}
    </div>
  );
}
