import { useEffect } from 'react';
import type { Song } from '../api/types';
import { Icon } from '../components/Icon/Icon';
import { useT } from '../i18n/i18n';
import { useVideoMode, warmMusicVideo, type MusicVideo } from './musicVideo';
import { openTheater } from './theater';
import styles from './MusicVideoToggle.module.css';

/**
 * At the top of Now Playing, where Spotify puts its Song/Video switch.
 * - Same recording as the song: Lagu | Video. The picture swaps in for the cover at the song's own spot, the song
 *   doesn't skip a beat.
 * - A different cut (an intro, a skit, another edit): "Tonton MV", its own button. It opens the theater from the
 *   start with its own sound. It used to sit behind the same Video switch, and a switch that sometimes continued and
 *   sometimes started the song over read as a bug.
 */
export function MusicVideoToggle({ song, video }: { song: Song; video: MusicVideo }) {
  const t = useT();
  const wanted = useVideoMode((state) => state.wanted);
  const setWanted = useVideoMode((state) => state.setWanted);
  const showingVideo = wanted && video.synced;

  useEffect(() => warmMusicVideo(video), [video]);

  if (!video.synced) {
    return (
      <button type="button" className={[styles.toggle, styles.single].join(' ')} onClick={() => openTheater(song, video)}>
        <Icon name="video" size={14} />
        {t('Tonton MV')}
      </button>
    );
  }

  return (
    <div className={styles.toggle} role="group" aria-label={t('Lagu atau video')}>
      <button type="button" className={[styles.option, showingVideo ? '' : styles.active].join(' ')} aria-pressed={!showingVideo} onClick={() => setWanted(false)}>
        {t('Lagu')}
      </button>
      <button type="button" className={[styles.option, showingVideo ? styles.active : ''].join(' ')} aria-pressed={showingVideo} onClick={() => setWanted(true)}>
        <Icon name="video" size={14} />
        {t('Video')}
      </button>
    </div>
  );
}
