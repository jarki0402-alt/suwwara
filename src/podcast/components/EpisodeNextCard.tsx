import { useEffect, useState } from 'react';
import { audioEngine } from '../../audio-engine/AudioEngine';
import { Icon } from '../../components/Icon/Icon';
import { useT } from '../../i18n/i18n';
import { usePlayback } from '../../playback/PlaybackContext';
import { useUiStore } from '../../stores/uiStore';
import { nextEpisodeFor } from '../playEpisode';
import { usePodcastStore } from '../podcastStore';
import type { Episode } from '../types';
import { usePlayEpisode } from './EpisodeRow';
import styles from './EpisodeNextCard.module.css';

// Offered this close to the end, and kept once the episode has ended, until it is played or dismissed. Never played
// on its own: an episode that ends just stops (falling asleep to a story must not run into the next one).
const OFFER_BEFORE_END_SEC = 30;

/**
 * "Berikutnya: <judul> · Putar" near and after the end of an episode. `inline` is the copy inside Now Playing; the
 * floating one sits above the mini player and steps aside while the phone's full-screen Now Playing covers it.
 */
export function EpisodeNextCard({ inline = false }: { inline?: boolean }) {
  const t = useT();
  const { currentSong, remoteDevice } = usePlayback();
  const play = usePlayEpisode();
  const context = usePodcastStore((state) => state.context);
  const finished = usePodcastStore((state) => (currentSong ? (state.progress[currentSong.id]?.finished ?? false) : false));
  const [nearEnd, setNearEnd] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  // Now Playing open (the phone's full screen, or the desktop's docked panel) shows the inline copy: one at a time.
  const nowPlayingCovers = useUiStore((state) => state.isNowPlayingOpen);
  const episodeId = currentSong?.kind === 'episode' ? currentSong.id : null;

  useEffect(() => {
    setNearEnd(false);
    if (!episodeId) return;
    // Once a second, only while an episode is on: a property read, nothing more.
    const timer = setInterval(() => {
      const duration = currentSong?.duration || audioEngine.getDuration();
      setNearEnd(duration > 0 && duration - audioEngine.getCurrentTime() <= OFFER_BEFORE_END_SEC);
    }, 1000);
    return () => clearInterval(timer);
  }, [episodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!episodeId || remoteDevice || dismissedFor === episodeId || !(nearEnd || finished)) return null;
  if (!inline && nowPlayingCovers) return null;
  const next: Episode | null = context ? nextEpisodeFor(episodeId) : null;
  if (!next) return null;

  return (
    <div className={[styles.card, inline ? styles.inline : ''].join(' ')} role="status">
      <img className={styles.thumb} src={next.thumbnail} alt="" />
      <span className={styles.text}>
        <span className={styles.label}>{t('Berikutnya')}</span>
        <span className={styles.title}>{next.title}</span>
      </span>
      <button type="button" className={styles.play} onClick={() => play(next, context?.episodes ?? [next])}>
        <Icon name="play" size={16} />
        {t('Putar')}
      </button>
      <button type="button" className={styles.close} onClick={() => setDismissedFor(episodeId)} aria-label={t('Tutup')}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
