import type { ImageVariant } from '../../api/types';
import { Icon, type IconName } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import styles from './HorizontalSongCard.module.css';
import placeholderStyles from './CollectionSection.module.css';

interface ShelfCardProps {
  title: string;
  subtitle: string;
  /** Cover art; when there is none yet the card shows `fallbackIcon` on a tinted square. */
  images: ImageVariant[];
  fallbackIcon?: IconName;
  onClick: () => void;
}

/** A playlist-like card (an artist's mix, a user playlist) in the same shape as HorizontalSongCard. */
export function ShelfCard({ title, subtitle, images, fallbackIcon = 'library', onClick }: ShelfCardProps) {
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <span className={styles.artWrapper}>
        {images.length > 0 ? (
          <LazyImage images={images} quality="150x150" alt={title} className={styles.art} />
        ) : (
          <span className={placeholderStyles.placeholderArt}>
            <Icon name={fallbackIcon} size={28} />
          </span>
        )}
      </span>
      <span className={styles.title}>{title}</span>
      <span className={styles.subtitle}>{subtitle}</span>
    </button>
  );
}
