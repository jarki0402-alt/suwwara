import type { Song } from '../api/types';
import { Icon } from '../components/Icon/Icon';
import { useT } from '../i18n/i18n';
import { useVideoMode, type MusicVideo } from './musicVideo';
import { openTheater } from './theater';
import styles from './MusicVideoToggle.module.css';

/**
 * Lagu | Video, at the top of Now Playing where Spotify puts its Song/Video switch. A synced video swaps in for the
 * cover right there (the song doesn't skip a beat); a different cut opens the theater with its own sound.
 */
export function MusicVideoToggle({ song, video }: { song: Song; video: MusicVideo }) {
  const t = useT();
  const wanted = useVideoMode((state) => state.wanted);
  const setWanted = useVideoMode((state) => state.setWanted);
  const showingVideo = wanted && video.synced;

  const pickVideo = () => {
    if (video.synced) setWanted(true);
    else openTheater(song, video);
  };

  return (
    <div className={styles.toggle} role="group" aria-label={t('Lagu atau video')}>
      <button type="button" className={[styles.option, showingVideo ? '' : styles.active].join(' ')} aria-pressed={!showingVideo} onClick={() => setWanted(false)}>
        {t('Lagu')}
      </button>
      <button type="button" className={[styles.option, showingVideo ? styles.active : ''].join(' ')} aria-pressed={showingVideo} onClick={pickVideo}>
        <Icon name="video" size={14} />
        {t('Video')}
      </button>
    </div>
  );
}
