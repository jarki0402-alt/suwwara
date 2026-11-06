import { BROWSE_CATEGORIES, type BrowseCategory } from '../../data/browseCategories';
import { useT } from '../../i18n/i18n';
import styles from './BrowseCategoriesGrid.module.css';

export function BrowseCategoriesGrid({ onSelect }: { onSelect: (category: BrowseCategory) => void }) {
  const t = useT();
  return (
    <div className={styles.grid}>
      {BROWSE_CATEGORIES.map((category) => (
        <button
          key={category.id}
          type="button"
          className={styles.tile}
          style={{ background: category.color }}
          onClick={() => onSelect(category)}
        >
          {t(category.label)}
        </button>
      ))}
    </div>
  );
}
