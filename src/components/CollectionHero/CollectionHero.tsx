import type { ReactNode } from 'react';
import { bestImageUrl } from '../../api/mappers';
import type { ImageVariant, Song } from '../../api/types';
import { playSongList } from '../../playback/playSongList';
import { collectionMeta } from '../../utils/collectionMeta';
import { shuffledCopy } from '../../utils/shuffle';
import { CollectionDownloadButton } from './CollectionDownloadButton';
import { Icon, type IconName } from '../Icon/Icon';
import { LazyImage } from '../Image/LazyImage';
import styles from './CollectionHero.module.css';

interface CollectionHeroProps {
  /** Small caps label above the title: "Playlist", "Mix", … */
  kind: string;
  title: string;
  /** Makes the title a link (an artist mix links to its artist). */
  onTitleClick?: () => void;
  description?: string;
  /** The songs — for the "N lagu · 45 mnt" line and the play / shuffle buttons. */
  songs: Song[];
  /** Cover art and backdrop. Pass the first song's art when the collection has none of its own. */
  images: ImageVariant[];
  /** Shown as the cover when there is no art (an empty playlist) — never a blank box. */
  fallbackIcon: IconName;
  /** Use the icon as the cover even when there is art (Lagu Disukai keeps its heart; the art still tints the backdrop). */
  iconCover?: boolean;
  /** Present on pages you navigate into; absent on a section inside another page. */
  onBack?: () => void;
  /** Hides the play buttons while the songs are still loading. */
  isLoading?: boolean;
  /** Extra controls after play / shuffle (a playlist's "⋯" menu). */
  extraActions?: ReactNode;
}

/**
 * The header every collection page shares — a user playlist, Lagu Disukai, a Mix, "Temuan Mingguan": a blurred wash
 * of the cover behind a square cover, the title and a one-line summary, then play / shuffle. Playlists have no art of
 * their own, so the cover is their first song's (or the artist's photo for a Mix) — and an empty one still gets a
 * gradient with an icon, never a bare page.
 */
export function CollectionHero({ kind, title, onTitleClick, description, songs, images, fallbackIcon, iconCover, onBack, isLoading, extraActions }: CollectionHeroProps) {
  const backdrop = images.length > 0 ? bestImageUrl(images, '150x150') : '';
  const showArt = images.length > 0 && !iconCover;

  return (
    <div className={[styles.root, onBack ? '' : styles.rootCard].join(' ')}>
      <header className={styles.hero}>
        {backdrop && <img className={styles.backdrop} src={backdrop} alt="" aria-hidden="true" decoding="async" referrerPolicy="no-referrer" />}
        <span className={styles.tint} aria-hidden="true" />
        {onBack && (
          <button type="button" className={styles.backButton} onClick={onBack} aria-label="Kembali">
            <Icon name="chevron-left" size={20} />
          </button>
        )}
        <div className={styles.inner}>
          <div className={styles.cover}>
            {showArt ? (
              <LazyImage images={images} quality="500x500" alt={title} className={styles.coverImage} />
            ) : (
              <span className={styles.coverFallback}>
                <Icon name={fallbackIcon} size={56} />
              </span>
            )}
          </div>
          <div className={styles.info}>
            <span className={styles.kind}>{kind}</span>
            {onTitleClick ? (
              <h1 className={styles.title}>
                <button type="button" className={styles.titleLink} onClick={onTitleClick}>
                  {title}
                </button>
              </h1>
            ) : (
              <h1 className={styles.title}>{title}</h1>
            )}
            {description && <p className={styles.description}>{description}</p>}
            {!isLoading && <span className={styles.meta}>{collectionMeta(songs)}</span>}
          </div>
        </div>
      </header>

      {(!isLoading && songs.length > 0) || extraActions ? (
        <div className={styles.actions}>
          {!isLoading && songs.length > 0 && (
            <>
              <button type="button" className={styles.playButton} onClick={() => playSongList(songs, 0)} aria-label={`Putar ${title}`}>
                <Icon name="play" size={24} />
              </button>
              <button type="button" className={styles.roundButton} onClick={() => playSongList(shuffledCopy(songs), 0)} aria-label="Putar acak">
                <Icon name="shuffle" size={22} />
              </button>
              <CollectionDownloadButton songs={songs} />
            </>
          )}
          {extraActions}
        </div>
      ) : null}
    </div>
  );
}
