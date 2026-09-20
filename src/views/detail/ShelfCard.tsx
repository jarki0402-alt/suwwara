import { LazyImage } from '../../components/Image/LazyImage';
import { imagesFromUrl } from './imagesFromUrl';
import styles from './Detail.module.css';

interface ShelfCardProps {
  title: string;
  meta?: string;
  imageUrl: string;
  round?: boolean;
  onClick: () => void;
}

/** One tile in a horizontal shelf — an album/single, or (round) a similar artist. */
export function ShelfCard({ title, meta, imageUrl, round, onClick }: ShelfCardProps) {
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <LazyImage
        images={imagesFromUrl(imageUrl)}
        quality="150x150"
        alt={title}
        className={[styles.cardArt, round ? styles.cardArtRound : ''].filter(Boolean).join(' ')}
      />
      <span className={styles.cardTitle}>{title}</span>
      {meta && <span className={styles.cardMeta}>{meta}</span>}
    </button>
  );
}
