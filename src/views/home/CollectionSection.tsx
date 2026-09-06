import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { playSongList } from '../../playback/playSongList';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';
import cardStyles from './HorizontalSongCard.module.css';
import styles from './CollectionSection.module.css';
import sectionStyles from './RecentlyPlayedSection.module.css';

/**
 * Always-visible shortcut row (Liked Songs + any playlists) at the top of Home — unlike
 * the other Home sections, this never hides itself even with zero data, so the space
 * right under the greeting header isn't just an empty gap before content loads in.
 */
export function CollectionSection() {
  const likedSongs = useLibraryStore((state) => state.likedSongs);
  const playlists = useLibraryStore((state) => state.playlists);
  const setView = useUiStore((state) => state.setView);

  return (
    <section className={sectionStyles.section}>
      <h2 className={sectionStyles.heading}>Koleksi Kamu</h2>
      <div className={sectionStyles.scroller}>
        <button
          type="button"
          className={cardStyles.card}
          onClick={() => (likedSongs.length > 0 ? playSongList(likedSongs, 0) : setView('library'))}
        >
          <span className={cardStyles.artWrapper}>
            <span className={styles.likedArt}>
              <Icon name="heart-filled" size={32} />
            </span>
          </span>
          <span className={cardStyles.title}>Lagu Disukai</span>
          <span className={cardStyles.subtitle}>{likedSongs.length} lagu</span>
        </button>

        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            type="button"
            className={cardStyles.card}
            onClick={() => (playlist.songs.length > 0 ? playSongList(playlist.songs, 0) : setView('library'))}
          >
            <span className={cardStyles.artWrapper}>
              {playlist.songs[0] ? (
                <LazyImage images={playlist.songs[0].image} quality="150x150" alt={playlist.name} className={cardStyles.art} />
              ) : (
                <span className={styles.placeholderArt}>
                  <Icon name="library" size={28} />
                </span>
              )}
            </span>
            <span className={cardStyles.title}>{playlist.name}</span>
            <span className={cardStyles.subtitle}>{playlist.songs.length} lagu</span>
          </button>
        ))}
      </div>
    </section>
  );
}
